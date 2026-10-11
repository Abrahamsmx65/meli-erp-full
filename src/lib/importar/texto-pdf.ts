/** El texto de un PDF (para leer el BL). Import dinámico: solo lo carga quien lo usa. */
export async function textoDePdf(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buffer instanceof Uint8Array ? new Uint8Array(buffer) : new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}
