/**
 * MIS LIVE: los LIVE propios de la tienda en TikTok Shop, leídos de la
 * analítica de TikTok y guardados por sesión en `tiktok_lives` (migración
 * 0155). Motor puro en `tiktok/lives.ts`.
 *
 * Corre en el cron de PAGOS (cada hora, `sincronizarPagosTikTok`) con su
 * propio rato: en cada corrida se vuelven a pedir los últimos
 * `DIAS_RECIENTES` días (un live de hoy sigue acumulando venta indirecta) y,
 * hacia atrás, hasta `TRAMOS_POR_CORRIDA` tramos de `DIAS_POR_TRAMO` días
 * desde lo más viejo guardado hasta `TIKTOK_DESDE`. Por cada live que no
 * tiene productos o terminó hace menos de `HORAS_RELEER_PRODUCTOS` se piden
 * sus productos vendidos; y para los que terminaron en los últimos
 * `DIAS_PEDIDOS` días se vuelven a armar los PEDIDOS DE LA TIENDA de su
 * ventana (RPC `tiktok_ventas_pedidos`, una sola llamada que cubre todos),
 * con lo que TikTok paga por cada uno (cambia conforme TikTok liquida) y el
 * costo de Productos y costos. Bitácora `tiktok_sync_log` tarea `lives`.
 *
 * Pedido del dueño, 13-nov-2026: «una sección de análisis de los live en
 * vivo para saber qué se vendió, los pedidos que contienen, cuánto gané…;
 * me refiero a mis live propios».
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import type { Cliente } from "../tiktok/client";
import { livesDeTienda, productosDeLive } from "../tiktok/api";
import {
  CUENTAS_PROPIAS,
  interpretarLives,
  interpretarProductosDeLive,
  pedidosDelLive,
  resumenLives,
  type LiveSesion,
  type OrdenDeLive,
  type PedidosDeLive,
  type ProductoDeLive,
  type ResumenLives,
} from "../tiktok/lives";
import { ventanasPorLeer } from "../tiktok/fuentes-venta";
import { deDesglose, type RenglonParaVentas } from "../tiktok/ventas";
import { sinVentasExternas } from "../tiktok/externos";
import { skusExternos } from "./tiktok-externos";
import { fechaMx } from "./ventas-monitor";
import { TIKTOK_DESDE } from "./consolidado-tiktok";

const DIAS_RECIENTES = 7;
const DIAS_POR_TRAMO = 30;
const TRAMOS_POR_CORRIDA = 2;
const HORAS_RELEER_PRODUCTOS = 48;
const DIAS_PEDIDOS = 15;
export const TAREA_LIVES = "lives";

export interface ResultadoLives {
  ventanas: { desde: string; hasta: string; cuenta: string; lives: number }[];
  guardados: number;
  productosLeidos: number;
  pedidosArmados: number;
  error: string | null;
}

interface FilaLive {
  live_id: string;
  cuenta_tipo: string;
  titulo: string | null;
  creador: unknown;
  inicio: string | null;
  fin: string | null;
  datos: LiveSesion;
  productos: ProductoDeLive[] | null;
  productos_leido_en: string | null;
  pedidos: PedidosDeLive | null;
  pedidos_leido_en: string | null;
  leido_en: string;
}

function diaCorrido(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

export async function leerLives(db: DB, accountId: string, cliente: Cliente): Promise<ResultadoLives> {
  const inicio = new Date().toISOString();
  const r: ResultadoLives = { ventanas: [], guardados: 0, productosLeidos: 0, pedidosArmados: 0, error: null };
  let primero: unknown = null;
  try {
    const { data: guardadas, error } = await db
      .from("tiktok_lives")
      .select("inicio")
      .eq("account_id", accountId)
      .not("inicio", "is", null)
      .order("inicio", { ascending: true })
      .limit(1);
    if (error) throw new Error(`tiktok_lives: ${error.message}`);
    const ventanas = ventanasPorLeer(
      fechaMx(),
      (guardadas ?? []).map((g: any) => String(g.inicio).slice(0, 10)),
      { recientes: DIAS_RECIENTES, fondo: TIKTOK_DESDE, diasPorTramo: DIAS_POR_TRAMO, tramos: TRAMOS_POR_CORRIDA },
    );
    const ahora = new Date().toISOString();
    for (const v of ventanas) {
      let huboLives = false;
      for (const cuentaTipo of CUENTAS_PROPIAS) {
        if (cliente.msRestantes() < 15_000) break;
        let pageToken: string | undefined;
        let enVentana = 0;
        do {
          const lectura = await livesDeTienda(cliente, { desde: v.desde, hasta: v.hasta, cuentaTipo, pageToken });
          if (!lectura) break;
          if (primero == null) primero = lectura.crudo;
          const { lives, siguiente } = interpretarLives(lectura.crudo, cuentaTipo);
          if (lives.length) {
            const filas = lives.map((l) => ({
              account_id: accountId,
              live_id: l.liveId,
              cuenta_tipo: cuentaTipo,
              titulo: l.titulo,
              creador: l.creador,
              inicio: l.inicio,
              fin: l.fin,
              datos: l,
              leido_en: ahora,
            }));
            const { error: e } = await db.from("tiktok_lives").upsert(filas, { onConflict: "account_id,live_id" });
            if (e) throw new Error(`tiktok_lives: ${e.message}`);
            r.guardados += filas.length;
            enVentana += filas.length;
          }
          pageToken = siguiente;
        } while (pageToken && cliente.msRestantes() > 15_000);
        r.ventanas.push({ desde: v.desde, hasta: v.hasta, cuenta: cuentaTipo, lives: enVentana });
        if (enVentana) huboLives = true;
      }
      // Un tramo de fondo sin ningún live es historia que no existe: no se insiste.
      if (v.esFondo && !huboLives) break;
    }

    // Productos vendidos por live: los que no tienen o terminaron hace poco.
    const limiteReciente = new Date(Date.now() - HORAS_RELEER_PRODUCTOS * 3_600_000).toISOString();
    const { data: sinProductos, error: e2 } = await db
      .from("tiktok_lives")
      .select("live_id, fin, productos_leido_en")
      .eq("account_id", accountId)
      .or(`productos_leido_en.is.null,fin.gte.${limiteReciente}`)
      .order("inicio", { ascending: false })
      .limit(60);
    if (e2) throw new Error(`tiktok_lives: ${e2.message}`);
    for (const l of sinProductos ?? []) {
      if (cliente.msRestantes() < 12_000) break;
      // Lo recién releído (menos de una hora) no se vuelve a pedir.
      if (l.productos_leido_en && Date.parse(String(l.productos_leido_en)) > Date.now() - 55 * 60_000) continue;
      const crudo = await productosDeLive(cliente, String(l.live_id));
      if (crudo == null) break;
      const productos = interpretarProductosDeLive(crudo);
      const { error: e3 } = await db
        .from("tiktok_lives")
        .update({ productos, productos_leido_en: new Date().toISOString() })
        .eq("account_id", accountId)
        .eq("live_id", String(l.live_id));
      if (e3) throw new Error(`tiktok_lives: ${e3.message}`);
      r.productosLeidos++;
    }

    r.pedidosArmados = await armarPedidosDeLives(db, accountId);
  } catch (err) {
    r.error = (err as Error).message;
  }
  await db
    .from("tiktok_sync_log")
    .insert({
      account_id: accountId,
      tarea: TAREA_LIVES,
      inicio,
      fin: new Date().toISOString(),
      estado: r.error ? "error" : "ok",
      detalle: { ...r, primero: recortar(primero) },
    })
    .then(() => undefined, () => undefined);
  return r;
}

/** La primera respuesta cruda con a lo más dos sesiones, para la bitácora. */
function recortar(crudo: unknown): unknown {
  if (!crudo || typeof crudo !== "object") return crudo;
  const d = (crudo as any).data ?? crudo;
  const sesiones = Array.isArray(d?.live_stream_sessions) ? d.live_stream_sessions.slice(0, 2) : d?.live_stream_sessions;
  return { ...(crudo as any), data: { ...d, live_stream_sessions: sesiones } };
}

/**
 * Para los lives que terminaron en los últimos `DIAS_PEDIDOS` días, vuelve a
 * armar los pedidos de la tienda de su ventana con UNA llamada al RPC que
 * cubre todos. Devuelve cuántos lives se actualizaron.
 */
async function armarPedidosDeLives(db: DB, accountId: string): Promise<number> {
  const desde = fechaMx(DIAS_PEDIDOS);
  const { data: lives, error } = await db
    .from("tiktok_lives")
    .select("live_id, inicio, fin")
    .eq("account_id", accountId)
    .not("inicio", "is", null)
    .not("fin", "is", null)
    .gte("fin", `${desde}T00:00:00Z`)
    .order("inicio", { ascending: true });
  if (error) throw new Error(`tiktok_lives: ${error.message}`);
  if (!lives?.length) return 0;
  const minInicio = lives.reduce((a, l: any) => (String(l.inicio) < a ? String(l.inicio) : a), String(lives[0].inicio));
  const maxFin = lives.reduce((a, l: any) => (String(l.fin) > a ? String(l.fin) : a), String(lives[0].fin));
  const { ordenes, renglones, costoDe } = await pedidosYCostos(db, accountId, minInicio, maxFin);
  let n = 0;
  for (const l of lives as any[]) {
    const pedidos = pedidosDelLive(ordenes, renglones, { inicio: String(l.inicio), fin: String(l.fin) }, costoDe);
    const { error: e } = await db
      .from("tiktok_lives")
      .update({ pedidos, pedidos_leido_en: new Date().toISOString() })
      .eq("account_id", accountId)
      .eq("live_id", String(l.live_id));
    if (e) throw new Error(`tiktok_lives: ${e.message}`);
    n++;
  }
  return n;
}

/** Los pedidos (sin lo de los vendedores externos) y los costos por modelo para una ventana UTC. */
async function pedidosYCostos(db: DB, accountId: string, desdeIso: string, hastaIso: string) {
  const desdeUtc = `${diaCorrido(desdeIso.slice(0, 10), -1)}T00:00:00Z`;
  const hastaUtc = `${diaCorrido(hastaIso.slice(0, 10), 2)}T00:00:00Z`;
  const [rpc, costosRaw, externos] = await Promise.all([
    db.rpc("tiktok_ventas_pedidos", { p_account: accountId, p_desde: desdeUtc, p_hasta: hastaUtc }),
    traerTodo<any>(db, "productos_config", "modelo, costo_mxn", (q) => q.eq("account_id", accountId).not("costo_mxn", "is", null)),
    skusExternos(db, accountId).catch(() => new Map<string, string>()),
  ]);
  if (rpc.error) throw new Error(`tiktok_ventas_pedidos: ${rpc.error.message}`);
  const ordenesCrudas: OrdenDeLive[] = ((rpc.data?.ordenes ?? []) as any[]).map((o) => ({
    orderId: String(o.orderId),
    estado: o.estado ?? null,
    creadoEn: o.creadoEn ?? null,
    esMuestra: Boolean(o.esMuestra),
    netoRecibido: o.netoRecibido != null ? Number(o.netoRecibido) : null,
    pagoEsperado: o.pagoEsperado != null ? Number(o.pagoEsperado) : null,
    afiliado: o.afiliado != null ? Number(o.afiliado) : null,
    ...deDesglose({ ingreso: o.ingreso, anuncios: o.anuncios }, o.netoRecibido != null || o.pagoEsperado != null),
    creador: o.creador ?? null,
    afiliadoLeido: Boolean(o.afiliadoLeido),
  }));
  const renglonesCrudos: RenglonParaVentas[] = ((rpc.data?.renglones ?? []) as any[]).map((i) => ({
    orderId: String(i.orderId),
    skuInterno: i.skuInterno ?? null,
    cantidad: Number(i.cantidad ?? 0) || 0,
    precio: i.precio != null ? Number(i.precio) : null,
    estado: i.estado ?? null,
  }));
  const { ordenes, renglones } = sinVentasExternas(ordenesCrudas, renglonesCrudos, externos);
  const costoDe = new Map<string, number>();
  for (const c of costosRaw ?? []) {
    const modelo = String(c.modelo ?? "").toUpperCase();
    if (modelo && c.costo_mxn != null && !costoDe.has(modelo)) costoDe.set(modelo, Number(c.costo_mxn));
  }
  return { ordenes: ordenes as OrdenDeLive[], renglones, costoDe };
}

export interface LiveGuardado {
  sesion: LiveSesion;
  productos: ProductoDeLive[] | null;
  pedidos: PedidosDeLive | null;
  leidoEn: string;
}

export interface MisLives {
  lives: LiveGuardado[];
  resumen: ResumenLives;
  /** cuándo se leyó por última vez algo del rango; null sin lectura */
  leidoEn: string | null;
  /** lo que contestó TikTok la última vez que falló (null si la última salió bien o nunca corrió) */
  error: string | null;
  /** true si nunca ha corrido una lectura */
  sinLectura: boolean;
}

/** Lo guardado de los lives que EMPEZARON en el rango [desde, hasta] (días de México), del más nuevo al más viejo. */
export async function cargarMisLives(db: DB, accountId: string, rango: { desde: string; hasta: string }): Promise<MisLives> {
  // El día de México va 6 h detrás de UTC.
  const desdeUtc = `${rango.desde}T06:00:00Z`;
  const hastaUtc = `${diaCorrido(rango.hasta, 1)}T06:00:00Z`;
  const [{ data: filas, error }, { data: ultima }] = await Promise.all([
    db
      .from("tiktok_lives")
      .select("live_id, cuenta_tipo, titulo, creador, inicio, fin, datos, productos, productos_leido_en, pedidos, pedidos_leido_en, leido_en")
      .eq("account_id", accountId)
      .in("cuenta_tipo", [...CUENTAS_PROPIAS])
      .gte("inicio", desdeUtc)
      .lt("inicio", hastaUtc)
      .order("inicio", { ascending: false }),
    db
      .from("tiktok_sync_log")
      .select("estado, detalle, fin")
      .eq("account_id", accountId)
      .eq("tarea", TAREA_LIVES)
      .order("inicio", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw new Error(`tiktok_lives: ${error.message}`);
  const lives: LiveGuardado[] = ((filas ?? []) as unknown as FilaLive[]).map((f) => ({
    sesion: { ...(f.datos as LiveSesion), liveId: String(f.live_id), cuentaTipo: f.cuenta_tipo, inicio: f.inicio, fin: f.fin },
    productos: Array.isArray(f.productos) ? f.productos : null,
    pedidos: f.pedidos ?? null,
    leidoEn: String(f.leido_en),
  }));
  const leidoEn = lives.reduce<string | null>((a, l) => (!a || l.leidoEn > a ? l.leidoEn : a), null);
  return {
    lives,
    resumen: resumenLives(lives),
    leidoEn,
    error: ultima?.estado === "error" ? String((ultima.detalle as any)?.error ?? "TikTok no contestó") : null,
    sinLectura: !ultima,
  };
}
