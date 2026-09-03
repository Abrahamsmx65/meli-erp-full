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
  /** muestra gratis: se despacha pero no es venta */
  esMuestra?: boolean;
  /** lo que TikTok liquidó por el pedido; null = todavía no */
  netoRecibido?: number | null;
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
    if (o.esMuestra) continue;
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

// ---------------------------------------------------------------------------
// Resumen por MODELO, con lo cobrado y lo recibido
// ---------------------------------------------------------------------------

/** "GT134-BLK-24-MX" → "GT134". El modelo es la primera pieza del SKU. */
export function modeloDeSku(sku: string): string {
  return String(sku ?? "").trim().split("-")[0].toUpperCase();
}

export interface ResumenModelo {
  modelo: string;
  unidades: number;
  pedidos: number;
  /** precio de venta al cliente */
  cobrado: number;
  /** lo que TikTok ya liquidó, repartido entre los renglones del pedido */
  recibido: number;
  /** pedidos del modelo que todavía no liquida TikTok */
  sinLiquidar: number;
  /** cobrado de los pedidos ya liquidados, para leer la comisión real */
  cobradoLiquidado: number;
  tallas: { sku: string; unidades: number; cobrado: number; recibido: number }[];
}

/**
 * Ventas del rango por modelo. El neto de un pedido se reparte entre sus
 * renglones en proporción al precio (un pedido con dos modelos le da a cada
 * uno su parte). Las muestras y lo cancelado o sin pagar no entran.
 */
export function resumenPorModelo(
  ordenes: OrdenParaVentas[],
  renglones: RenglonParaVentas[],
  rango: { desde: string; hasta: string },
): ResumenModelo[] {
  const ordenesValidas = new Map<string, OrdenParaVentas>();
  for (const o of ordenes) {
    if (NO_CUENTAN.has(String(o.estado ?? "").toUpperCase()) || o.esMuestra) continue;
    const base = o.creadoEn ?? o.actualizadoEn;
    if (!base) continue;
    const dia = diaMx(base);
    if (dia < rango.desde || dia > rango.hasta) continue;
    ordenesValidas.set(o.orderId, o);
  }

  const porOrden = new Map<string, RenglonParaVentas[]>();
  for (const r of renglones) {
    if (!ordenesValidas.has(r.orderId) || !r.skuInterno) continue;
    if (NO_CUENTAN.has(String(r.estado ?? "").toUpperCase())) continue;
    const lista = porOrden.get(r.orderId);
    if (lista) lista.push(r);
    else porOrden.set(r.orderId, [r]);
  }

  const modelos = new Map<string, ResumenModelo & { pedidosSet: Set<string>; sinLiquidarSet: Set<string>; tallasMap: Map<string, ResumenModelo["tallas"][number]> }>();
  const de = (modelo: string) => {
    let m = modelos.get(modelo);
    if (!m) {
      m = { modelo, unidades: 0, pedidos: 0, cobrado: 0, recibido: 0, sinLiquidar: 0, cobradoLiquidado: 0, tallas: [], pedidosSet: new Set(), sinLiquidarSet: new Set(), tallasMap: new Map() };
      modelos.set(modelo, m);
    }
    return m;
  };

  for (const [orderId, lista] of porOrden) {
    const o = ordenesValidas.get(orderId) as OrdenParaVentas;
    const cobradoOrden = lista.reduce((a, r) => a + (r.precio ?? 0) * r.cantidad, 0);
    const unidadesOrden = lista.reduce((a, r) => a + r.cantidad, 0);
    const liquidado = o.netoRecibido != null;
    for (const r of lista) {
      const cobrado = (r.precio ?? 0) * r.cantidad;
      // La parte del neto que le toca al renglón: por precio; si el pedido
      // no tiene precios, por unidades.
      const parte = cobradoOrden > 0 ? cobrado / cobradoOrden : unidadesOrden > 0 ? r.cantidad / unidadesOrden : 0;
      const recibido = liquidado ? (o.netoRecibido as number) * parte : 0;
      const m = de(modeloDeSku(r.skuInterno as string));
      m.unidades += r.cantidad;
      m.cobrado += cobrado;
      m.recibido += recibido;
      if (liquidado) m.cobradoLiquidado += cobrado;
      m.pedidosSet.add(orderId);
      if (!liquidado) m.sinLiquidarSet.add(orderId);
      const t = m.tallasMap.get(r.skuInterno as string) ?? { sku: r.skuInterno as string, unidades: 0, cobrado: 0, recibido: 0 };
      t.unidades += r.cantidad;
      t.cobrado += cobrado;
      t.recibido += recibido;
      m.tallasMap.set(t.sku, t);
    }
  }

  return [...modelos.values()]
    .map(({ pedidosSet, sinLiquidarSet, tallasMap, ...m }) => ({
      ...m,
      pedidos: pedidosSet.size,
      sinLiquidar: sinLiquidarSet.size,
      tallas: [...tallasMap.values()].sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true })),
    }))
    .sort((a, b) => b.unidades - a.unidades || a.modelo.localeCompare(b.modelo));
}

/** Los pedidos que SÍ son venta dentro del rango: pagados, no cancelados, no muestra. */
export function pedidosDeVenta<T extends OrdenParaVentas>(ordenes: T[], rango: { desde: string; hasta: string }): T[] {
  return ordenes.filter((o) => {
    if (NO_CUENTAN.has(String(o.estado ?? "").toUpperCase()) || o.esMuestra) return false;
    const base = o.creadoEn ?? o.actualizadoEn;
    if (!base) return false;
    const dia = diaMx(base);
    return dia >= rango.desde && dia <= rango.hasta;
  });
}

/** Las solicitudes de muestra del rango, para verlas aparte de las ventas. */
export function muestrasEnRango<T extends OrdenParaVentas>(ordenes: T[], rango: { desde: string; hasta: string }): T[] {
  return ordenes
    .filter((o) => {
      if (!o.esMuestra) return false;
      const base = o.creadoEn ?? o.actualizadoEn;
      if (!base) return false;
      const dia = diaMx(base);
      return dia >= rango.desde && dia <= rango.hasta;
    })
    .sort((a, b) => String(b.creadoEn ?? "").localeCompare(String(a.creadoEn ?? "")));
}
