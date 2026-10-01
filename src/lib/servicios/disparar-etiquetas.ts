/**
 * Prende el siguiente ESLABÓN del armado de etiquetas de un corte.
 *
 * Una función de Vercel vive 5 minutos y TikTok entrega las guías a
 * cuentagotas: un corte de 600 pedidos necesita más de lo que le queda a
 * la ruta del corte después de confirmar. Así que el corte trabaja lo que
 * le alcanza y le pasa la estafeta a
 * `POST /api/tiktok/cortes/{id}/calentar?cuenta=…&eslabon=n` con el bearer
 * de CRON_SECRET; esa ruta contesta 202 en el acto, trabaja sus ~280 s en
 * `after()` y, si todavía falta y hubo avance, prende el eslabón siguiente.
 * Mismo mecanismo que `disparar-publicacion.ts`.
 *
 * El origen lo decide `origenDeLaApp` (el dominio de producción que Vercel
 * reporta): hasta el 1-oct-2026 se mandaba a `NEXT_PUBLIC_APP_URL`, un
 * dominio detrás de la autenticación de Vercel, y NINGÚN eslabón llegó
 * jamás. Por eso cada disparo deja constancia en `tiktok_sync_log`
 * (tarea `etiquetas-disparo`, con el status que contestó): si vuelve a
 * fallar, se ve en la bitácora y no hay que adivinarlo. De todos modos el
 * cron de cada minuto (`/api/cron/tiktok-etiquetas`) termina lo que el
 * eslabón no haga.
 */
export interface ResultadoDisparoEtiquetas {
  ok: boolean;
  status: number | null;
  error: string | null;
  url: string;
}

export async function dispararEtiquetasDelCorte(
  origen: string,
  accountId: string,
  corteId: number,
  eslabon: number,
): Promise<ResultadoDisparoEtiquetas> {
  const secreto = process.env.CRON_SECRET;
  const url = `${origen.replace(/\/+$/, "")}/api/tiktok/cortes/${corteId}/calentar?cuenta=${encodeURIComponent(accountId)}&eslabon=${eslabon}`;
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

/** Dispara y deja constancia en la bitácora (tarea `etiquetas-disparo`). */
export async function dispararEtiquetasYAnotar(
  admin: any,
  origen: string,
  accountId: string,
  corteId: number,
  eslabon: number,
): Promise<boolean> {
  const inicio = new Date().toISOString();
  const r = await dispararEtiquetasDelCorte(
    origen,
    accountId,
    corteId,
    eslabon,
  );
  try {
    await admin.from("tiktok_sync_log").insert({
      account_id: accountId,
      tarea: "etiquetas-disparo",
      inicio,
      fin: new Date().toISOString(),
      estado: r.ok ? "ok" : "error",
      detalle: {
        corteId,
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
