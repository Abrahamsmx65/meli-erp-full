/**
 * La respuesta HTTP del ZIP de imágenes, compartida por la ruta con sesión y
 * la del link sin contraseña.
 */
import { NextResponse } from "next/server";
import type { ResultadoZip } from "./contenido-imagenes";

export function respuestaZip(r: ResultadoZip): NextResponse {
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // El Buffer de JSZip apunta a un pedazo de un ArrayBuffer más grande: se
  // recorta al suyo, que es lo que el cuerpo de la respuesta acepta.
  const cuerpo = r.zip.buffer.slice(
    r.zip.byteOffset,
    r.zip.byteOffset + r.zip.byteLength,
  ) as ArrayBuffer;

  return new NextResponse(cuerpo, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${r.nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
