import { gunzipSync } from "node:zlib";

/** Lee un cuerpo JSON comprimido con gzip (o JSON plano si no viene comprimido). */
export async function leerCuerpoGzip<T>(req: Request, maxBytes = 60 * 1024 * 1024): Promise<T> {
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) throw new Error("El cuerpo viene vacío.");
  const esGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const texto = esGzip ? gunzipSync(bytes, { maxOutputLength: maxBytes }).toString("utf8") : bytes.toString("utf8");
  return JSON.parse(texto) as T;
}
