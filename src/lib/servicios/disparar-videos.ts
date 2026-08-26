/**
 * Lanza el proceso que revisa los videos en curso con Higgsfield.
 *
 * Igual que disparar-pendientes: el proceso contesta 202 de inmediato y
 * trabaja después de responder, así que esta espera es corta y los errores
 * se tragan — si no prendió, el botón de actualizar o el cron lo relanzan.
 */
export async function dispararVideos(origen: string): Promise<void> {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return;

  try {
    await fetch(`${origen}/api/videos/procesar`, {
      method: "POST",
      headers: { authorization: `Bearer ${secreto}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Sin drama: el proceso también se enciende desde la página de Videos.
  }
}
