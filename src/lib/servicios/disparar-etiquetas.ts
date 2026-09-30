/**
 * Prende el siguiente ESLABÓN del armado de etiquetas de un corte.
 *
 * Una función de Vercel vive 5 minutos y TikTok entrega ~1 guía por
 * segundo: un corte de 600 pedidos necesita ~10 minutos seguidos de
 * descarga, más que lo que le queda a la ruta del corte después de
 * confirmar. Así que el corte trabaja lo que le alcanza y le pasa la
 * estafeta a `POST /api/tiktok/cortes/{id}/calentar?cuenta=…&eslabon=n`
 * con el bearer de CRON_SECRET; esa ruta contesta 202 en el acto, trabaja
 * sus ~280 s en `after()` y, si todavía falta y hubo avance, prende el
 * eslabón siguiente. Mismo mecanismo que `disparar-pendientes.ts`.
 * Decisión del dueño (30-sep-2026): «no necesita un cron cada 5, solo que
 * después de confirmar el corte se hagan y se guarden ahí».
 */
export async function dispararEtiquetasDelCorte(origen: string, accountId: string, corteId: number, eslabon: number): Promise<boolean> {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error("dispararEtiquetasDelCorte: falta CRON_SECRET; las etiquetas las termina la pantalla o el cron de TikTok.");
    return false;
  }
  try {
    const url = `${origen}/api/tiktok/cortes/${corteId}/calentar?cuenta=${encodeURIComponent(accountId)}&eslabon=${eslabon}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secreto}` },
      signal: AbortSignal.timeout(10_000),
    });
    return r.status === 202;
  } catch (err) {
    console.error("dispararEtiquetasDelCorte: no prendió:", (err as Error).message);
    return false;
  }
}
