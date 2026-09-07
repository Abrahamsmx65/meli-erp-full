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
  disenos: { diseno: string; variantes: number; descontinuadas: number; vendidas30: number; posicionTotal: number; sugerido: number; cobertura: number }[];
  descontinuados: Descontinuados;
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

/** Una sola carga de base para toda la pantalla (resumen + detalle). */
export async function cargarBaseCompras(db: DB, accountId: string): Promise<Base> {
  return cargarBase(db, accountId);
}

export async function resumenDisenos(db: DB, accountId: string, base?: Base): Promise<ResumenDisenos> {
  const b = base ?? (await cargarBase(db, accountId));
  const porDiseno = new Map<string, { variantes: number; descontinuadas: number; vendidas30: number; posicionTotal: number; sugerido: number }>();

  for (const s of b.skus) {
    const v = calcularVariante(s, b);
    const d = v.diseno;
    // El calzado de esta cuenta no se pide desde aquí.
    if (!d || esCalzado(d)) continue;
    const acc = porDiseno.get(d) ?? { variantes: 0, descontinuadas: 0, vendidas30: 0, posicionTotal: 0, sugerido: 0 };
    // Un SKU descontinuado no se pide, pero su familia sigue saliendo.
    if (b.descontinuados.skus.has(s.sku)) {
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

  const disenos = [...porDiseno]
    // Una familia con TODOS sus SKUs descontinuados (las micas 5D que ya no
    // se venden) tampoco se muestra: no hay nada que pedir de ella.
    .filter(([, a]) => a.variantes > 0)
    .map(([diseno, a]) => ({
      diseno,
      ...a,
      cobertura: a.vendidas30 > 0 ? a.posicionTotal / (a.vendidas30 / b.p.diasVenta) : Infinity,
    }));
  // Los diseños sin ninguna publicación que venda ni existencia no estorban.
  
  disenos.sort((x, y) => x.diseno.localeCompare(y.diseno, "es", { numeric: true }));
  return { disenos, descontinuados: b.descontinuados };
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

export async function detalleDiseno(db: DB, accountId: string, diseno: string, base?: Base): Promise<DisenoCompra | null> {
  const b = base ?? (await cargarBase(db, accountId));
  const clave = diseno.trim().toUpperCase();
  const delDiseno = b.skus.map((s) => calcularVariante(s, b)).filter((v) => v.diseno === clave);
  const descontinuadas = delDiseno.filter((v) => b.descontinuados.skus.has(v.skuMeli)).map((v) => v.skuMeli).sort();
  const variantes = delDiseno
    .filter((v) => !b.descontinuados.skus.has(v.skuMeli))
    // Por modelo (con números en orden natural: i13, i14, i15pro…) y luego color.
    .sort(
      (x, y) =>
        x.modelo.localeCompare(y.modelo, "es", { numeric: true }) ||
        x.color.localeCompare(y.color, "es") ||
        x.skuMeli.localeCompare(y.skuMeli),
    );
  if (!variantes.length && !descontinuadas.length) return null;

  return {
    diseno: clave,
    variantes,
    descontinuadas,
    vendidas30: variantes.reduce((a, v) => a + v.vendidas30, 0),
    posicionTotal: variantes.reduce((a, v) => a + v.posicionTotal, 0),
    sugerido: variantes.reduce((a, v) => a + v.sugerido, 0),
    costoEstimado: variantes.reduce((a, v) => a + v.sugerido * (v.costoUnitario ?? 0), 0),
  };
}

/** Todas las variantes (sin calzado), para el Excel de todos los diseños. */
export function todasLasVariantes(b: Base): (VarianteCompra & { diseno: string })[] {
  return b.skus
    .filter((s) => !b.descontinuados.skus.has(s.sku))
    .map((s) => calcularVariante(s, b))
    .filter((v) => v.diseno && !esCalzado(v.diseno))
    .sort(
      (x, y) =>
        x.diseno.localeCompare(y.diseno, "es", { numeric: true }) ||
        x.modelo.localeCompare(y.modelo, "es", { numeric: true }) ||
        x.color.localeCompare(y.color, "es"),
    );
}
