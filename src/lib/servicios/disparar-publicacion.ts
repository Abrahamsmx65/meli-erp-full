/**
 * Prende el siguiente ESLABÓN de la publicación en TikTok.
 *
 * Mismo mecanismo que `disparar-etiquetas.ts`: publicar un producto son
 * varias fotos (~1 s cada una en TikTok) más la creación, y una cola de 50
 * modelos no cabe en los 5 minutos de una función. La ruta que encola
 * trabaja lo que le alcanza en `after()` y le pasa la estafeta a
 * `POST /api/tiktok/publicar-productos?cuenta=…&eslabon=n` con el bearer de
 * CRON_SECRET; esa ruta contesta 202, trabaja ~280 s y, si todavía hay
 * pendientes y avanzó, prende el siguiente.
 */
export const MAX_ESLABONES_PUBLICACION = 48;

export async function dispararPublicacionTikTok(origen: string, accountId: string, eslabon: number): Promise<boolean> {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error("dispararPublicacionTikTok: falta CRON_SECRET; la cola la termina el cron de TikTok.");
    return false;
  }
  try {
    const url = `${origen}/api/tiktok/publicar-productos?cuenta=${encodeURIComponent(accountId)}&eslabon=${eslabon}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secreto}` },
      signal: AbortSignal.timeout(10_000),
    });
    return r.status === 202;
  } catch (err) {
    console.error("dispararPublicacionTikTok:", (err as Error).message);
    return false;
  }
}
