import "server-only";
import { config } from "./config";

/**
 * Le avisa al ERP que la tienda apartó o soltó pares, para que le publique
 * a TikTok el número nuevo en ese momento (y no hasta el cron de 15 min).
 * Nunca tumba la venta: si el ERP no contesta, el cron lo corrige.
 */
export async function avisarErp(motivo: string): Promise<void> {
  const secreto = config.secretoErp();
  if (!secreto) return;
  try {
    await fetch(`${config.urlErp()}/api/tiktok/tienda/aviso`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secreto}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cuenta: config.cuenta(), motivo }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    /* el cron de TikTok del ERP publica cada 15 min de todos modos */
  }
}
