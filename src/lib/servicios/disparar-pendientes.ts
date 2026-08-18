/**
 * Lanza el proceso de SKUs pendientes sin esperar su respuesta.
 *
 * Se llama al terminar una sincronización: si quedaron tallas por resolver,
 * el proceso arranca solo y se re-lanza hasta vaciar la tabla. El abort a
 * los 1.5 s es a propósito: basta con que la petición haya llegado.
 */
export async function dispararPendientes(origen: string): Promise<void> {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return;

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    await fetch(`${origen}/api/meli/skus-pendientes`, {
      method: "POST",
      headers: { authorization: `Bearer ${secreto}` },
      signal: ctl.signal,
    });
  } catch {
    // Esperado: no nos interesa la respuesta, solo encenderlo.
  } finally {
    clearTimeout(t);
  }
}
