/**
 * Una variante de MELI con DOS nombres de SKU (mismo `inventory_id`).
 *
 * MELI deja editar el SELLER_SKU y el catálogo se guarda por (cuenta, SKU),
 * así que la misma variante vive como "GT134-BLK-BLK-25-MX" (activo, donde
 * caen las ventas) y "GT134-BLK / BLK-25-MX" (apagado, pero el que escribe
 * el sync diario de stock). El plan solo lee los activos: veía la talla
 * vendiendo SIN stock (Full 0, sin fotos) y le inflaba la demanda; los 49
 * pares reales colgaban del nombre apagado. El 21-oct-2026 eran 52
 * variantes y 1,324 pares (GT134, GT125, GT104, GT204, G650, YH816).
 *
 * Aquí todo lo del nombre apagado se pasa al ACTIVO que comparte su
 * `inventory_id`:
 *  - stock actual: gana la lectura MÁS RECIENTE (`actualizadoEn`); no se
 *    suma, es la misma existencia leída dos veces;
 *  - fotos diarias: por fecha, gana la del nombre cuya lectura de stock es
 *    la más reciente (la fuente viva); la otra solo llena huecos;
 *  - ventas y operaciones: se SUMAN, son eventos distintos.
 */
import type { OperacionStock, SnapshotStock, StockFull, VentaDiaria } from "../engine/types";

export interface StockConFecha extends StockFull {
  actualizadoEn?: string | null;
}

/**
 * sku apagado → sku activo, por `inventory_id`. Solo cuando hay UN activo
 * con ese inventario: con dos activos no se adivina.
 */
export function aliasPorInventario(
  activos: { sku: string; inventoryId: string | null }[],
  apagados: { sku: string; inventoryId: string | null }[],
): Map<string, string> {
  const activoPorInv = new Map<string, string | null>();
  for (const a of activos) {
    if (!a.inventoryId) continue;
    activoPorInv.set(a.inventoryId, activoPorInv.has(a.inventoryId) ? null : a.sku);
  }
  const alias = new Map<string, string>();
  const activosSet = new Set(activos.map((a) => a.sku));
  for (const p of apagados) {
    if (!p.inventoryId || activosSet.has(p.sku)) continue;
    const destino = activoPorInv.get(p.inventoryId);
    if (destino && destino !== p.sku) alias.set(p.sku, destino);
  }
  return alias;
}

export interface DatosUnidos {
  stockActual: StockFull[];
  snapshots: SnapshotStock[];
  ventas: VentaDiaria[];
  operaciones: OperacionStock[];
}

export function unirPorInventario(
  alias: Map<string, string>,
  d: {
    stockActual: StockConFecha[];
    snapshots: SnapshotStock[];
    ventas: VentaDiaria[];
    operaciones: OperacionStock[];
  },
): DatosUnidos {
  const limpiar = (s: StockConFecha): StockFull => ({
    sku: s.sku,
    disponible: s.disponible,
    enTransferencia: s.enTransferencia,
    noDisponible: s.noDisponible,
    total: s.total,
  });
  if (!alias.size) {
    return { ...d, stockActual: d.stockActual.map(limpiar) };
  }
  const destino = (sku: string) => alias.get(sku) ?? sku;
  const ms = (f: string | null | undefined) => (f ? Date.parse(f) || 0 : 0);

  // Stock: por destino, la lectura más reciente. Se recuerda de qué nombre
  // salió: ese es la fuente viva para las fotos.
  const stock = new Map<string, { fila: StockConFecha; fuente: string }>();
  for (const s of d.stockActual) {
    const k = destino(s.sku);
    const prev = stock.get(k);
    if (!prev || ms(s.actualizadoEn) > ms(prev.fila.actualizadoEn)) {
      stock.set(k, { fila: s, fuente: s.sku });
    }
  }
  const fuenteViva = new Map<string, string>();
  for (const [k, v] of stock) fuenteViva.set(k, v.fuente);

  const snaps = new Map<string, SnapshotStock>();
  for (const s of d.snapshots) {
    const k = destino(s.sku);
    const llave = `${k}|${s.fecha}`;
    const prev = snaps.get(llave);
    const esViva = fuenteViva.get(k) === s.sku;
    if (!prev || esViva) snaps.set(llave, { ...s, sku: k });
  }

  const ventas = new Map<string, VentaDiaria>();
  for (const v of d.ventas) {
    const k = destino(v.sku);
    const llave = `${k}|${v.fecha}`;
    const prev = ventas.get(llave);
    if (!prev) {
      ventas.set(llave, { ...v, sku: k });
      continue;
    }
    prev.unidades += v.unidades;
    if (v.ordenes != null) prev.ordenes = (prev.ordenes ?? 0) + v.ordenes;
    if (v.importe != null) prev.importe = (prev.importe ?? 0) + v.importe;
  }

  return {
    stockActual: [...stock.entries()].map(([k, v]) => ({ ...limpiar(v.fila), sku: k })),
    snapshots: [...snaps.values()],
    ventas: [...ventas.values()],
    operaciones: d.operaciones.map((o) => ({ ...o, sku: destino(o.sku) })),
  };
}
