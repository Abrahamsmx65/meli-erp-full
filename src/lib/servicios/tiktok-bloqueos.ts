/**
 * Bloqueos del corte: marcar renglones que NO se confirman (la parte que
 * habla con la base). Las reglas puras están en `tiktok/bloqueos.ts`.
 */
import { traerTodo, type DB } from "../datos/repos";
import { efectoDeEstado } from "../tiktok/kardex";
import { renglonesDelSku, type RenglonBloqueable } from "../tiktok/bloqueos";
import { pendientesDeCorte } from "./tiktok-despacho";

export interface RenglonPendiente extends RenglonBloqueable {
  orderId: string;
  motivo: string | null;
}

/** Los renglones de los pedidos que entrarían al siguiente corte, con su bloqueo. */
export async function renglonesPendientes(db: DB, accountId: string): Promise<RenglonPendiente[]> {
  const pendientes = await pendientesDeCorte(db, accountId);
  const ids = pendientes.map((p) => p.orderId);
  if (!ids.length) return [];
  const filas = await traerTodo<any>(
    db,
    "tiktok_orden_items",
    "order_id, line_item_id, sku_id, sku_interno, seller_sku, cantidad, estado, bloqueado_en, bloqueo_motivo, bloqueo_resuelto_en",
    (q) => q.eq("account_id", accountId).in("order_id", ids),
  );
  return (filas ?? []).map((i: any) => aRenglon(i));
}

export function aRenglon(i: any): RenglonPendiente {
  return {
    orderId: String(i.order_id),
    lineItemId: String(i.line_item_id),
    skuId: i.sku_id ? String(i.sku_id) : null,
    sku: String(i.sku_interno ?? i.seller_sku ?? "(sin SKU)"),
    cantidad: Number(i.cantidad ?? 1),
    estado: i.estado ?? null,
    bloqueado: Boolean(i.bloqueado_en) && !i.bloqueo_resuelto_en,
    motivo: i.bloqueo_motivo ?? null,
  };
}

export interface ResumenBloqueos {
  /** SKUs con pedidos por despachar, para elegir cuál bloquear */
  pendientes: { sku: string; pedidos: number; pares: number; bloqueados: number }[];
  /** los bloqueos vivos, uno por renglón */
  bloqueos: { orderId: string; lineItemId: string; sku: string; cantidad: number; motivo: string | null }[];
}

export async function resumenBloqueos(db: DB, accountId: string): Promise<ResumenBloqueos> {
  const renglones = await renglonesPendientes(db, accountId);
  const porSku = new Map<string, { sku: string; pedidos: Set<string>; pares: number; bloqueados: number }>();
  for (const r of renglones) {
    if (efectoDeEstado(r.estado) === "reversa") continue;
    const acc = porSku.get(r.sku) ?? { sku: r.sku, pedidos: new Set<string>(), pares: 0, bloqueados: 0 };
    acc.pedidos.add(r.orderId);
    acc.pares += r.cantidad;
    if (r.bloqueado) acc.bloqueados += r.cantidad;
    porSku.set(r.sku, acc);
  }
  return {
    pendientes: [...porSku.values()]
      .map((x) => ({ sku: x.sku, pedidos: x.pedidos.size, pares: x.pares, bloqueados: x.bloqueados }))
      .sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true })),
    bloqueos: renglones
      .filter((r) => r.bloqueado && efectoDeEstado(r.estado) !== "reversa")
      .map((r) => ({ orderId: r.orderId, lineItemId: r.lineItemId, sku: r.sku, cantidad: r.cantidad, motivo: r.motivo }))
      .sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true }) || a.orderId.localeCompare(b.orderId)),
  };
}

async function marcar(admin: any, accountId: string, lineItemIds: string[], motivo: string, usuario?: string | null): Promise<number> {
  if (!lineItemIds.length) return 0;
  const { error } = await admin
    .from("tiktok_orden_items")
    .update({
      bloqueado_en: new Date().toISOString(),
      bloqueo_motivo: motivo,
      bloqueo_por: usuario ?? null,
      bloqueo_resultado: null,
      bloqueo_resuelto_en: null,
    })
    .eq("account_id", accountId)
    .in("line_item_id", lineItemIds);
  if (error) throw new Error(`No se pudo bloquear: ${error.message}`);
  return lineItemIds.length;
}

/** Bloquea TODOS los renglones vivos de ese SKU en los pedidos por despachar. */
export async function bloquearSku(admin: any, accountId: string, sku: string, motivo: string, usuario?: string | null) {
  const renglones = await renglonesPendientes(admin, accountId);
  const elegidos = renglonesDelSku(renglones, sku);
  const n = await marcar(admin, accountId, elegidos.map((r) => r.lineItemId), motivo, usuario);
  return { renglones: n, pedidos: new Set(elegidos.map((r) => r.orderId)).size };
}

/** Bloquea un renglón concreto (pedido + renglón). */
export async function bloquearRenglon(admin: any, accountId: string, lineItemId: string, motivo: string, usuario?: string | null) {
  const n = await marcar(admin, accountId, [lineItemId], motivo, usuario);
  return { renglones: n };
}

/** Quita el bloqueo (de un renglón, o de todos los de un SKU). */
export async function desbloquear(admin: any, accountId: string, opciones: { lineItemIds?: string[]; sku?: string }): Promise<number> {
  let ids = opciones.lineItemIds ?? [];
  if (opciones.sku) {
    const renglones = await renglonesPendientes(admin, accountId);
    const buscado = opciones.sku.trim().toUpperCase();
    ids = [...ids, ...renglones.filter((r) => r.bloqueado && r.sku.toUpperCase() === buscado).map((r) => r.lineItemId)];
  }
  if (!ids.length) return 0;
  const { error } = await admin
    .from("tiktok_orden_items")
    .update({ bloqueado_en: null, bloqueo_motivo: null, bloqueo_por: null, bloqueo_resultado: null, bloqueo_resuelto_en: null })
    .eq("account_id", accountId)
    .in("line_item_id", ids)
    .is("bloqueo_resuelto_en", null);
  if (error) throw new Error(`No se pudo quitar el bloqueo: ${error.message}`);
  return ids.length;
}

/** Deja constancia de cómo terminó el bloqueo en el corte. */
export async function resolverBloqueo(admin: any, accountId: string, lineItemIds: string[], resultado: string): Promise<void> {
  if (!lineItemIds.length) return;
  await admin
    .from("tiktok_orden_items")
    .update({ bloqueo_resultado: resultado.slice(0, 300), bloqueo_resuelto_en: resultado === "cancelado" ? new Date().toISOString() : null })
    .eq("account_id", accountId)
    .in("line_item_id", lineItemIds);
}
