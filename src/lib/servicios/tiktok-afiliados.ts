/**
 * Lectura de AFILIADOS de TikTok: qué creador trajo cada pedido.
 *
 * Corre en el cron de pagos (cada hora, `sincronizarPagosTikTok`), después
 * del dinero y con el tiempo que le sobre. Dos ventanas por corrida:
 *
 *   · la RECIENTE, los últimos `DIAS_RECIENTES` días: los pedidos nuevos y
 *     los que TikTok atribuye tarde;
 *   · un TRAMO DE FONDO de `DIAS_POR_TRAMO` días hacia atrás desde donde se
 *     quedó la vez pasada (`app_cache` clave `tiktok:afiliados:fondo`),
 *     hasta llegar al primer pedido guardado. Así la historia se completa
 *     sola en unas cuantas corridas sin comerse una función entera.
 *
 * Lo que TikTok devuelve se guarda por LOTE (`tiktok_guardar_afiliados`);
 * cuando una ventana se leyó COMPLETA, lo que no apareció en ella se marca
 * revisado sin creador = venta de la TIENDA (`tiktok_marcar_afiliados_leidos`).
 * Una ventana a medias (se acabó el tiempo) no marca nada: un pedido sin
 * revisar se declara como tal en la pantalla, nunca se asume.
 */
import type { DB } from "../datos/repos";
import type { Cliente } from "../tiktok/client";
import { pedidosDeAfiliados } from "../tiktok/api";
import { interpretarPedidosAfiliados, resumirAfiliado, type FilaAfiliado } from "../tiktok/afiliados";
import { guardarCacheApp, invalidarApp, leerCacheAppGuardado } from "./cache-app";

const DIAS_RECIENTES = 3;
const DIAS_POR_TRAMO = 7;
/** Páginas de 100 por ventana y corrida: ~1 s cada una. */
const PAGINAS_POR_VENTANA = 40;
const FILAS_POR_LOTE = 500;
const CLAVE_FONDO = "tiktok:afiliados:fondo";
/** Prefijo de las pantallas masticadas que cambian cuando cambia el creador de un pedido. */
export const PREFIJO_VENTAS_TIKTOK = "tiktok:ventas:";

interface Fondo {
  /** desde dónde (ISO) ya está leída la historia hacia adelante */
  hasta: string;
}

export interface ResultadoAfiliados {
  ventanas: { desde: string; hasta: string; paginas: number; pedidos: number; completa: boolean; marcados: number }[];
  guardados: number;
  creadores: number;
  fondo: string | null;
  llegoAlPrimero: boolean;
  error: string | null;
}

async function leerVentana(
  db: DB,
  accountId: string,
  cliente: Cliente,
  desdeMs: number,
  hastaMs: number,
  primera: { crudo: unknown } | null,
): Promise<{ paginas: number; filas: FilaAfiliado[]; completa: boolean; primera: { crudo: unknown } | null }> {
  const filas: FilaAfiliado[] = [];
  let token: string | undefined;
  let paginas = 0;
  let completa = false;
  while (paginas < PAGINAS_POR_VENTANA) {
    if (cliente.msRestantes() < 20_000) break;
    const pagina = await pedidosDeAfiliados(cliente, {
      desde: Math.floor(desdeMs / 1000),
      hasta: Math.floor(hastaMs / 1000),
      pageToken: token,
    });
    if (!pagina) break;
    paginas++;
    if (!primera) {
      const crudo = pagina.crudo ?? null;
      primera = { crudo: { ...crudo, orders: Array.isArray(crudo?.orders) ? crudo.orders.slice(0, 2) : crudo?.orders } };
    }
    const pedidos = interpretarPedidosAfiliados(pagina.crudo);
    filas.push(...pedidos.map(resumirAfiliado));
    token = pagina.siguiente;
    if (!token || !pedidos.length) {
      completa = true;
      break;
    }
  }
  return { paginas, filas, completa, primera };
}

async function guardarFilas(db: DB, accountId: string, filas: FilaAfiliado[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < filas.length; i += FILAS_POR_LOTE) {
    const lote = filas.slice(i, i + FILAS_POR_LOTE);
    const { data, error } = await db.rpc("tiktok_guardar_afiliados", { p_account: accountId, p_filas: lote });
    if (error) throw new Error(`tiktok_guardar_afiliados: ${error.message}`);
    n += Number(data ?? 0);
  }
  return n;
}

export async function leerAfiliados(db: DB, accountId: string, cliente: Cliente): Promise<ResultadoAfiliados> {
  const inicio = new Date().toISOString();
  const r: ResultadoAfiliados = { ventanas: [], guardados: 0, creadores: 0, fondo: null, llegoAlPrimero: false, error: null };
  let primera: { crudo: unknown } | null = null;
  const creadores = new Set<string>();
  try {
    const ahora = Date.now();
    const { data: primero } = await db
      .from("tiktok_ordenes")
      .select("fecha_creacion")
      .eq("account_id", accountId)
      .not("fecha_creacion", "is", null)
      .order("fecha_creacion", { ascending: true })
      .limit(1)
      .maybeSingle();
    const primerPedidoMs = primero?.fecha_creacion ? Date.parse(primero.fecha_creacion) : ahora;

    // 1. La ventana reciente.
    const recienteDesde = ahora - DIAS_RECIENTES * 86_400_000;
    const ventanas: { desde: number; hasta: number; esFondo: boolean }[] = [{ desde: recienteDesde, hasta: ahora, esFondo: false }];

    // 2. Un tramo de fondo, desde donde se quedó la vez pasada.
    const guardado = await leerCacheAppGuardado<Fondo>(db, accountId, CLAVE_FONDO);
    const fondoHasta = guardado.estado === "encontrado" && guardado.valor.datos?.hasta ? Date.parse(guardado.valor.datos.hasta) : recienteDesde;
    if (fondoHasta > primerPedidoMs) {
      ventanas.push({ desde: Math.max(primerPedidoMs - 60_000, fondoHasta - DIAS_POR_TRAMO * 86_400_000), hasta: fondoHasta, esFondo: true });
    } else {
      r.llegoAlPrimero = true;
    }

    let nuevoFondo = fondoHasta;
    for (const v of ventanas) {
      if (cliente.msRestantes() < 25_000) break;
      const lectura = await leerVentana(db, accountId, cliente, v.desde, v.hasta, primera);
      primera = lectura.primera;
      for (const f of lectura.filas) if (f.creador) creadores.add(f.creador);
      const guardados = lectura.filas.length ? await guardarFilas(db, accountId, lectura.filas) : 0;
      r.guardados += guardados;
      let marcados = 0;
      if (lectura.completa) {
        const { data, error } = await db.rpc("tiktok_marcar_afiliados_leidos", {
          p_account: accountId,
          p_desde: new Date(v.desde).toISOString(),
          p_hasta: new Date(v.hasta).toISOString(),
        });
        if (error) throw new Error(`tiktok_marcar_afiliados_leidos: ${error.message}`);
        marcados = Number(data ?? 0);
        if (v.esFondo) nuevoFondo = v.desde;
      }
      r.ventanas.push({
        desde: new Date(v.desde).toISOString(),
        hasta: new Date(v.hasta).toISOString(),
        paginas: lectura.paginas,
        pedidos: lectura.filas.length,
        completa: lectura.completa,
        marcados,
      });
    }
    if (nuevoFondo !== fondoHasta || guardado.estado !== "encontrado") {
      await guardarCacheApp(db, accountId, CLAVE_FONDO, { hasta: new Date(nuevoFondo).toISOString() } satisfies Fondo, 0);
    }
    r.fondo = new Date(nuevoFondo).toISOString();
    r.llegoAlPrimero = r.llegoAlPrimero || nuevoFondo <= primerPedidoMs;
    r.creadores = creadores.size;
    if (r.guardados > 0 || r.ventanas.some((v) => v.marcados > 0)) {
      await invalidarApp(db, accountId, "afiliados leídos", { prefijo: PREFIJO_VENTAS_TIKTOK }).catch(() => undefined);
    }
  } catch (err) {
    r.error = (err as Error).message;
  }
  await db
    .from("tiktok_sync_log")
    .insert({
      account_id: accountId,
      tarea: "afiliados",
      inicio,
      fin: new Date().toISOString(),
      estado: r.error ? "error" : "ok",
      detalle: { ...r, primera: primera?.crudo ?? null },
    })
    .then(() => undefined, () => undefined);
  return r;
}
