/**
 * Ventas de TikTok Shop MASTICADAS, como las de MELI y Amazon.
 *
 * Dueño (1-oct-2026): «necesitamos que sea igual que MELI y Amazon, que la
 * info se vaya guardando, no que cada vez jale todo». Hasta ese día
 * /tiktok/ventas bajaba las 12 mil órdenes completas (con el JSON crudo de
 * cada pedido) y los 15 mil renglones bajo RLS en cada apertura: Postgres
 * las cancelaba a los 8 s («Algo falló al cargar esta pantalla») y, cuando
 * alcanzaba, la pantalla tardaba medio minuto.
 *
 * Ahora el trabajo se hace UNA vez por rango y se guarda en `app_cache`
 * (`tiktok:ventas:v2:{desde}:{hasta}`): la pantalla lee ese renglón —aunque
 * esté viejo o invalidado, declarándolo con `Frescura`— y, si tiene más de
 * `TTL_MS` o lo invalidó una sincronización, pide el recálculo por atrás
 * (`after()`). Solo si no existe ningún renglón se calcula en el clic. Los
 * pedidos del rango salen de UN RPC (`tiktok_ventas_pedidos`, sin el JSON
 * crudo), el resto es el motor puro de `tiktok/ventas.ts`.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { efectoDeEstado } from "../tiktok/kardex";
import {
  deDesglose,
  muestrasEnRango,
  origenDeVentas,
  pedidosDeVenta,
  resumenPorModelo,
  type OrdenParaVentas,
  type OrigenVentas,
  type RenglonParaVentas,
  type ResumenModelo,
} from "../tiktok/ventas";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";

/** Cada cuánto se rehace un rango aunque nadie lo invalide. */
const TTL_MS = 10 * 60_000;
const VERSION = "v2";

export function claveVentasTikTok(rango: { desde: string; hasta: string }): string {
  return `tiktok:ventas:${VERSION}:${rango.desde}:${rango.hasta}`;
}

export interface ModeloConCosto extends ResumenModelo {
  costoUnitario: number | null;
  costo: number | null;
  ganancia: number | null;
  pagaPorPar: number | null;
  gananciaPorPar: number | null;
}

export interface MuestraTikTok {
  orderId: string;
  creadoEn: string | null;
  estado: string | null;
  destinatario: string | null;
  skus: string[];
}

export interface VentasTikTokMasticadas {
  rango: { desde: string; hasta: string };
  /** pares e importe de `tiktok_ventas_diarias` en el rango */
  unidades: number;
  importe: number;
  modelos: ModeloConCosto[];
  totales: {
    gananciaTotal: number;
    hayGanancia: boolean;
    sinCosto: number;
    aRecibir: number;
    aRecibirLiquidado: number;
    aRecibirPorLiquidar: number;
    afiliados: number;
    cobradoConDato: number;
    cobradoSinDato: number;
    costoTotal: number;
    /** fracción que se queda TikTok sobre lo cobrado con dato; null sin dato */
    comision: number | null;
    paresConGanancia: number;
    gananciaPorParTotal: number | null;
    pedidosEnPie: number;
    pedidosLiquidados: number;
    pedidosSinDato: number;
    pedidosPorLiquidar: number;
  };
  origen: OrigenVentas;
  /** [estado, pedidos] de los pedidos del rango y los pendientes, sin cancelados */
  porEstado: [string, number][];
  porEnviar: { pedidos: number; pares: number };
  muestras: MuestraTikTok[];
  paresMuestra: number;
}

export interface LecturaVentasTikTok {
  datos: VentasTikTokMasticadas;
  generadoEn: string;
  /** true si lo servido está viejo o invalidado: hay que recalcular por atrás */
  refrescar: boolean;
}

/** Un día ISO (YYYY-MM-DD) corrido `dias` días. */
function diaCorrido(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Calcula el rango completo desde la base (sin caché). */
export async function calcularVentasTikTok(admin: DB, accountId: string, rango: { desde: string; hasta: string }): Promise<VentasTikTokMasticadas> {
  // Los pedidos del rango —con un día de margen por el cambio de UTC a hora
  // de México— más los que aún no salen, de un jalón y sin el JSON crudo.
  const desdeUtc = `${diaCorrido(rango.desde, -1)}T00:00:00Z`;
  const hastaUtc = `${diaCorrido(rango.hasta, 2)}T00:00:00Z`;
  const [ventas, rpc, costosRaw] = await Promise.all([
    traerTodo<any>(admin, "tiktok_ventas_diarias", "sku, fecha, unidades, ordenes, importe", (q) =>
      q.eq("account_id", accountId).gte("fecha", rango.desde).lte("fecha", rango.hasta),
    ),
    admin.rpc("tiktok_ventas_pedidos", { p_account: accountId, p_desde: desdeUtc, p_hasta: hastaUtc }),
    traerTodo<any>(admin, "productos_config", "modelo, costo_mxn", (q) => q.eq("account_id", accountId).not("costo_mxn", "is", null)),
  ]);
  if (rpc.error) throw new Error(`tiktok_ventas_pedidos: ${rpc.error.message}`);
  const ordenes: (OrdenParaVentas & { creador?: string | null; afiliadoLeido?: boolean; destinatario?: string | null })[] = (
    (rpc.data?.ordenes ?? []) as any[]
  ).map((o) => ({
    orderId: String(o.orderId),
    estado: o.estado ?? null,
    creadoEn: o.creadoEn ?? null,
    actualizadoEn: o.actualizadoEn ?? null,
    esMuestra: Boolean(o.esMuestra),
    netoRecibido: o.netoRecibido != null ? Number(o.netoRecibido) : null,
    pagoEsperado: o.pagoEsperado != null ? Number(o.pagoEsperado) : null,
    afiliado: o.afiliado != null ? Number(o.afiliado) : null,
    ...deDesglose({ ingreso: o.ingreso, anuncios: o.anuncios }, o.netoRecibido != null || o.pagoEsperado != null),
    destinatario: o.destinatario ?? null,
    creador: o.creador ?? null,
    afiliadoLeido: Boolean(o.afiliadoLeido),
  }));
  const renglones: (RenglonParaVentas & { sellerSku?: string | null })[] = ((rpc.data?.renglones ?? []) as any[]).map((i) => ({
    orderId: String(i.orderId),
    skuInterno: i.skuInterno ?? null,
    sellerSku: i.sellerSku ?? null,
    cantidad: Number(i.cantidad ?? 0) || 0,
    precio: i.precio != null ? Number(i.precio) : null,
    estado: i.estado ?? null,
  }));

  const unidades = (ventas ?? []).reduce((a, v) => a + (v.unidades ?? 0), 0);
  const modelosBase = resumenPorModelo(ordenes, renglones, rango);
  // La venta del rango es la del resumen (ingreso de TikTok, 11-oct-2026),
  // no la de los renglones diarios, que se rehacen cada 15 min.
  const importe = modelosBase.reduce((a, m) => a + m.cobrado, 0);
  const costoDe = new Map<string, number>();
  for (const c of costosRaw ?? []) {
    const modelo = String(c.modelo ?? "").toUpperCase();
    if (modelo && c.costo_mxn != null && !costoDe.has(modelo)) costoDe.set(modelo, Number(c.costo_mxn));
  }
  // «Cuánto me van a pagar» y «cuánto gano» salen del número de TikTok
  // (sus transacciones por pedido, liquidadas o por liquidar), nunca de una
  // estimación del ERP (decisión del dueño, 25-sep-2026).
  const modelos: ModeloConCosto[] = modelosBase.map((m) => {
    const costoUnitario = costoDe.get(m.modelo) ?? null;
    const costo = costoUnitario != null ? costoUnitario * m.unidadesConDato : null;
    const ganancia = costo != null && m.unidadesConDato > 0 ? m.aRecibir - costo : null;
    const pagaPorPar = m.unidadesConDato > 0 ? m.aRecibir / m.unidadesConDato : null;
    const gananciaPorPar = ganancia != null && m.unidadesConDato > 0 ? ganancia / m.unidadesConDato : null;
    return { ...m, costoUnitario, costo, ganancia, pagaPorPar, gananciaPorPar };
  });
  const gananciaTotal = modelos.reduce((a, m) => a + (m.ganancia ?? 0), 0);
  const hayGanancia = modelos.some((m) => m.ganancia != null);
  const sinCosto = modelos.filter((m) => m.costoUnitario == null).length;
  const aRecibir = modelos.reduce((a, m) => a + m.aRecibir, 0);
  const aRecibirLiquidado = modelos.reduce((a, m) => a + m.aRecibirLiquidado, 0);
  const aRecibirPorLiquidar = modelos.reduce((a, m) => a + m.aRecibirPorLiquidar, 0);
  const afiliados = modelos.reduce((a, m) => a + m.afiliado, 0);
  const cobradoConDato = modelos.reduce((a, m) => a + (m.cobrado - m.cobradoSinDato), 0);
  const cobradoSinDato = modelos.reduce((a, m) => a + m.cobradoSinDato, 0);
  const costoTotal = modelos.reduce((a, m) => a + (m.costo ?? 0), 0);
  const comision = cobradoConDato > 0 ? 1 - aRecibir / cobradoConDato : null;
  const paresConGanancia = modelos.reduce((a, m) => a + (m.ganancia != null ? m.unidadesConDato : 0), 0);
  const gananciaPorParTotal = paresConGanancia > 0 ? gananciaTotal / paresConGanancia : null;
  const enPie = pedidosDeVenta(ordenes, rango);
  const pedidosEnPie = enPie.length;
  const pedidosLiquidados = enPie.filter((o) => o.netoRecibido != null).length;
  const pedidosSinDato = enPie.filter((o) => o.netoRecibido == null && o.pagoEsperado == null).length;

  const skusPorPedido = new Map<string, string[]>();
  for (const i of renglones) {
    const lista = skusPorPedido.get(i.orderId) ?? [];
    lista.push(i.skuInterno ?? i.sellerSku ?? "(sin SKU)");
    skusPorPedido.set(i.orderId, lista);
  }
  const muestras: MuestraTikTok[] = muestrasEnRango(ordenes, rango).map((m) => ({
    orderId: m.orderId,
    creadoEn: m.creadoEn,
    estado: m.estado,
    destinatario: m.destinatario ?? null,
    skus: skusPorPedido.get(m.orderId) ?? [],
  }));
  const porEnviarRenglones = renglones.filter((i) => efectoDeEstado(i.estado) === "apartado");
  const porEnviar = { pedidos: new Set(porEnviarRenglones.map((i) => i.orderId)).size, pares: porEnviarRenglones.reduce((a, i) => a + i.cantidad, 0) };

  // Lo cancelado no se enseña (decisión del dueño, 25-sep-2026).
  const porEstado = new Map<string, number>();
  for (const o of ordenes) {
    const e = String(o.estado ?? "");
    if (e.toUpperCase().startsWith("CANCEL")) continue;
    porEstado.set(e, (porEstado.get(e) ?? 0) + 1);
  }

  return {
    rango,
    unidades,
    importe,
    modelos,
    totales: {
      gananciaTotal, hayGanancia, sinCosto, aRecibir, aRecibirLiquidado, aRecibirPorLiquidar, afiliados, cobradoConDato, cobradoSinDato, costoTotal,
      comision, paresConGanancia, gananciaPorParTotal, pedidosEnPie, pedidosLiquidados, pedidosSinDato, pedidosPorLiquidar: pedidosEnPie - pedidosLiquidados - pedidosSinDato,
    },
    origen: origenDeVentas(ordenes, renglones, rango),
    porEstado: [...porEstado].sort((a, b) => b[1] - a[1]),
    porEnviar,
    muestras,
    paresMuestra: muestras.reduce((a, m) => a + m.skus.length, 0),
  };
}

/** Calcula el rango y lo guarda (lo llama el fondo). */
export async function recalcularVentasTikTok(admin: DB, accountId: string, rango: { desde: string; hasta: string }): Promise<VentasTikTokMasticadas> {
  const t0 = Date.now();
  const datos = await calcularVentasTikTok(admin, accountId, rango);
  await guardarCacheApp(admin, accountId, claveVentasTikTok(rango), datos, Date.now() - t0);
  return datos;
}

/**
 * Lo que la pantalla lee: el renglón guardado tal cual (viejo o invalidado
 * se sirve y se declara); si no hay ninguno, se calcula y se guarda.
 */
export async function leerVentasTikTok(admin: DB, accountId: string, rango: { desde: string; hasta: string }): Promise<LecturaVentasTikTok> {
  const guardado = await leerCacheAppGuardado<VentasTikTokMasticadas>(admin, accountId, claveVentasTikTok(rango));
  if (guardado.estado === "encontrado" && guardado.valor.datos?.modelos) {
    const edad = Date.now() - Date.parse(guardado.valor.generadoEn);
    return { datos: guardado.valor.datos, generadoEn: guardado.valor.generadoEn, refrescar: !guardado.valor.vigente || edad > TTL_MS };
  }
  const datos = await recalcularVentasTikTok(admin, accountId, rango);
  return { datos, generadoEn: new Date().toISOString(), refrescar: false };
}
