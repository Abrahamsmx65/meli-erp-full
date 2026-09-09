/**
 * Lo que la cascada de dinero necesita de UNA orden de Mercado Libre, tal
 * como la devuelve `/orders/{id}` u `/orders/search`.
 *
 * Funciones puras: leen el JSON de MELI y devuelven el contexto con el que
 * `resumirPagosMeli` decide reventa, comisión mínima y envío del vendedor.
 * También recortan la orden a los campos que de verdad se usan, para
 * guardarla junto al pago y poder recalcular después sin volver a MELI.
 */

export interface PagoEnOrden {
  id?: number;
  status?: string;
  order_id?: number;
  transaction_amount?: number;
  total_paid_amount?: number;
  shipping_cost?: number;
  taxes_amount?: number;
}

export interface RenglonEnOrden {
  quantity?: number;
  unit_price?: number;
  full_unit_price?: number;
  /** null mientras MELI no lo publica; null en TODOS = reventa (pasadas 24 h) */
  sale_fee?: number | null;
  listing_type_id?: string;
  item?: {
    id?: string;
    title?: string;
    category_id?: string;
    variation_id?: number | string | null;
    seller_sku?: string | null;
    seller_custom_field?: string | null;
  };
}

/** La orden de MELI, solo con lo que se lee de ella. */
export interface OrdenMeliCruda {
  id: number;
  status?: string;
  date_created: string;
  date_closed?: string | null;
  pack_id?: number | null;
  currency_id?: string;
  total_amount?: number;
  paid_amount?: number;
  tags?: string[];
  static_tags?: string[];
  coupon?: { amount?: number; id?: string | null } | null;
  shipping?: { id?: number | null } | null;
  context?: { site?: string } | null;
  payments?: PagoEnOrden[];
  order_items?: RenglonEnOrden[];
}

/** Marcador oficial del plan de reventa ("A cargo de Mercado Libre"). */
export const ETIQUETA_REVENTA = "meli_resale";

/** Horas que hay que esperar para creer los respaldos (sale_fee null, comisión incompleta). */
export const HORAS_ASENTAMIENTO = 24;

/**
 * Lo que la orden aporta a la cascada. `staticTags` en `undefined` significa
 * que NO se leyó la orden (filas viejas): entonces la reventa se decide con
 * el respaldo de siempre (neto ≥ 99 % del total sin cargos).
 */
export interface ContextoOrden {
  staticTags?: string[];
  /** todos los renglones vinieron con sale_fee null (respaldo de reventa, solo pasadas 24 h) */
  todosSaleFeeNulos?: boolean;
  /** horas desde que se creó la orden */
  edadHoras?: number;
  /** Σ shipping_cost de los pagos aprobados: lo que el comprador pagó de envío */
  envioComprador?: number;
  /** senders[].cost de /shipments/{id}/costs; null = no se pudo leer */
  envioVendedor?: number | null;
  /** order.paid_amount */
  pagado?: number;
  packId?: number | null;
  shippingId?: number | null;
  /** para reconstruir la reventa por renglón (tarifa por categoría) */
  renglones?: RenglonParaCascada[];
}

export interface RenglonParaCascada {
  sku?: string;
  unidades: number;
  importe: number;
  categoria?: string | null;
  listing?: string | null;
  /** la tarifa de /sites/MLM/listing_prices ya consultada para este renglón */
  tarifa?: { porcentaje: number; fijo: number } | null;
}

const numero = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : Number(x) || 0);

export function esReventaPorEtiqueta(staticTags: string[] | undefined | null): boolean {
  return Array.isArray(staticTags) && staticTags.includes(ETIQUETA_REVENTA);
}

/** Envío pagado por el comprador: Σ shipping_cost de los pagos aprobados. */
export function envioDelComprador(o: OrdenMeliCruda): number {
  let suma = 0;
  for (const p of o.payments ?? []) {
    if (p.status && p.status !== "approved" && p.status !== "refunded") continue;
    suma += numero(p.shipping_cost);
  }
  return Math.round(suma * 100) / 100;
}

/** Horas transcurridas desde que se creó la orden. */
export function edadEnHoras(o: OrdenMeliCruda, ahoraMs: number): number {
  const creada = Date.parse(o.date_created);
  if (!Number.isFinite(creada)) return Infinity;
  return Math.max(0, (ahoraMs - creada) / 3_600_000);
}

/** El contexto que la cascada necesita, sin envío del vendedor ni tarifas (esos son I/O). */
export function contextoDeOrden(o: OrdenMeliCruda, ahoraMs: number): ContextoOrden {
  const renglones = o.order_items ?? [];
  return {
    staticTags: Array.isArray(o.static_tags) ? o.static_tags : [],
    todosSaleFeeNulos: renglones.length > 0 && renglones.every((r) => r.sale_fee == null),
    edadHoras: edadEnHoras(o, ahoraMs),
    envioComprador: envioDelComprador(o),
    pagado: numero(o.paid_amount),
    packId: o.pack_id ?? null,
    shippingId: o.shipping?.id ?? null,
  };
}

/**
 * La orden recortada a lo que se usa, para guardarla junto al pago. Sin
 * comprador ni datos personales: solo dinero, etiquetas, envío y renglones.
 */
export function recortarOrden(o: OrdenMeliCruda): Record<string, unknown> {
  return {
    id: o.id,
    status: o.status ?? null,
    date_created: o.date_created,
    date_closed: o.date_closed ?? null,
    pack_id: o.pack_id ?? null,
    currency_id: o.currency_id ?? null,
    total_amount: o.total_amount ?? null,
    paid_amount: o.paid_amount ?? null,
    tags: o.tags ?? [],
    static_tags: o.static_tags ?? [],
    coupon: o.coupon ?? null,
    shipping_id: o.shipping?.id ?? null,
    site: o.context?.site ?? null,
    payments: (o.payments ?? []).map((p) => ({
      id: p.id ?? null,
      status: p.status ?? null,
      order_id: p.order_id ?? null,
      transaction_amount: p.transaction_amount ?? null,
      total_paid_amount: p.total_paid_amount ?? null,
      shipping_cost: p.shipping_cost ?? null,
      taxes_amount: p.taxes_amount ?? null,
    })),
    order_items: (o.order_items ?? []).map((r) => ({
      item_id: r.item?.id ?? null,
      variation_id: r.item?.variation_id ?? null,
      seller_sku: r.item?.seller_sku ?? r.item?.seller_custom_field ?? null,
      category_id: r.item?.category_id ?? null,
      listing_type_id: r.listing_type_id ?? null,
      quantity: r.quantity ?? null,
      unit_price: r.unit_price ?? null,
      full_unit_price: r.full_unit_price ?? null,
      sale_fee: r.sale_fee ?? null,
    })),
  };
}

/** Banda de precio de la tarifa de MELI (la tarifa fija cambia en $149 y $299). */
export function bandaDeTarifa(precio: number): "menos149" | "menos299" | "desde299" {
  if (precio < 149) return "menos149";
  if (precio < 299) return "menos299";
  return "desde299";
}
