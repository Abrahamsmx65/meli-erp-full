import type { clienteAdmin } from "@/lib/supabase/server";
import {
  llamarHerramienta,
  resultadoEstructurado,
  type SesionMCP,
} from "@/lib/higgsfield/mcp";

/** El texto de la marca de agua (abajo a la derecha de cada video). */
export const MARCA_AGUA = "GETAC";

/** Tipografía bold para la marca (Archivo Black, del repo de Google Fonts). */
const FUENTE_MARCA =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf";

/**
 * Quema la marca de agua sobre un MP4 y lo deja en el bucket, SIN pasar el
 * archivo por Vercel: ffmpeg corre en el sandbox del MCP de Higgsfield, que
 * descarga el video, le pone "GETAC" en blanco abajo a la derecha (texto
 * real, no de IA: sale perfecto siempre) y lo sube directo al bucket con
 * una URL firmada. Lanza si algo falla; el que llama decide el plan B.
 */
export async function quemarMarcaYSubir(
  admin: ReturnType<typeof clienteAdmin>,
  sesion: SesionMCP,
  ruta: string,
  urlVideo: string,
): Promise<string> {
  const firmada = await admin.storage
    .from("videos-producto")
    .createSignedUploadUrl(ruta, { upsert: true });
  if (firmada.error || !firmada.data?.signedUrl) {
    throw new Error(firmada.error?.message ?? "sin URL firmada");
  }

  // El tamaño y el margen escalan con la altura del video (720p o 1080p);
  // blanco con sombra suave, como el logo de referencia del usuario.
  const filtro =
    `drawtext=fontfile=/tmp/marca.ttf:text='${MARCA_AGUA}':` +
    `fontcolor=white@0.9:fontsize=h/24:x=w-tw-h/38:y=h-th-h/38:` +
    `shadowcolor=black@0.35:shadowx=2:shadowy=2`;
  const comando = [
    "set -e",
    `curl -sSL --max-time 120 -o /tmp/entrada.mp4 '${urlVideo}'`,
    `curl -sSL --max-time 60 -o /tmp/marca.ttf '${FUENTE_MARCA}'`,
    `ffmpeg -y -i /tmp/entrada.mp4 -vf "${filtro}" -c:v libx264 -preset veryfast -crf 20 -c:a copy -movflags +faststart /tmp/salida.mp4`,
    `curl -sS --fail --max-time 120 -X PUT '${firmada.data.signedUrl}' -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @/tmp/salida.mp4 > /dev/null`,
    "echo LISTO_MARCA",
  ].join(" && ");

  const res = await llamarHerramienta(sesion, "sandbox_exec", {
    command: comando,
    timeout_seconds: 240,
  });
  const texto = JSON.stringify(resultadoEstructurado(res) ?? res);
  if (!texto.includes("LISTO_MARCA")) {
    throw new Error(`el sandbox no confirmó: ${texto.slice(0, 300)}`);
  }
  const { data } = admin.storage.from("videos-producto").getPublicUrl(ruta);
  return data.publicUrl;
}
