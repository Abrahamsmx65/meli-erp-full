/**
 * Reclamos y devoluciones de una orden de MELI (post-purchase):
 *   GET /post-purchase/v1/claims/search?resource=order&resource_id={orden}
 *   GET /post-purchase/v2/claims/{claim}/returns   (estado del retorno, dinero, cantidades)
 *   GET /post-purchase/v1/returns/{retorno}/reviews (revisión en el almacén de Full)
 *
 * Regla del dueño (9-sep-2026): el costo de un par devuelto solo se
 * recupera si el par VOLVIÓ A LA VENTA; si MELI lo descartó o nunca
 * regresó, es merma. Quién absorbió el reembolso ya lo dice el pago
 * (`transaction_amount_refunded`): si MELI lo pagó de su bolsa, el pago
 * no se toca y la venta cuenta completa. Nada se estima: sin revisión
 * leída, el costo NO se recupera y el corte lo declara.
 */
import type { MeliClient } from "./client";

export type DestinoDevolucion = "a_la_venta" | "descartado" | "no_devuelto" | "sin_revision";

export interface ReclamoLeido {
  reclamoId: number;
  tipo: string | null;
  estado: string | null;
  etapa: string | null;
  razon: string | null;
  resolucion: Record<string, unknown> | null;
  beneficiado: string[];
  /** estado del retorno físico (delivered, shipped, cancelled…) */
  devolucionEstado: string | null;
  /** status_money del retorno (refunded, retained…) */
  devolucionDinero: string | null;
  /** pares devueltos por SKU, según el retorno */
  devolucionRenglones: { sku: string | null; unidades: number; itemId: string | null; variationId: number | null }[];
  destino: DestinoDevolucion;
  crudo: { reclamo: unknown; retorno: unknown; revision: unknown };
}

const texto = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});

/**
 * Qué decidió el almacén con el par devuelto. Forma real (sonda del
 * 9-sep-2026, retorno 157986832 de la orden 2000018121101480):
 *   { reviews: [{ method: "triage", resource_reviews: [{ stage: "closed",
 *     status: "success", product_condition: "saleable",
 *     product_destination: "seller", … }] }] }
 * "saleable" → volvió a la venta; cualquier otra condición leída
 * (damaged, unsaleable…) → descartado; sin revisión → "sin_revision"
 * (nunca se supone a la venta).
 */
export function destinoDeRevision(revision: unknown, retorno: unknown): DestinoDevolucion {
  const r = obj(retorno);
  const estadoRetorno = texto(r.status);
  if (estadoRetorno && /cancel|expired|not_delivered|failed/i.test(estadoRetorno)) return "no_devuelto";
  const rev = obj(revision);
  if (!revision || "error" in rev) return "sin_revision";
  const reviews = Array.isArray(rev.reviews) ? rev.reviews : [];
  const condiciones: string[] = [];
  for (const x of reviews) {
    const rr = Array.isArray(obj(x).resource_reviews) ? (obj(x).resource_reviews as unknown[]) : [];
    for (const y of rr) {
      const c = texto(obj(y).product_condition);
      if (c) condiciones.push(c.toLowerCase());
    }
  }
  if (condiciones.length === 0) return "sin_revision";
  return condiciones.every((c) => /^(saleable|sellable|new|good)$/.test(c)) ? "a_la_venta" : "descartado";
}

/** Interpreta claim + retorno + revisión (función pura). */
export function interpretarReclamo(
  reclamo: unknown,
  retorno: unknown,
  revision: unknown,
  skuDe: (itemId: string | null, variationId: number | null) => string | null,
): ReclamoLeido {
  const c = obj(reclamo);
  const r = obj(retorno);
  const res = c.resolution && typeof c.resolution === "object" ? (c.resolution as Record<string, unknown>) : null;
  const renglones = (Array.isArray(r.orders) ? r.orders : []).map((o) => {
    const x = obj(o);
    const itemId = texto(x.item_id);
    const variationId = x.variation_id == null ? null : Number(x.variation_id);
    return { sku: skuDe(itemId, variationId), unidades: Number(x.return_quantity) || 0, itemId, variationId };
  });
  return {
    reclamoId: Number(c.id),
    tipo: texto(c.type),
    estado: texto(c.status),
    etapa: texto(c.stage),
    razon: texto(c.reason_id),
    resolucion: res,
    beneficiado: Array.isArray(res?.benefited) ? (res!.benefited as string[]) : [],
    devolucionEstado: texto(r.status),
    devolucionDinero: texto(r.status_money),
    devolucionRenglones: renglones,
    destino: retorno && !("error" in r) ? destinoDeRevision(revision, retorno) : "no_devuelto",
    crudo: { reclamo, retorno, revision },
  };
}

/** Los reclamos de una orden con su retorno y revisión. Vacío si no hay. */
export async function leerReclamosDeOrden(
  cliente: MeliClient,
  orderId: number,
  skuDe: (itemId: string | null, variationId: number | null) => string | null,
): Promise<ReclamoLeido[]> {
  const busqueda = await cliente.get<{ data?: unknown[] }>(`/post-purchase/v1/claims/search?resource=order&resource_id=${orderId}`, undefined, { reintentos: 1 });
  const lista = Array.isArray(busqueda?.data) ? busqueda.data : [];
  const salida: ReclamoLeido[] = [];
  for (const reclamo of lista) {
    const id = Number(obj(reclamo).id);
    if (!id) continue;
    let retorno: unknown = null;
    let revision: unknown = null;
    try {
      retorno = await cliente.get<unknown>(`/post-purchase/v2/claims/${id}/returns`, undefined, { reintentos: 0 });
    } catch (err) {
      retorno = { error: (err as Error).message.slice(0, 120) };
    }
    const retornoId = Number(obj(retorno).id);
    if (retorno && !("error" in obj(retorno)) && retornoId) {
      try {
        revision = await cliente.get<unknown>(`/post-purchase/v1/returns/${retornoId}/reviews`, undefined, { reintentos: 0 });
      } catch {
        revision = null;
      }
    }
    salida.push(interpretarReclamo(reclamo, retorno, revision, skuDe));
  }
  return salida;
}

/** Columnas de ordenes_neto / yz_ordenes_neto a partir de los reclamos leídos. */
export function columnasDeReclamos(reclamos: ReclamoLeido[]): Record<string, unknown> {
  // Manda el reclamo de devolución más reciente; sin reclamos, se deja constancia de la lectura.
  const principal = [...reclamos].sort((a, b) => b.reclamoId - a.reclamoId).find((r) => r.tipo === "returns") ?? reclamos[0] ?? null;
  return {
    reclamo_id: principal?.reclamoId ?? null,
    reclamo_tipo: principal?.tipo ?? null,
    reclamo_estado: principal?.estado ?? null,
    reclamo_resolucion: principal?.resolucion ?? null,
    devolucion_estado: principal?.devolucionEstado ?? null,
    devolucion_dinero: principal?.devolucionDinero ?? null,
    devolucion_renglones: principal?.devolucionRenglones.map((r) => ({ sku: r.sku, unidades: r.unidades })) ?? null,
    devolucion_destino: principal ? principal.destino : null,
    reclamo_crudo: reclamos.map((r) => r.crudo),
    reclamo_leido_en: new Date().toISOString(),
  };
}

/** item+variación → SKU, con los renglones de la orden cruda guardada. */
export function skuDesdeOrdenCruda(orden: unknown): (itemId: string | null, variationId: number | null) => string | null {
  const items = (Array.isArray(obj(orden).order_items) ? (obj(orden).order_items as unknown[]) : []).map((x) => {
    const it = obj(obj(x).item);
    return { itemId: texto(it.id), variationId: it.variation_id == null ? null : Number(it.variation_id), sku: texto(it.seller_sku) ?? texto(obj(x).seller_sku) };
  });
  return (itemId, variationId) => {
    const exacto = items.find((i) => i.itemId === itemId && (variationId == null || i.variationId === variationId));
    if (exacto?.sku) return exacto.sku;
    if (items.length === 1) return items[0].sku;
    return null;
  };
}
