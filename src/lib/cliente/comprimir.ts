/**
 * Comprimir en el navegador lo que se manda a una ruta: un reporte del mes
 * (15 MB de Excel, 11 MB de CSV) no cabe en el cuerpo que Vercel acepta
 * (4.5 MB), así que el navegador lo lee, se queda con lo compacto y lo
 * manda en gzip. Del otro lado, `leerCuerpoGzip` lo abre.
 */
export async function gzipTexto(texto: string): Promise<Blob> {
  if (typeof CompressionStream === "undefined") throw new Error("Este navegador no sabe comprimir (CompressionStream). Prueba con Chrome, Edge o Safari recientes.");
  const stream = new Blob([texto]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

/** POST de un JSON comprimido; devuelve el JSON de la respuesta o lanza con su error. */
export async function enviarJsonGzip<T>(url: string, datos: unknown): Promise<T> {
  const cuerpo = await gzipTexto(JSON.stringify(datos));
  if (cuerpo.size > 4_000_000) throw new Error(`Aun comprimido, el envío pesa ${(cuerpo.size / 1_048_576).toFixed(1)} MB y pasa del límite de 4 MB. Divide el reporte en dos quincenas.`);
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/gzip" }, body: cuerpo });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error ?? "No se pudo procesar.");
  return j as T;
}
