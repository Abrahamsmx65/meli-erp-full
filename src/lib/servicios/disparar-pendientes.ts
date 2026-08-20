/**
 * Lanza el proceso de SKUs pendientes.
 *
 * El proceso contesta 202 de inmediato y trabaja después de responder, así
 * que esta espera es corta. El timeout de 10 s es solo por si la función
 * tarda en arrancar en frío: abortar antes de tiempo la mataba sin que
 * llegara a ejecutarse, que es justo el error que hubo que corregir aquí.
 *
 * Con CRON_SECRET se usa el POST de servidor a servidor. Sin él, si el que
 * sincroniza trae sesión, sus cookies sirven igual contra el GET: el proceso
 * no se queda apagado nada más porque falte una variable de entorno.
 */
export async function dispararPendientes(
  origen: string,
  cookies?: string | null,
): Promise<void> {
  const secreto = process.env.CRON_SECRET;

  try {
    if (secreto) {
      await fetch(`${origen}/api/meli/skus-pendientes`, {
        method: "POST",
        headers: { authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(10_000),
      });
      return;
    }

    if (cookies) {
      await fetch(`${origen}/api/meli/skus-pendientes`, {
        method: "GET",
        headers: { cookie: cookies },
        signal: AbortSignal.timeout(10_000),
      });
      return;
    }

    console.error(
      "dispararPendientes: falta CRON_SECRET y no hay sesión; " +
        "los SKUs pendientes se quedan sin resolver hasta que alguien " +
        "abra /api/meli/skus-pendientes con sesión.",
    );
  } catch (err) {
    // Que quede en los logs de Vercel: este fallo fue invisible semanas.
    console.error("dispararPendientes: no prendió:", (err as Error).message);
  }
}
