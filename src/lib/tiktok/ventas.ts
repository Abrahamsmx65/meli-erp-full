/**
 * Ventas por SKU y día de TikTok, a partir de los pedidos guardados.
 *
 * Se RECONSTRUYE completo cada vez, no se acumula por ventana: una corrida
 * que solo ve los pedidos de sus últimos 15 minutos no puede saber cuánto
 * se vendió en el resto del día, y si escribe el renglón del día con lo
 * que vio, lo deja corto. Con unos cientos de pedidos al mes, rehacer todo
 * cuesta menos que un solo renglón mal.
 *
 * El día es el de MÉXICO (UTC−6 fijo, igual que `fechaMx` en el monitor de
 * MELI): un pedido de las 20:19 del día 1 es del día 1, no del 2 en UTC.
 */

/** ISO → "YYYY-MM-DD" en hora de México (UTC−6, sin horario de verano). */
export function diaMx(iso: string): string {
  return new Date(Date.parse(iso) - 6 * 3_600_000).toISOString().slice(0, 10);
}

/** Lo que nunca cuenta como venta: sin pagar o cancelado. */
const NO_CUENTAN = new Set(["UNPAID", "CANCELLED", "CANCEL"]);

export interface OrdenParaVentas {
  orderId: string;
  estado: string | null;
  creadoEn: string | null;
  actualizadoEn?: string | null;
}

export interface RenglonParaVentas {
  orderId: string;
  skuInterno: string | null;
  cantidad: number;
  precio: number | null;
  estado: string | null;
}

export interface VentaDiariaTikTok {
  sku: string;
  fecha: string;
  unidades: number;
  ordenes: number;
  importe: number;
}

export function agregarVentasDiarias(
  ordenes: OrdenParaVentas[],
  renglones: RenglonParaVentas[],
): VentaDiariaTikTok[] {
  const diaDeOrden = new Map<string, string>();
  for (const o of ordenes) {
    if (NO_CUENTAN.has(String(o.estado ?? "").toUpperCase())) continue;
    const base = o.creadoEn ?? o.actualizadoEn;
    if (!base) continue;
    diaDeOrden.set(o.orderId, diaMx(base));
  }

  const acumulado = new Map<string, { unidades: number; ordenes: Set<string>; importe: number }>();
  for (const r of renglones) {
    const fecha = diaDeOrden.get(r.orderId);
    if (!fecha || !r.skuInterno) continue;
    if (NO_CUENTAN.has(String(r.estado ?? "").toUpperCase())) continue;
    const clave = `${r.skuInterno}|${fecha}`;
    const acc = acumulado.get(clave) ?? { unidades: 0, ordenes: new Set<string>(), importe: 0 };
    acc.unidades += r.cantidad;
    acc.ordenes.add(r.orderId);
    acc.importe += (r.precio ?? 0) * r.cantidad;
    acumulado.set(clave, acc);
  }

  return [...acumulado]
    .map(([clave, acc]) => {
      const i = clave.lastIndexOf("|");
      return { sku: clave.slice(0, i), fecha: clave.slice(i + 1), unidades: acc.unidades, ordenes: acc.ordenes.size, importe: acc.importe };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sku.localeCompare(b.sku));
}
