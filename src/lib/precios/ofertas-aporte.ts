/**
 * Ofertas CON APORTE de Mercado Libre (dueño, 19-oct-2026: «un sistema para
 * aceptar todas las ofertas con aporte de Mercado Libre que cumplen los
 * criterios de Números para precio normal»; automático y solo calzado).
 *
 * Motor puro: decide, oferta por oferta, si se acepta.
 *  - Con aporte, MELI le cobra al vendedor como si vendiera a
 *    precio + aporte, así que lo que se compara contra el PV NORMAL de
 *    Números es precio de la oferta + aporte de MELI.
 *  - Si el precio al cliente queda abajo de $299 pero con el aporte cruza
 *    los $299, el vendedor paga el envío: se resta el envío de Números y
 *    se acepta solo si aun así cumple. Si el PV normal ya está en $299 o
 *    más, ese envío ya se paga al precio normal y no se resta otra vez.
 *  - Relámpago, Buen Fin y «todos los días» son de «Llevar precios» de
 *    Números y del cron de relámpagos: aquí no se tocan.
 */

import { UMBRAL_ENVIO_VENDEDOR, clasificarPromo, type PromoMeli } from "./promociones";

/** Tipos de promoción de MELI que traen aporte y se aceptan tal cual. */
export const TIPOS_CON_APORTE = ["SMART", "PRICE_MATCHING", "MARKETPLACE_CAMPAIGN", "UNHEALTHY_STOCK", "PRE_NEGOTIATED"] as const;

/** Tipos que se aceptan con el `offer_id` de la oferta. */
const TIPOS_CON_OFERTA = new Set(["SMART", "PRICE_MATCHING", "UNHEALTHY_STOCK", "PRE_NEGOTIATED"]);

/** Una promoción de la lista del vendedor (`/seller-promotions/users/{id}`). */
export interface PromocionMeli {
  id?: string | null;
  type?: string | null;
  status?: string | null;
  name?: string | null;
  start_date?: string | null;
  finish_date?: string | null;
  deadline_date?: string | null;
  benefits?: { type?: string | null; meli_percent?: number | null; seller_percent?: number | null } | null;
}

/** Una publicación invitada (`/seller-promotions/promotions/{id}/items`). */
export interface ItemDeOferta {
  id?: string | null;
  status?: string | null;
  price?: number | null;
  original_price?: number | null;
  offer_id?: string | null;
  meli_percentage?: number | null;
  seller_percentage?: number | null;
  start_date?: string | null;
  end_date?: string | null;
}

export type DecisionOferta = "aceptar" | "aceptada" | "no_cumple" | "sin_aporte" | "sin_precio" | "sin_datos" | "no_es_de_aqui";

export interface RenglonOferta {
  itemId: string;
  modelo: string | null;
  promoId: string;
  tipo: string;
  nombre: string;
  estado: string;
  offerId: string | null;
  /** lo que paga el cliente */
  precio: number | null;
  original: number | null;
  /** lo que pone MELI, en pesos */
  aporte: number | null;
  /** precio + aporte − envío (si lo hay) */
  efectivo: number | null;
  /** envío que se paga por cruzar los $299 con el aporte */
  envioExtra: number;
  pvNormal: number | null;
  inicio: string | null;
  fin: string | null;
  decision: DecisionOferta;
  motivo: string;
}

export interface ObjetivoOferta {
  pvNormal: number | null;
  /** envío por par de Números (real o estimado) */
  envio: number;
}

const num = (x: unknown): number | null => {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

const centavos = (x: number) => Math.round(x * 100);
const pesos = (x: number) => `$${x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function esTipoConAporte(tipo: string | null | undefined): boolean {
  return (TIPOS_CON_APORTE as readonly string[]).includes((tipo ?? "").toUpperCase());
}

/** Inscrita ya (MELI la tiene corriendo o programada). */
export function yaAceptada(estado: string | null | undefined): boolean {
  return ["started", "pending", "active", "programmed"].includes((estado ?? "").toLowerCase());
}

/** Lo que pone MELI en pesos: por renglón y, si no viene, el % de la promoción. */
export function aporteDe(item: ItemDeOferta, promo: PromocionMeli): number | null {
  const original = num(item.original_price);
  const pct = num(item.meli_percentage) ?? num(promo.benefits?.meli_percent);
  if (original == null || original <= 0 || pct == null) return null;
  return Math.round(original * pct) / 100;
}

export function decidirOferta(
  item: ItemDeOferta,
  promo: PromocionMeli,
  modelo: string | null,
  objetivo: ObjetivoOferta | null,
): RenglonOferta {
  const tipo = (promo.type ?? "").toUpperCase();
  const precio = num(item.price);
  const original = num(item.original_price);
  const aporte = aporteDe(item, promo);
  const base: RenglonOferta = {
    itemId: String(item.id ?? ""),
    modelo,
    promoId: String(promo.id ?? ""),
    tipo,
    nombre: promo.name ?? tipo,
    estado: item.status ?? "",
    offerId: item.offer_id ?? null,
    precio,
    original,
    aporte,
    efectivo: null,
    envioExtra: 0,
    pvNormal: objetivo?.pvNormal ?? null,
    inicio: item.start_date ?? promo.start_date ?? null,
    fin: item.end_date ?? promo.finish_date ?? null,
    decision: "sin_datos",
    motivo: "",
  };
  const conMotivo = (decision: DecisionOferta, motivo: string): RenglonOferta => ({ ...base, decision, motivo });

  if (!esTipoConAporte(tipo) || clasificarPromo(promo as PromoMeli) != null) {
    return conMotivo("no_es_de_aqui", "Relámpago, Buen Fin y todos los días van por Números");
  }
  if (yaAceptada(item.status)) return conMotivo("aceptada", "Ya está dentro");
  if (!modelo) return conMotivo("sin_datos", "La publicación no es de un modelo de calzado conocido");
  if (objetivo?.pvNormal == null) return conMotivo("sin_precio", `${modelo} sin PV normal en Números`);
  if (precio == null || precio <= 0) return conMotivo("sin_datos", "MELI no mandó el precio de la oferta");
  if (aporte == null) return conMotivo("sin_datos", "MELI no mandó su aporte");
  // «Acelera tus ventas de Full» (UNHEALTHY_STOCK) llegó el 19-oct-2026 con
  // meli_percentage 0: todo el descuento lo pone el vendedor. No es de aquí.
  if (aporte <= 0) {
    const tuyo = num(item.seller_percentage);
    return conMotivo("sin_aporte", `MELI no pone nada${tuyo != null ? `: el ${tuyo} % de descuento es tuyo` : ""}`);
  }
  if (TIPOS_CON_OFERTA.has(tipo) && !item.offer_id) return conMotivo("sin_datos", "MELI no mandó el folio de la oferta");

  const pv = objetivo.pvNormal;
  const cruza = precio < UMBRAL_ENVIO_VENDEDOR && precio + aporte >= UMBRAL_ENVIO_VENDEDOR && pv < UMBRAL_ENVIO_VENDEDOR;
  const envioExtra = cruza ? Math.max(0, objetivo.envio) : 0;
  const efectivo = Math.round((precio + aporte - envioExtra) * 100) / 100;
  const r = { ...base, efectivo, envioExtra };
  const detalle = `${pesos(precio)} + ${pesos(aporte)} de MELI${envioExtra ? ` − ${pesos(envioExtra)} de envío` : ""} = ${pesos(efectivo)}`;
  if (centavos(efectivo) >= centavos(pv)) {
    return { ...r, decision: "aceptar", motivo: `${detalle} ≥ ${pesos(pv)} de PV normal` };
  }
  return { ...r, decision: "no_cumple", motivo: `${detalle} < ${pesos(pv)} de PV normal` };
}

/** Cuerpo del POST para aceptar la oferta en MELI. */
export function cuerpoParaAceptar(r: RenglonOferta): Record<string, string> {
  const cuerpo: Record<string, string> = { promotion_id: r.promoId, promotion_type: r.tipo };
  if (TIPOS_CON_OFERTA.has(r.tipo) && r.offerId) cuerpo.offer_id = r.offerId;
  return cuerpo;
}

const ORDEN: Record<DecisionOferta, number> = { aceptar: 0, no_cumple: 1, sin_precio: 2, sin_datos: 3, aceptada: 4, sin_aporte: 5, no_es_de_aqui: 6 };

export function ordenarOfertas(r: RenglonOferta[]): RenglonOferta[] {
  return [...r].sort(
    (a, b) =>
      ORDEN[a.decision] - ORDEN[b.decision] ||
      (a.modelo ?? "").localeCompare(b.modelo ?? "", "es", { numeric: true }) ||
      a.itemId.localeCompare(b.itemId) ||
      a.promoId.localeCompare(b.promoId),
  );
}
