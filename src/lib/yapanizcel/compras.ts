/**
 * Pedidos a China, por diseño.
 *
 * La pantalla muestra UN diseño a la vez (el 499, con todas sus variantes)
 * y para cada variante junta todo el inventario que existe —en Full, en
 * transferencia, en camino a Full, en bodega y en camino desde China— contra
 * su venta diaria. El objetivo es cubrir fábrica + barco + piso; lo que
 * falta es la sugerencia. No hay cajas ni corridas: se pide por unidad.
 */
import type { DB } from "../datos/repos";
import { mapaCostosUnificado, soloCostos } from "../servicios/costos-unificados";
import { guardarCacheYzLote, leerCacheYzGuardado } from "./cache";
import { costoDeSku } from "./costos";
import { cargarVentasAgregadas } from "./agregados";
import { cargarDescontinuados, type Descontinuados } from "./descontinuados";
import { hoyMx, restarDias, todo } from "./db";
import { cargarEnvios } from "./envios";
import { cargarInventarioAmarrado } from "./inventario";
import { leerParametros } from "./cuenta";
import { amarrar, construirIndice, desglosar, esCalzado, type IndiceSkus } from "./sku";

/** Días que se quieren cubrir con un pedido: producción + tránsito + piso. */
export const DIAS_OBJETIVO_PEDIDO = 30 + 30 + 60;

export interface VarianteCompra {
  skuMeli: string;
  titulo: string | null;
  modelo: string;
  color: string;
  vendidas30: number;
  ventaDiaria: number;
  enFull: number;
  enTransferencia: number;
  enCaminoFull: number;
  enBodega: number;
  /** Pedido a China ya cargado y sin recibir. */
  enCaminoChina: number;
  posicionTotal: number;
  cobertura: number;
  objetivo: number;
  sugerido: number;
  costoUnitario: number | null;
}

export interface DisenoCompra {
  /** cuándo se calculó (la pantalla lo declara: "datos de hace X min") */
  generadoEn?: string;
  diseno: string;
  variantes: VarianteCompra[];
  /** SKUs del diseño sin venta en 180 días: no se piden ni se muestran. */
  descontinuadas: string[];
  vendidas30: number;
  posicionTotal: number;
  sugerido: number;
  costoEstimado: number;
}

export interface ResumenDisenos {
  /** cuándo se calculó (la pantalla lo declara: "datos de hace X min") */
  generadoEn?: string;
  disenos: { diseno: string; variantes: number; descontinuadas: number; vendidas30: number; posicionTotal: number; sugerido: number; cobertura: number }[];
  descontinuados: {
    /** SKUs sin venta en 180 días (de diseños que siguen y de los retirados). */
    skus: number;
    /** Diseños retirados completos: ninguna variante vendió en 180 días. */
    disenos: number;
    activo: boolean;
    historialDesde: string | null;
  };
}

async function cargarBase(db: DB, accountId: string) {
  const p = await leerParametros(db, accountId);
  // Hasta AYER: hoy va a medias.
  const hasta = restarDias(hoyMx(), 1);
  const desde = restarDias(hasta, p.diasVenta - 1);

  const [skus, agregadas, stock, inventario, { enCamino }, mapeos, mapaUnificado, descontinuados] = await Promise.all([
    todo<{ sku: string; titulo: string | null; diseno: string | null; modelo: string | null; color: string | null }>(
      db, "yz_skus", "sku, titulo, diseno, modelo, color", (q) => q.eq("account_id", accountId),
    ),
    cargarVentasAgregadas(db, accountId, desde, hasta),
    todo<{ sku: string; disponible: number; en_transferencia: number }>(db, "yz_stock_full", "sku, disponible, en_transferencia", (q) => q.eq("account_id", accountId)),
    cargarInventarioAmarrado(db, accountId),
    cargarEnvios(db, accountId, p.diasCaducidadEnvio),
    todo<{ sku_bodega: string; sku_meli: string }>(db, "yz_mapeo_skus", "sku_bodega, sku_meli", (q) => q.eq("account_id", accountId)),
    // Costos de Productos y costos (calzado y fundas juntos); yz_costos de respaldo.
    mapaCostosUnificado(db, { yzAccountId: accountId }),
    cargarDescontinuados(db, accountId),
  ]);

  const indice = construirIndice(skus.map((s) => s.sku));
  const manual = new Map(mapeos.map((m) => [m.sku_bodega, m.sku_meli]));
  const porBodega = new Map(inventario.renglones.map((r) => [r.skuBodega, r.skuMeli]));
  const pedidos = await cargarPedidosEnCamino(db, accountId, { indice, manual, porBodega });

  const vendidas = agregadas.totales;
  const stockPor = new Map(stock.map((s) => [s.sku, s]));
  const caminoFull = new Map<string, number>();
  for (const c of enCamino) caminoFull.set(c.skuMeli, (caminoFull.get(c.skuMeli) ?? 0) + c.unidades);
  const costos = soloCostos(mapaUnificado);

  return { p, skus, vendidas, stockPor, inventario, caminoFull, pedidos, costos, descontinuados };
}

/**
 * Unidades pedidas a China y aún no recibidas, por SKU de MELI. Las líneas
 * del pedido van en SKU de bodega, así que pasan por el mismo amarre que el
 * sheet (y primero por lo que el sheet ya resolvió).
 */
export async function cargarPedidosEnCamino(
  db: DB,
  accountId: string,
  amarre: { indice: IndiceSkus; manual: Map<string, string>; porBodega: Map<string, string | null> },
): Promise<Map<string, number>> {
  const { data: cab } = await db
    .from("yz_pedidos")
    .select("id")
    .eq("account_id", accountId)
    .in("estado", ["creado", "en_camino"]);
  const ids = (cab ?? []).map((c) => c.id);
  if (!ids.length) return new Map();

  const lineas = await todo<{ sku_bodega: string; cantidad: number; recibido: number }>(
    db, "yz_pedido_lineas", "sku_bodega, cantidad, recibido", (q) => q.in("pedido_id", ids),
  );

  const out = new Map<string, number>();
  for (const l of lineas) {
    const pendiente = Math.max(0, (l.cantidad ?? 0) - (l.recibido ?? 0));
    if (!pendiente) continue;
    const skuMeli = amarre.porBodega.get(l.sku_bodega) ?? amarrar(l.sku_bodega, amarre.indice, amarre.manual).skuMeli;
    if (!skuMeli) continue;
    out.set(skuMeli, (out.get(skuMeli) ?? 0) + pendiente);
  }
  return out;
}

export type Base = Awaited<ReturnType<typeof cargarBase>>;

// ---------------------------------------------------------------------------
// El cálculo completo, UNA vez, masticado y guardado (yz_cache "compras")
// ---------------------------------------------------------------------------

export interface VarianteCalculada extends VarianteCompra {
  diseno: string;
  descontinuada: boolean;
}

/**
 * Todo lo que la pantalla de Pedidos a China y su Excel necesitan, ya
 * calculado: cada variante con su posición completa y su sugerido. De aquí
 * se DERIVAN el resumen por diseño, el detalle de un diseño y el Excel con
 * puros filtros y sumas — nada vuelve a leer la base.
 */
export interface ComprasCalculadas {
  generadoEn: string;
  diasVenta: number;
  descontinuados: { activo: boolean; historialDesde: string | null; disenos?: string[] };
  variantes: VarianteCalculada[];
}

/** Recorre las ~18 mil variantes UNA sola vez (antes eran 2-3 pasadas por render). */
export async function calcularCompras(db: DB, accountId: string): Promise<ComprasCalculadas> {
  const b = await cargarBase(db, accountId);
  return {
    generadoEn: new Date().toISOString(),
    diasVenta: b.p.diasVenta,
    descontinuados: {
      activo: b.descontinuados.activo,
      historialDesde: b.descontinuados.historialDesde,
      disenos: [...b.descontinuados.disenos].sort(),
    },
    variantes: b.skus.map((s) => ({
      ...calcularVariante(s, b),
      descontinuada: b.descontinuados.skus.has(s.sku),
    })),
  };
}

// ---------------------------------------------------------------------------
// Lo que lee la pantalla: vistas DERIVADAS, chiquitas, guardadas aparte
// ---------------------------------------------------------------------------
//
// El cálculo completo pesa ~6.5 MB (14 mil variantes con título): bajarlo
// de la base en cada clic era lo que tenía trabada la pantalla. Cuando se
// calcula, se guardan también el resumen por diseño ("compras:resumen") y
// el detalle de cada diseño ("compras:d:499"), y la pantalla lee SOLO el
// renglón que va a pintar. Caen todos juntos con "compras" (invalidarYz
// tumba la clave y sus derivadas) y el cron los vuelve a dejar listos.

const CLAVE_RESUMEN = "compras:resumen";
const claveDiseno = (diseno: string) => `compras:d:${diseno}`;

/** Las vistas derivadas de un cálculo, para guardarlas de un jalón. */
export function derivadasDeCompras(c: ComprasCalculadas): { clave: string; datos: unknown }[] {
  const resumen = resumenDesdeCompras(c);
  const filas: { clave: string; datos: unknown }[] = [{ clave: CLAVE_RESUMEN, datos: resumen }];
  for (const d of resumen.disenos) {
    const detalle = detalleDesdeCompras(c, d.diseno);
    if (detalle) filas.push({ clave: claveDiseno(d.diseno), datos: detalle });
  }
  return filas;
}

/**
 * El cálculo completo desde `yz_cache` (para el Excel de todos los diseños
 * y como respaldo). Se sirve el renglón guardado AUNQUE esté invalidado o
 * viejo — el cron de netos lo refresca solo; el clic nunca paga el cálculo.
 * Solo sin renglón (primera vez en la vida) se calcula aquí.
 */
export async function obtenerCompras(db: DB, accountId: string): Promise<ComprasCalculadas> {
  const guardado = await leerCacheYzGuardado<ComprasCalculadas>(db, accountId, "compras");
  if (guardado) return guardado.datos;
  return recalcularCompras(db, accountId);
}

/**
 * Calcula y guarda el completo y sus derivadas (lo llama el cron y el
 * respaldo sin renglón). Un solo vuelo por cuenta: si el resumen y el
 * detalle piden el recálculo al mismo tiempo (pasaba en la primera visita
 * y eran 20 s en vez de 10), comparten el mismo cálculo.
 */
const recalculosEnVuelo = new Map<string, Promise<ComprasCalculadas>>();

export async function recalcularCompras(db: DB, accountId: string): Promise<ComprasCalculadas> {
  const enVuelo = recalculosEnVuelo.get(accountId);
  if (enVuelo) return enVuelo;
  const p = (async () => {
    const t0 = Date.now();
    const c = await calcularCompras(db, accountId);
    const ms = Date.now() - t0;
    await guardarCacheYzLote(db, accountId, [{ clave: "compras", datos: c }, ...derivadasDeCompras(c)], ms);
    return c;
  })();
  recalculosEnVuelo.set(accountId, p);
  try {
    return await p;
  } finally {
    recalculosEnVuelo.delete(accountId);
  }
}

/** El resumen por diseño: el renglón chico guardado, aunque esté viejo. */
export async function obtenerResumenCompras(db: DB, accountId: string): Promise<ResumenDisenos> {
  const guardado = await leerCacheYzGuardado<ResumenDisenos>(db, accountId, CLAVE_RESUMEN);
  if (guardado) return guardado.datos;
  return resumenDesdeCompras(await recalcularCompras(db, accountId));
}

/** El detalle de UN diseño: su renglón guardado, aunque esté viejo. */
export async function obtenerDetalleCompras(db: DB, accountId: string, diseno: string): Promise<DisenoCompra | null> {
  const clave = diseno.trim().toUpperCase();
  if (!clave) return null;
  const guardado = await leerCacheYzGuardado<DisenoCompra>(db, accountId, claveDiseno(clave));
  if (guardado) return guardado.datos;
  // Sin renglón: o el diseño no existe (o está retirado), o nunca se ha
  // calculado. El resumen guardado lo dice sin bajar el completo.
  const resumen = await leerCacheYzGuardado<ResumenDisenos>(db, accountId, CLAVE_RESUMEN);
  if (resumen && !resumen.datos.disenos.some((d) => d.diseno === clave)) return null;
  return detalleDesdeCompras(await recalcularCompras(db, accountId), clave);
}

/** El resumen por diseño, derivado del cálculo guardado (puro). */
export function resumenDesdeCompras(c: ComprasCalculadas): ResumenDisenos {
  const porDiseno = new Map<string, { variantes: number; descontinuadas: number; vendidas30: number; posicionTotal: number; sugerido: number }>();
  let descontinuadas = 0;

  for (const v of c.variantes) {
    if (v.descontinuada) descontinuadas++;
    const d = v.diseno;
    // El calzado de esta cuenta no se pide desde aquí.
    if (!d || esCalzado(d)) continue;
    const acc = porDiseno.get(d) ?? { variantes: 0, descontinuadas: 0, vendidas30: 0, posicionTotal: 0, sugerido: 0 };
    // Un SKU descontinuado no se pide, pero su familia sigue saliendo.
    if (v.descontinuada) {
      acc.descontinuadas++;
      porDiseno.set(d, acc);
      continue;
    }
    acc.variantes++;
    acc.vendidas30 += v.vendidas30;
    acc.posicionTotal += v.posicionTotal;
    acc.sugerido += v.sugerido;
    porDiseno.set(d, acc);
  }

  // Un diseño retirado (ninguna variante vendió en 180 días: la regla lo
  // marca completo, con sus variantes nuevas) o con TODOS sus SKUs
  // descontinuados no se muestra: no hay nada que pedir de él.
  const retirados = [...porDiseno].filter(([, a]) => a.variantes === 0).length;
  const disenos = [...porDiseno]
    .filter(([, a]) => a.variantes > 0)
    .map(([diseno, a]) => ({
      diseno,
      ...a,
      cobertura: a.vendidas30 > 0 ? a.posicionTotal / (a.vendidas30 / c.diasVenta) : Infinity,
    }));

  disenos.sort((x, y) => x.diseno.localeCompare(y.diseno, "es", { numeric: true }));
  return {
    generadoEn: c.generadoEn,
    disenos,
    descontinuados: {
      skus: descontinuadas,
      disenos: retirados,
      activo: c.descontinuados.activo,
      historialDesde: c.descontinuados.historialDesde,
    },
  };
}

function calcularVariante(
  s: { sku: string; titulo: string | null; diseno: string | null; modelo: string | null; color: string | null },
  b: Awaited<ReturnType<typeof cargarBase>>,
): VarianteCompra & { diseno: string } {
  // Siempre se desglosa del SKU, no de lo guardado: lo guardado puede venir
  // de una versión vieja del desglose (con "N" como diseño).
  const d = desglosar(s.sku);
  const diseno = d.diseno;
  const vendidas30 = b.vendidas.get(s.sku) ?? 0;
  const ventaDiaria = vendidas30 / b.p.diasVenta;
  const st = b.stockPor.get(s.sku);
  const enFull = st?.disponible ?? 0;
  const enTransferencia = st?.en_transferencia ?? 0;
  const enCaminoFull = b.caminoFull.get(s.sku) ?? 0;
  const enBodega = b.inventario.porSkuMeli.get(s.sku) ?? 0;
  const enCaminoChina = b.pedidos.get(s.sku) ?? 0;
  const posicionTotal = enFull + enTransferencia + enCaminoFull + enBodega + enCaminoChina;
  const objetivo = ventaDiaria * DIAS_OBJETIVO_PEDIDO;
  const sugerido = Math.max(0, Math.ceil(objetivo - posicionTotal));

  return {
    diseno,
    skuMeli: s.sku,
    titulo: s.titulo,
    modelo: d.modelo,
    color: d.color,
    vendidas30,
    ventaDiaria,
    enFull,
    enTransferencia,
    enCaminoFull,
    enBodega,
    enCaminoChina,
    posicionTotal,
    cobertura: ventaDiaria > 0 ? posicionTotal / ventaDiaria : Infinity,
    objetivo,
    sugerido,
    costoUnitario: costoDeSku(s.sku, b.costos),
  };
}

/**
 * El detalle de un diseño, derivado del cálculo guardado (puro). Un diseño
 * retirado (sin una variante viva) no existe para la pantalla: null.
 */
export function detalleDesdeCompras(c: ComprasCalculadas, diseno: string): DisenoCompra | null {
  const clave = diseno.trim().toUpperCase();
  const delDiseno = c.variantes.filter((v) => v.diseno === clave);
  const descontinuadas = delDiseno.filter((v) => v.descontinuada).map((v) => v.skuMeli).sort();
  const variantes = delDiseno
    .filter((v) => !v.descontinuada)
    // Por modelo (con números en orden natural: i13, i14, i15pro…) y luego color.
    .sort(
      (x, y) =>
        x.modelo.localeCompare(y.modelo, "es", { numeric: true }) ||
        x.color.localeCompare(y.color, "es") ||
        x.skuMeli.localeCompare(y.skuMeli),
    );
  if (!variantes.length) return null;

  return {
    generadoEn: c.generadoEn,
    diseno: clave,
    variantes,
    descontinuadas,
    vendidas30: variantes.reduce((a, v) => a + v.vendidas30, 0),
    posicionTotal: variantes.reduce((a, v) => a + v.posicionTotal, 0),
    sugerido: variantes.reduce((a, v) => a + v.sugerido, 0),
    costoEstimado: variantes.reduce((a, v) => a + v.sugerido * (v.costoUnitario ?? 0), 0),
  };
}

/** Todas las variantes (sin calzado ni descontinuadas), para el Excel (puro). */
export function variantesParaExcel(c: ComprasCalculadas): VarianteCalculada[] {
  return c.variantes
    .filter((v) => !v.descontinuada && v.diseno && !esCalzado(v.diseno))
    .sort(
      (x, y) =>
        x.diseno.localeCompare(y.diseno, "es", { numeric: true }) ||
        x.modelo.localeCompare(y.modelo, "es", { numeric: true }) ||
        x.color.localeCompare(y.color, "es"),
    );
}
