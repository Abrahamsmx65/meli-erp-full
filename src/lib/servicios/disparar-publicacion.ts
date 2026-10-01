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

export interface ResultadoDisparo {
  ok: boolean;
  status: number | null;
  error: string | null;
  url: string;
}

/**
 * Dispara el eslabón y CONTESTA qué pasó (no solo true/false): el 30-sep-2026
 * la cola avanzaba solo con cada clic y el cron, sin un solo eslabón en la
 * bitácora, y no había cómo saber si el POST llegaba. Quien llama lo anota
 * en `tiktok_sync_log` (tarea `publicar-disparo`).
 */
export async function dispararPublicacionTikTok(
  origen: string,
  accountId: string,
  eslabon: number,
): Promise<ResultadoDisparo> {
  const secreto = process.env.CRON_SECRET;
  const url = `${origen.replace(/\/+$/, "")}/api/tiktok/publicar-productos?cuenta=${encodeURIComponent(accountId)}&eslabon=${eslabon}`;
  if (!secreto)
    return { ok: false, status: null, error: "falta CRON_SECRET", url };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secreto}` },
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
    const ok = r.status === 202;
    return {
      ok,
      status: r.status,
      error: ok ? null : (await r.text().catch(() => "")).slice(0, 200),
      url,
    };
  } catch (err) {
    return { ok: false, status: null, error: (err as Error).message, url };
  }
}

/** Dispara y deja constancia en la bitácora. */
export async function dispararYAnotar(
  admin: any,
  origen: string,
  accountId: string,
  eslabon: number,
): Promise<boolean> {
  const inicio = new Date().toISOString();
  const r = await dispararPublicacionTikTok(origen, accountId, eslabon);
  try {
    await admin.from("tiktok_sync_log").insert({
      account_id: accountId,
      tarea: "publicar-disparo",
      inicio,
      fin: new Date().toISOString(),
      estado: r.ok ? "ok" : "error",
      detalle: {
        eslabon,
        ...r,
        url: r.url.replace(/cuenta=[^&]+/, "cuenta=…"),
      },
    });
  } catch {
    /* la bitácora no tumba nada */
  }
  return r.ok;
}
