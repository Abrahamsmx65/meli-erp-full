/**
 * Las transacciones de finanzas de UN pedido de TikTok, leídas tal cual
 * (motor puro). TikTok las publica desde que el pedido va en camino: cada
 * transacción trae `settlement_amount` (lo que le va a pagar al vendedor
 * por ese pedido: ingreso − comisión − afiliados − envío − retenciones) y
 * un `status` que dice si ya la liquidó (SETTLED) o todavía no. Con la
 * versión 202501 del endpoint llegan también las NO liquidadas; la 202309
 * solo traía las liquidadas.
 *
 * Decisión del dueño (25-sep-2026): el ERP NO estima. Lo que se enseña
 * como «a recibir» es este número, el de TikTok, liquidado o no; y las
 * comisiones a afiliados se sacan aparte porque también las cobra TikTok.
 */

export interface TransaccionesPedido {
  /** lo que TikTok paga (o va a pagar) por el pedido: Σ settlement_amount */
  pago: number;
  /** true si TODAS las transacciones ya están liquidadas */
  liquidado: boolean;
  /** los `status` distintos que traen las transacciones */
  estados: string[];
  transacciones: number;
  /** lo que pagó el cliente (Σ customer_payment_amount, o revenue) */
  ingreso: number | null;
  /** Σ fee_amount (todos los cargos juntos, con impuestos), en positivo */
  cargos: number | null;
  /** la comisión de TikTok propiamente (porcentaje + cargo por par), en positivo; 0 si la respuesta no la desglosa */
  comision: number;
  /** comisiones a afiliados/creadores (todas las variantes), en positivo */
  afiliado: number;
  /** envío a cargo del vendedor ya neto del subsidio de TikTok, en positivo */
  envio: number;
  /** IVA retenido, en positivo */
  ivaRetenido: number;
  /** ISR retenido, en positivo */
  isrRetenido: number;
  /** reembolsos al cliente y ajustes, en positivo (bajan el pago) */
  reembolsos: number;
  statementId: string | null;
  /** cuándo TikTok liquidó (ISO), si ya lo hizo */
  liquidadoEn: string | null;
  moneda: string | null;
}

function numero(x: unknown): number | null {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Las llaves de comisión a afiliados/creadores. En la 202309 van en el
 * renglón; en la 202501 dentro de `fee_tax_breakdown.fee`. `_deposit` y
 * `_release` NO se suman: son el apartado y la liberación de la misma
 * comisión, no un cargo más.
 */
const CAMPOS_AFILIADO = [
  "affiliate_commission_amount",
  "affiliate_partner_commission_amount",
  "affiliate_ads_commission_amount",
  "external_affiliate_marketing_fee_amount",
  "brand_amplification_program_commission",
  "auto_post_shoppable_video_commission_fee",
];
/** La comisión de TikTok propiamente (202501, `fee_tax_breakdown.fee`). */
const CAMPOS_COMISION = ["sfp_service_fee_amount", "platform_commission_amount", "dynamic_commission_amount", "referral_fee_amount", "tsp_commission_amount"];

function numeroEn(t: any, ruta: string[]): number | null {
  let x = t;
  for (const k of ruta) x = x?.[k];
  return numero(x);
}

/** Suma un campo por todos los renglones, buscándolo en la raíz del renglón o en `fee_tax_breakdown.fee/.tax`. */
function sumaDe(lista: any[], campo: string): number | null {
  let hay = false;
  let total = 0;
  for (const t of lista) {
    const n = numero(t?.[campo]) ?? numeroEn(t, ["fee_tax_breakdown", "fee", campo]) ?? numeroEn(t, ["fee_tax_breakdown", "tax", campo]);
    if (n == null) continue;
    hay = true;
    total += n;
  }
  return hay ? total : null;
}

/** La lista de transacciones venga como venga (202309: `statement_transactions`; 202501: `sku_transactions`). */
export function listaDeTransacciones(d: any): any[] {
  if (!d || typeof d !== "object") return [];
  for (const llave of ["sku_transactions", "statement_transactions", "transactions", "unsettled_transactions", "order_transactions"]) {
    if (Array.isArray(d[llave])) return d[llave];
  }
  // Una llave desconocida cuyos elementos traigan settlement_amount también sirve.
  for (const v of Object.values(d)) {
    if (Array.isArray(v) && v.some((x) => x && typeof x === "object" && "settlement_amount" in x)) return v;
  }
  return [];
}

function esLiquidada(t: any): boolean {
  const s = String(t?.status ?? t?.settlement_status ?? "").trim().toUpperCase();
  if (s) return s === "SETTLED" || s === "PAID";
  // Sin estado: una transacción ya dentro de un estado de cuenta (statement_id) está liquidada.
  return Boolean(String(t?.statement_id ?? "").trim());
}

/**
 * Interpreta la respuesta de finanzas de un pedido (202309 o 202501).
 * null = TikTok todavía no tiene transacciones de ese pedido (sin dato) o
 * no contestó nada usable. Nunca inventa: solo suma lo que TikTok mandó.
 * Una DEVOLUCIÓN entra como transacción con ingreso negativo, y el pago
 * del pedido puede quedar negativo: TikTok no regresa la comisión.
 */
export function interpretarTransacciones(d: any): TransaccionesPedido | null {
  const lista = listaDeTransacciones(d);
  if (!lista.length) return null;
  const suma = sumaDe(lista, "settlement_amount");
  // La 202501 trae el total del pedido arriba; si está, es el que manda.
  const pago = numero(d?.settlement_amount) ?? suma;
  if (pago == null) return null;
  const estados = [...new Set(lista.map((t) => String(t?.status ?? t?.settlement_status ?? "").trim().toUpperCase()).filter(Boolean))];
  const liquidado = lista.every(esLiquidada);
  const afiliado = CAMPOS_AFILIADO.reduce((a, c) => a + (sumaDe(lista, c) ?? 0), 0);
  const comision = CAMPOS_COMISION.reduce((a, c) => a + (sumaDe(lista, c) ?? 0), 0) + (sumaDe(lista, "fee_per_item_sold_amount") ?? 0);
  // Envío: la 202501 lo trae ya neto del subsidio en `shipping_cost_amount`;
  // la 202309 en bruto (fbm) más el descuento.
  const envio202501 = sumaDe(lista, "shipping_cost_amount");
  const envio = envio202501 != null && lista.some((t) => t?.fee_tax_breakdown)
    ? envio202501
    : (sumaDe(lista, "fbm_shipping_cost_amount") ?? 0) + (sumaDe(lista, "shipping_cost_discount_amount") ?? 0);
  const iva = (sumaDe(lista, "iva_vat_amount") ?? 0) + (sumaDe(lista, "iva_amount") ?? 0);
  const isr = (sumaDe(lista, "isr_income_tax_amount") ?? 0) + (sumaDe(lista, "isr_amount") ?? 0);
  // Reembolsos: en la 202309 vienen como campo; en la 202501 como
  // transacciones con ingreso negativo.
  const ingresosNegativos = lista.reduce((a, t) => a + Math.min(0, numero(t?.revenue_amount) ?? 0), 0);
  const reembolsos = (sumaDe(lista, "customer_refund_amount") ?? 0) + (sumaDe(lista, "adjustment_amount") ?? 0) + ingresosNegativos;
  const cargos = sumaDe(lista, "fee_amount") ?? sumaDe(lista, "fee_tax_amount") ?? numero(d?.fee_and_tax_amount);
  const primera = lista.find((t) => String(t?.statement_id ?? "").trim()) ?? lista[0];
  const statementTime = numero(primera?.statement_time);
  return {
    pago,
    liquidado,
    estados,
    transacciones: lista.length,
    ingreso: sumaDe(lista, "customer_payment_amount") ?? numero(d?.revenue_amount) ?? sumaDe(lista, "revenue_amount"),
    cargos: cargos == null ? null : Math.abs(cargos),
    comision: Math.abs(comision),
    afiliado: Math.abs(afiliado),
    envio: Math.abs(envio),
    ivaRetenido: Math.abs(iva),
    isrRetenido: Math.abs(isr),
    reembolsos: Math.abs(reembolsos),
    statementId: String(primera?.statement_id ?? "").trim() || null,
    liquidadoEn: liquidado && statementTime ? new Date(statementTime * 1000).toISOString() : null,
    moneda: d?.currency ?? primera?.currency ?? null,
  };
}

/** Cómo se guarda el pedido según lo que contestó TikTok. */
export type EstadoPago = "liquidado" | "por_liquidar" | "sin_dato";

export function estadoDePago(t: TransaccionesPedido | null): EstadoPago {
  if (!t) return "sin_dato";
  return t.liquidado ? "liquidado" : "por_liquidar";
}
