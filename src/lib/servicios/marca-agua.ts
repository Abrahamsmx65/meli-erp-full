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

  // Frases por puntuación y luego a renglones de máximo ~26 caracteres:
  // Archivo Black es ANCHA y drawtext no parte líneas solo; con más largo
  // el renglón se sale del cuadro en 720p.
  const frases = limpio
    .split(/(?<=[.!?…])\s+|,\s+/)
    .map((f) => f.trim())
    .filter(Boolean);
  const renglones: string[] = [];
  for (const frase of frases) {
    if (frase.length <= 26) {
      renglones.push(frase);
      continue;
    }
    let actual = "";
    for (const palabra of frase.split(" ")) {
      if (`${actual} ${palabra}`.trim().length > 26) {
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

/** Un tramo del audio donde SÍ hay voz (entre silencio y silencio). */
export interface SegmentoHabla {
  desde: number;
  hasta: number;
}

/**
 * Convierte la salida de `silencedetect` de ffmpeg (renglones
 * `silence_start: 1.36` / `silence_end: 3.11`) en los tramos donde sí se
 * habla. Los tramos de menos de 0.25 s se descartan (ruiditos, no frases).
 * Sin silencios detectados, todo el audio cuenta como un solo tramo.
 */
export function parsearSilencios(salida: string, duracion: number): SegmentoHabla[] {
  const silencios: SegmentoHabla[] = [];
  let abierto: number | null = null;
  for (const m of salida.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const t = Math.min(Math.max(parseFloat(m[2]), 0), duracion);
    if (m[1] === "start") {
      abierto = t;
    } else if (abierto !== null) {
      silencios.push({ desde: abierto, hasta: t });
      abierto = null;
    }
  }
  // Un silencio que llega al final del archivo se queda sin silence_end.
  if (abierto !== null) silencios.push({ desde: abierto, hasta: duracion });
  silencios.sort((a, b) => a.desde - b.desde);

  const habla: SegmentoHabla[] = [];
  let t = 0;
  for (const s of silencios) {
    if (s.desde - t >= 0.25) habla.push({ desde: t, hasta: s.desde });
    t = Math.max(t, s.hasta);
  }
  if (duracion - t >= 0.25) habla.push({ desde: t, hasta: duracion });
  return habla.length ? habla : [{ desde: 0, hasta: duracion }];
}

/**
 * Recoloca los renglones sobre los tramos con voz: el tiempo se reparte por
 * largo del texto pero SOLO dentro del habla (los silencios se saltan), así
 * el primer renglón espera a que la voz arranque y cada frase cae cerca de
 * donde de verdad se dice. Cada renglón dura hasta que empieza el siguiente
 * (en las pausas el texto se queda puesto, no parpadea).
 */
export function alinearSubtitulos(subs: Subtitulo[], habla: SegmentoHabla[]): Subtitulo[] {
  if (!subs.length || !habla.length) return subs;
  const total = habla.reduce((s, h) => s + (h.hasta - h.desde), 0);
  if (total < 0.5) return subs;

  // Un instante del "tiempo de habla" acumulado → el tiempo real del video.
  const aReal = (offset: number): number => {
    for (const h of habla) {
      const largo = h.hasta - h.desde;
      if (offset <= largo) return h.desde + offset;
      offset -= largo;
    }
    return habla[habla.length - 1].hasta;
  };

  const letras = subs.reduce((s, r) => s + r.texto.length, 0) || 1;
  let acumulado = 0;
  const inicios = subs.map((s) => {
    const t = aReal((total * acumulado) / letras);
    acumulado += s.texto.length;
    return t;
  });
  const finHabla = habla[habla.length - 1].hasta;
  return subs.map((s, i) => {
    const desde = +inicios[i].toFixed(2);
    const hasta = +(
      i + 1 < subs.length ? inicios[i + 1] : Math.max(finHabla, desde + 0.8)
    ).toFixed(2);
    return { desde, hasta: Math.max(hasta, desde + 0.3), texto: s.texto };
  });
}

/**
 * Escucha el audio en el sandbox (gratis): ffmpeg detecta los silencios y
 * ffprobe mide la duración real. Con eso los subtítulos se alinean a la voz
 * de verdad, no a un reparto proporcional a ciegas.
 */
export async function analizarHabla(
  sesion: SesionMCP,
  url: string,
): Promise<{ salida: string; duracion: number | null }> {
  const comando = [
    "set -e",
    `curl -sSL --max-time 90 -o /tmp/analisis.bin '${url}'`,
    // grep sale con 1 si no hay silencios; eso no es un error aquí.
    `(ffmpeg -hide_banner -i /tmp/analisis.bin -af silencedetect=noise=-30dB:d=0.3 -f null - 2>&1 | grep -Eo 'silence_(start|end): *-?[0-9.]+' || true)`,
    `echo "DUR:$(ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/analisis.bin)"`,
    "echo LISTO_ANALISIS",
  ].join(" && ");
  const res = await llamarHerramienta(sesion, "sandbox_exec", {
    command: comando,
    timeout_seconds: 110,
  });
  const texto = JSON.stringify(resultadoEstructurado(res) ?? res);
  if (!texto.includes("LISTO_ANALISIS")) {
    throw new Error(`el análisis de voz no terminó: ${texto.slice(0, 200)}`);
  }
  const dur = /DUR:\s*([\d.]+)/.exec(texto);
  return { salida: texto, duracion: dur ? parseFloat(dur[1]) : null };
}

/**
 * Deja el texto seguro para un comando de shell entre comillas dobles: las
 * comillas pasan a apóstrofo tipográfico (’, que drawtext pinta sin drama)
 * y los caracteres peligrosos del shell se quitan. El texto NO va incrustado
 * en el filtro (los dos puntos y comas de ffmpeg son un campo minado): cada
 * renglón se escribe a un archivo y drawtext lo lee con `textfile=`.
 */
export function escaparDrawtext(texto: string): string {
  return texto
    .replace(/["'´`]/g, "’")
    .replace(/[\\$;%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comandos que escriben cada renglón del subtítulo a su archivo. */
export function archivosDeSubtitulos(subs: Subtitulo[]): string[] {
  return subs.map(
    (s, i) => `printf "%s" "${escaparDrawtext(s.texto)}" > /tmp/sub${i}.txt`,
  );
}

export function archivosSubtitulos(guion: string, duracion: number): string[] {
  return archivosDeSubtitulos(armarSubtitulos(guion, duracion));
}

/** Los filtros drawtext de los subtítulos (mismo estilo que los de la IA). */
export function filtrosDeSubtitulos(subs: Subtitulo[]): string[] {
  // OJO: borderw NO acepta expresiones como h/240 (fontsize, x, y sí), y el
  // texto va en archivos (textfile=), no incrustado: los dos puntos del
  // guion rompían el parseo del filtro y el video salía sin marca.
  return subs.map(
    (s, i) =>
      `drawtext=fontfile=/tmp/marca.ttf:textfile=/tmp/sub${i}.txt:` +
      `fontcolor=white:fontsize=h/30:borderw=6:bordercolor=black@0.85:` +
      `x=(w-tw)/2:y=h*0.71:enable='between(t,${s.desde},${s.hasta})'`,
  );
}

export function filtrosSubtitulos(guion: string, duracion: number): string[] {
  return filtrosDeSubtitulos(armarSubtitulos(guion, duracion));
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
  audioUrl?: string | null,
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
  // Los renglones se ALINEAN A LA VOZ: se escucha el audio (la voz aprobada
  // si la hay; si no, la pista del video) y cada frase arranca donde de
  // verdad arranca en el audio. Si el análisis falla, queda el reparto
  // proporcional de siempre: mejor aproximado que sin subtítulos.
  let subs: Subtitulo[] = guion ? armarSubtitulos(guion, duracion || 15) : [];
  if (subs.length) {
    try {
      const analisis = await analizarHabla(sesion, audioUrl ?? urlVideo);
      const dur = analisis.duracion ?? duracion ?? 15;
      subs = alinearSubtitulos(
        armarSubtitulos(guion as string, dur),
        parsearSilencios(analisis.salida, dur),
      );
    } catch (err) {
      console.error("videos: análisis de voz falló, subtítulos proporcionales:", err);
    }
  }
  const filtros = filtrosDeSubtitulos(subs);
  filtros.push(
    `drawtext=fontfile=/tmp/marca.ttf:text='${MARCA_AGUA}':` +
      `fontcolor=white@0.9:fontsize=h/24:x=w-tw-h/38:y=h-th-h/38:` +
      `shadowcolor=black@0.35:shadowx=2:shadowy=2`,
  );

  // Con audio APROBADO (la voz que el usuario ya escuchó y validó), esa
  // pista sustituye a la del video: las palabras quedan exactamente como
  // se oyeron en la prueba, y los labios ya vienen sincronizados porque el
  // mismo audio viajó de referencia a la generación.
  const conVoz = Boolean(audioUrl);
  const entradas = conVoz ? "-i /tmp/entrada.mp4 -i /tmp/voz.m4a" : "-i /tmp/entrada.mp4";
  const mapeo = conVoz ? "-map 0:v:0 -map 1:a:0 -c:a aac -b:a 160k" : "-c:a copy";
  const comando = [
    "set -e",
    `curl -sSL --max-time 120 -o /tmp/entrada.mp4 '${urlVideo}'`,
    ...(conVoz ? [`curl -sSL --max-time 60 -o /tmp/voz.m4a '${audioUrl}'`] : []),
    `curl -sSL --max-time 60 -o /tmp/marca.ttf '${FUENTE_MARCA}'`,
    ...archivosDeSubtitulos(subs),
    `ffmpeg -hide_banner -loglevel error -y ${entradas} -vf "${filtros.join(",")}" -c:v libx264 -preset veryfast -crf 20 ${mapeo} -movflags +faststart /tmp/salida.mp4`,
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
