import type { clienteAdmin } from "../supabase/server";
import {
  llamarHerramienta,
  resultadoEstructurado,
  type SesionMCP,
} from "../higgsfield/mcp";

/** El texto de la marca de agua (abajo a la derecha de cada video). */
export const MARCA_AGUA = "GETAC";

/** Tipografía bold para la marca y los subtítulos (Archivo Black). */
const FUENTE_MARCA =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf";

/** Un renglón de subtítulo con su ventana de tiempo. */
export interface Subtitulo {
  desde: number;
  hasta: number;
  texto: string;
}

/**
 * Parte el guion en renglones cortos y les reparte el tiempo del video en
 * proporción a su largo. La IA escribe los subtítulos con faltas ("corclo",
 * "nuve", "Já" en portugués); el ERP los quema desde el guion REAL y salen
 * perfectos siempre. La sincronía es por frase (la voz sigue el guion en
 * orden), suficiente para UGC.
 */
export function armarSubtitulos(guion: string, duracion: number): Subtitulo[] {
  const limpio = guion.replace(/\s+/g, " ").trim();
  if (!limpio) return [];

  // Frases por puntuación y luego a renglones de máximo ~34 caracteres
  // (drawtext no parte líneas solo).
  const frases = limpio
    .split(/(?<=[.!?…])\s+|,\s+/)
    .map((f) => f.trim())
    .filter(Boolean);
  const renglones: string[] = [];
  for (const frase of frases) {
    if (frase.length <= 34) {
      renglones.push(frase);
      continue;
    }
    let actual = "";
    for (const palabra of frase.split(" ")) {
      if (`${actual} ${palabra}`.trim().length > 34) {
        if (actual) renglones.push(actual);
        actual = palabra;
      } else {
        actual = `${actual} ${palabra}`.trim();
      }
    }
    if (actual) renglones.push(actual);
  }

  const totalLetras = renglones.reduce((s, r) => s + r.length, 0) || 1;
  const inicio = 0.2;
  const fin = Math.max(duracion - 0.2, 1);
  let t = inicio;
  return renglones.map((texto, i) => {
    const dur = ((fin - inicio) * texto.length) / totalLetras;
    const desde = +t.toFixed(2);
    t += dur;
    const hasta = i === renglones.length - 1 ? fin : +t.toFixed(2);
    return { desde, hasta: Math.min(hasta, fin), texto };
  });
}

/**
 * Deja el texto seguro para drawtext dentro de comillas simples del filtro
 * (ahí comas y dos puntos van literales) y del comando de shell entre
 * comillas dobles: el apóstrofo y las comillas pasan a apóstrofo
 * tipográfico (’, que drawtext pinta sin drama) y los caracteres de shell
 * o de expansión de drawtext se quitan.
 */
export function escaparDrawtext(texto: string): string {
  return texto
    .replace(/["'´`]/g, "’")
    .replace(/[\\$;%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Los filtros drawtext de los subtítulos (mismo estilo que los de la IA). */
export function filtrosSubtitulos(guion: string, duracion: number): string[] {
  return armarSubtitulos(guion, duracion).map(
    (s) =>
      `drawtext=fontfile=/tmp/marca.ttf:text='${escaparDrawtext(s.texto)}':` +
      `fontcolor=white:fontsize=h/26:borderw=h/240:bordercolor=black@0.85:` +
      `x=(w-tw)/2:y=h*0.71:enable='between(t,${s.desde},${s.hasta})'`,
  );
}

/**
 * Quema la marca de agua (y los subtítulos del ERP, si hay guion) sobre un
 * MP4 y lo deja en el bucket, SIN pasar el archivo por Vercel: ffmpeg corre
 * en el sandbox del MCP de Higgsfield, que descarga el video, lo marca y lo
 * sube directo al bucket con una URL firmada. Lanza si algo falla; el que
 * llama decide el plan B.
 */
export async function quemarMarcaYSubir(
  admin: ReturnType<typeof clienteAdmin>,
  sesion: SesionMCP,
  ruta: string,
  urlVideo: string,
  guion?: string | null,
  duracion?: number | null,
): Promise<string> {
  const firmada = await admin.storage
    .from("videos-producto")
    .createSignedUploadUrl(ruta, { upsert: true });
  if (firmada.error || !firmada.data?.signedUrl) {
    throw new Error(firmada.error?.message ?? "sin URL firmada");
  }

  // También se guarda la copia LIMPIA (sin marca ni subtítulos): con ella
  // los subtítulos se pueden corregir después cuantas veces sea, gratis.
  const rutaLimpia = ruta.replace(/\.mp4$/, "-limpio.mp4");
  const firmadaLimpia = await admin.storage
    .from("videos-producto")
    .createSignedUploadUrl(rutaLimpia, { upsert: true });
  if (firmadaLimpia.error || !firmadaLimpia.data?.signedUrl) {
    throw new Error(firmadaLimpia.error?.message ?? "sin URL firmada (limpia)");
  }

  // Subtítulos del ERP primero (si hay guion) y la marca al final. El
  // tamaño y los márgenes escalan con la altura del video (720p o 1080p).
  const filtros = guion ? filtrosSubtitulos(guion, duracion || 15) : [];
  filtros.push(
    `drawtext=fontfile=/tmp/marca.ttf:text='${MARCA_AGUA}':` +
      `fontcolor=white@0.9:fontsize=h/24:x=w-tw-h/38:y=h-th-h/38:` +
      `shadowcolor=black@0.35:shadowx=2:shadowy=2`,
  );

  const comando = [
    "set -e",
    `curl -sSL --max-time 120 -o /tmp/entrada.mp4 '${urlVideo}'`,
    `curl -sSL --max-time 60 -o /tmp/marca.ttf '${FUENTE_MARCA}'`,
    `ffmpeg -y -i /tmp/entrada.mp4 -vf "${filtros.join(",")}" -c:v libx264 -preset veryfast -crf 20 -c:a copy -movflags +faststart /tmp/salida.mp4`,
    `curl -sS --fail --max-time 120 -X PUT '${firmada.data.signedUrl}' -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @/tmp/salida.mp4 > /dev/null`,
    `curl -sS --fail --max-time 120 -X PUT '${firmadaLimpia.data.signedUrl}' -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @/tmp/entrada.mp4 > /dev/null`,
    "echo LISTO_MARCA",
  ].join(" && ");

  // El sandbox acepta 120 s máximo; para un video de 15 s alcanza de sobra.
  const res = await llamarHerramienta(sesion, "sandbox_exec", {
    command: comando,
    timeout_seconds: 120,
  });
  const texto = JSON.stringify(resultadoEstructurado(res) ?? res);
  if (!texto.includes("LISTO_MARCA")) {
    throw new Error(`el sandbox no confirmó: ${texto.slice(0, 300)}`);
  }
  const { data } = admin.storage.from("videos-producto").getPublicUrl(ruta);
  return data.publicUrl;
}
