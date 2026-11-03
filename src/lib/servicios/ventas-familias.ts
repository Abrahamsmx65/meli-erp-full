/**
 * Lo vendido por SKU para Existencias por familia: los últimos 30 días y
 * desde que el ERP registra, de MELI calzado, Amazon y TikTok, en dos
 * llamadas a `inicio_ventas_skus` (migración 0149). La de toda la historia
 * tarda ~1.5 s (Amazon barre su tabla), así que va MASTICADA en `app_cache`
 * y la pantalla lee el renglón; el fondo lo refresca cada 15 min.
 */
import type { DB } from "../datos/repos";
import { cuentaAmazon } from "./amazon";
import { fechaMx } from "./ventas-monitor";
import type { FilaVentaSku } from "./familias-existencias";

export const CLAVE_VENTAS_FAMILIAS = "existencias:ventas-sku:v1";
export const EDAD_VENTAS_FAMILIAS_MS = 15 * 60_000;
/** Desde cuándo se le pide «toda la historia» al RPC. */
const FONDO_HISTORIA = "2020-01-01";

export interface VentasParaFamilias {
  desde30: string;
  hasta: string;
  d30: FilaVentaSku[];
  hist: FilaVentaSku[];
  /** primer día con venta registrada por canal; null = sin ventas */
  desdeCanal: { meli: string | null; amazon: string | null; tiktok: string | null };
}

async function primerDia(q: PromiseLike<{ data: any; error: any }>): Promise<string | null> {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  const f = r.data?.[0]?.fecha;
  return f ? String(f).slice(0, 10) : null;
}

export async function calcularVentasParaFamilias(db: DB, accountId: string): Promise<VentasParaFamilias> {
  const hoy = fechaMx(0);
  const desde30 = fechaMx(29);
  const amz = await cuentaAmazon(db).catch(() => null);
  const pedir = async (desde: string): Promise<FilaVentaSku[]> => {
    const r = await db.rpc("inicio_ventas_skus", {
      p_meli: accountId,
      p_amazon: amz?.id ?? null,
      p_yz: null,
      p_desde: desde,
      p_hasta: hoy,
    });
    if (r.error) throw new Error(`inicio_ventas_skus: ${r.error.message}`);
    return (r.data ?? []) as FilaVentaSku[];
  };
  const [d30, hist, meli, amazon, tiktok] = await Promise.all([
    pedir(desde30),
    pedir(FONDO_HISTORIA),
    primerDia(
      db.from("ventas_dia_sku").select("fecha").eq("account_id", accountId).eq("canal", "meli_calzado").gt("unidades", 0).order("fecha").limit(1),
    ).catch(() => null),
    amz
      ? primerDia(db.from("amazon_ventas_diarias").select("fecha").eq("account_id", amz.id).gt("unidades", 0).order("fecha").limit(1)).catch(
          () => null,
        )
      : Promise.resolve(null),
    primerDia(db.from("tiktok_ventas_diarias").select("fecha").eq("account_id", accountId).gt("unidades", 0).order("fecha").limit(1)).catch(
      () => null,
    ),
  ]);
  return { desde30, hasta: hoy, d30, hist, desdeCanal: { meli, amazon, tiktok } };
}
