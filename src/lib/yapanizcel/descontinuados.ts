/**
 * Descontinuados: SKUs que ya no se venden.
 *
 * Regla del dueño: un SKU sin UNA sola venta en los últimos 180 días (medio
 * año) se da por descontinuado: no se ofrece para mandar a Full ni se pide
 * a China, y no aparece en esas pantallas. Solo el SKU: su diseño (la
 * familia) sigue saliendo con los demás.
 *
 * Dos guardas para no matar lo que apenas nace o lo que no se puede juzgar:
 *   · una publicación con menos de 180 días de publicada no se descontinúa
 *     (todavía no tuvo tiempo de vender);
 *   · si el historial de ventas guardado no cubre 180 días todavía, no se
 *     descontinúa nadie: sin historial no hay veredicto.
 */
import type { DB } from "../datos/repos";
import { hoyMx, restarDias, todo } from "./db";

export const DIAS_SIN_VENTA = 180;

export interface Descontinuados {
  skus: Set<string>;
  /** false mientras el historial guardado no llegue a 180 días. */
  activo: boolean;
  /** desde cuándo hay ventas guardadas */
  historialDesde: string | null;
}

/** La regla, pura, para poder probarla. */
export function decidirDescontinuados(
  skus: { sku: string; publicadoEn: string | null }[],
  ultimaVenta: Map<string, string>,
  historialDesde: string | null,
  hoy: string,
  dias = DIAS_SIN_VENTA,
): Descontinuados {
  const corte = restarDias(hoy, dias);
  const activo = Boolean(historialDesde && historialDesde <= corte);
  const out = new Set<string>();
  if (activo) {
    for (const s of skus) {
      const publicada = s.publicadoEn ? s.publicadoEn.slice(0, 10) : null;
      if (publicada && publicada > corte) continue; // nueva: aún no se juzga
      const ultima = ultimaVenta.get(s.sku);
      if (!ultima || ultima < corte) out.add(s.sku);
    }
  }
  return { skus: out, activo, historialDesde };
}

export async function cargarDescontinuados(db: DB, accountId: string): Promise<Descontinuados> {
  const [skus, estado, ultimas] = await Promise.all([
    todo<{ sku: string; publicado_en: string | null }>(db, "yz_skus", "sku, publicado_en", (q) => q.eq("account_id", accountId)),
    db.from("yz_sync_estado").select("ventas_desde").eq("account_id", accountId).maybeSingle(),
    (async () => {
      const out: { sku: string; ultima_venta: string }[] = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await db.rpc("yz_ultima_venta", { p_account: accountId }).range(desde, desde + 999);
        if (error) throw new Error(`yz_ultima_venta: ${error.message}`);
        const lote = (data ?? []) as { sku: string; ultima_venta: string }[];
        out.push(...lote);
        if (lote.length < 1000) break;
      }
      return out;
    })(),
  ]);
  return decidirDescontinuados(
    skus.map((s) => ({ sku: s.sku, publicadoEn: s.publicado_en })),
    new Map(ultimas.map((u) => [u.sku, u.ultima_venta])),
    estado.data?.ventas_desde ?? null,
    hoyMx(),
  );
}
