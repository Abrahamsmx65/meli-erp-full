/**
 * Lanza el proceso de SKUs pendientes.
 *
 * El proceso contesta 202 de inmediato y trabaja después de responder, así
 * que esta espera es corta. El timeout de 10 s es solo por si la función
 * tarda en arrancar en frío: abortar antes de tiempo la mataba sin que
 * llegara a ejecutarse, que es justo el error que hubo que corregir aquí.
 */
export async function dispararPendientes(origen: string): Promise<void> {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return;

  try {
    await fetch(`${origen}/api/meli/skus-pendientes`, {
      method: "POST",
      headers: { authorization: `Bearer ${secreto}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Si no prendió, el siguiente sync o el cron lo vuelven a intentar.
  }
}
