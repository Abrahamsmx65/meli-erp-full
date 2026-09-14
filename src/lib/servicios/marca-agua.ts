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

/** Un tramo del audio en el que se oye la voz (segundos del video). */
export interface TramoVoz {
  desde: number;
  hasta: number;
}

/** Largo máximo de un renglón: Archivo Black es ANCHA y drawtext no parte
 *  líneas solo; con más largo el renglón se sale del cuadro en 720p. */
const LARGO_RENGLON = 26;

/** Cuánto se adelanta el renglón a la voz y cuánto se queda después de
 *  ella, para que el ojo alcance a leer. */
const ADELANTO = 0.1;
const COLA = 0.3;

/** Parte una frase en renglones de máximo LARGO_RENGLON caracteres. */
function partirEnRenglones(frase: string): string[] {
  if (frase.length <= LARGO_RENGLON) return [frase];
  const renglones: string[] = [];
  let actual = "";
  for (const palabra of frase.split(" ")) {
    if (`${actual} ${palabra}`.trim().length > LARGO_RENGLON) {
      if (actual) renglones.push(actual);
      actual = palabra;
    } else {
      actual = `${actual} ${palabra}`.trim();
    }
  }
  if (actual) renglones.push(actual);
  return renglones;
}

/**
 * El guion en ORACIONES (por punto, signo de admiración, interrogación o
 * puntos suspensivos) y cada oración en renglones cortos (partida por comas
 * y por largo). La voz hace sus pausas entre oraciones: por eso la unidad
 * que se alinea contra los tramos de voz es la oración, no el renglón.
 */
export function oracionesDelGuion(guion: string): string[][] {
  const limpio = guion.replace(/\s+/g, " ").trim();
  if (!limpio) return [];
  return limpio
    .split(/(?<=[.!?…])\s+/)
    .map((o) => o.trim())
    .filter(Boolean)
    .map((oracion) =>
      oracion
        .split(/,\s+/)
        .map((f) => f.trim())
        .filter(Boolean)
        .flatMap(partirEnRenglones),
    )
    .filter((r) => r.length > 0);
}

/** Reparte una ventana entre renglones en proporción a su largo. */
function repartir(renglones: string[], desde: number, hasta: number): Subtitulo[] {
  const totalLetras = renglones.reduce((s, r) => s + r.length, 0) || 1;
  let t = desde;
  return renglones.map((texto, i) => {
    const dur = ((hasta - desde) * texto.length) / totalLetras;
    const inicio = +t.toFixed(2);
    t += dur;
    const fin = i === renglones.length - 1 ? hasta : +t.toFixed(2);
    return { desde: inicio, hasta: +Math.min(fin, hasta).toFixed(2), texto };
  });
}

/**
 * Parte el guion en renglones cortos y les reparte el tiempo. La IA escribe
 * los subtítulos con faltas ("corclo", "nuve", "Já" en portugués); el ERP
 * los quema desde el guion REAL y salen perfectos siempre.
 *
 * CON tramos de voz (medidos en el audio con `silencedetect`, ver
 * `tramosDeVoz`) el tiempo se reparte SOLO donde se oye hablar: la voz de
 * un video de 15 s suele arrancar tarde, hacer pausas y callarse antes del
 * final, y repartir el guion parejo sobre los 15 s dejaba los subtítulos
 * desfasados de la voz. Si hay tantas oraciones como tramos, cada oración
 * va en su tramo; si no, el guion se reparte por largo sobre la línea de
 * tiempo de la voz (saltándose los silencios).
 *
 * SIN tramos (no se pudo medir) se reparte parejo sobre toda la duración,
 * en proporción al largo de cada renglón: sincronía por frase, la de antes.
 */
export function armarSubtitulos(
  guion: string,
  duracion: number,
  tramos?: TramoVoz[] | null,
): Subtitulo[] {
  const oraciones = oracionesDelGuion(guion);
  if (!oraciones.length) return [];

  const voz = (tramos ?? [])
    .filter((t) => t.hasta > t.desde)
    .map((t) => ({ desde: Math.max(0, t.desde), hasta: Math.min(t.hasta, duracion) }))
    .filter((t) => t.hasta > t.desde);

  if (!voz.length) {
    const inicio = 0.2;
    const fin = Math.max(duracion - 0.2, 1);
    return repartir(oraciones.flat(), inicio, fin);
  }

  // Cada oración en su tramo de voz: el caso ideal, cuando la voz hizo
  // exactamente una pausa entre oración y oración.
  if (oraciones.length === voz.length) {
    return oraciones.flatMap((renglones, i) => {
      const tramo = voz[i];
      const desde = Math.max(0, tramo.desde - ADELANTO);
      const tope = i + 1 < voz.length ? voz[i + 1].desde - ADELANTO : duracion;
      const hasta = Math.min(tramo.hasta + COLA, tope);
      return repartir(renglones, +desde.toFixed(2), +hasta.toFixed(2));
    });
  }

  // Línea de tiempo de la voz: los tramos pegados uno tras otro, sin los
  // silencios. Cada renglón toma su rebanada por largo y se traduce a
  // segundos reales del video; un renglón que cruza un silencio se queda
  // en pantalla durante la pausa (empieza en un tramo y acaba en el otro).
  const renglones = oraciones.flat();
  const totalVoz = voz.reduce((s, t) => s + (t.hasta - t.desde), 0);
  const totalLetras = renglones.reduce((s, r) => s + r.length, 0) || 1;
  const EPS = 1e-6;
  const real = (p: number, borde: "inicio" | "fin"): number => {
    let acumulado = 0;
    for (const tramo of voz) {
      const largo = tramo.hasta - tramo.desde;
      const dentro = borde === "fin" ? p <= acumulado + largo + EPS : p < acumulado + largo - EPS;
      if (dentro) return tramo.desde + Math.max(0, p - acumulado);
      acumulado += largo;
    }
    return voz[voz.length - 1].hasta;
  };
  let letras = 0;
  return renglones.map((texto, i) => {
    const p0 = (totalVoz * letras) / totalLetras;
    letras += texto.length;
    const p1 = (totalVoz * letras) / totalLetras;
    const desde = Math.max(0, real(p0, "inicio") - (i === 0 ? ADELANTO : 0));
    const hasta =
      i === renglones.length - 1
        ? Math.min(real(p1, "fin") + COLA, duracion)
        : real(p1, "fin");
    return { desde: +desde.toFixed(2), hasta: +hasta.toFixed(2), texto };
  });
}

/**
 * Lee la salida de `ffmpeg … -af silencedetect … -f null -` y devuelve los
 * tramos donde SÍ hay voz (el complemento de los silencios dentro de la
 * duración del audio). Devuelve null si no se pudo leer la duración: sin
 * ella no hay contra qué medir. Un audio sin silencios es un solo tramo
 * completo; los tramos de menos de 0.15 s (un clic, un respiro) se tiran.
 */
export function tramosDeVoz(salida: string, duracionVideo?: number | null): TramoVoz[] | null {
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(salida);
  let duracion = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : NaN;
  if (!Number.isFinite(duracion) || duracion <= 0) return null;
  if (duracionVideo && duracionVideo > 0) duracion = Math.min(duracion, duracionVideo);

  const silencios: { desde: number; hasta: number }[] = [];
  let abierto: number | null = null;
  const re = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;
  for (let m = re.exec(salida); m; m = re.exec(salida)) {
    const t = Number(m[2]);
    if (m[1] === "start") {
      abierto = t;
    } else if (abierto !== null) {
      silencios.push({ desde: abierto, hasta: t });
      abierto = null;
    }
  }
  // Un silencio que arranca y ya no se cierra llega hasta el final.
  if (abierto !== null) silencios.push({ desde: abierto, hasta: duracion });

  const voz: TramoVoz[] = [];
  let cursor = 0;
  for (const s of silencios.sort((a, b) => a.desde - b.desde)) {
    if (s.desde > cursor) voz.push({ desde: cursor, hasta: Math.min(s.desde, duracion) });
    cursor = Math.max(cursor, s.hasta);
  }
  if (cursor < duracion) voz.push({ desde: cursor, hasta: duracion });

  return voz
    .filter((t) => t.hasta - t.desde >= 0.15)
    .map((t) => ({ desde: +t.desde.toFixed(2), hasta: +t.hasta.toFixed(2) }));
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
export function archivosSubtitulos(subtitulos: Subtitulo[]): string[] {
  return subtitulos.map(
    (s, i) => `printf "%s" "${escaparDrawtext(s.texto)}" > /tmp/sub${i}.txt`,
  );
}

/** Los filtros drawtext de los subtítulos (mismo estilo que los de la IA). */
export function filtrosSubtitulos(subtitulos: Subtitulo[]): string[] {
  // OJO: borderw NO acepta expresiones como h/240 (fontsize, x, y sí), y el
  // texto va en archivos (textfile=), no incrustado: los dos puntos del
  // guion rompían el parseo del filtro y el video salía sin marca.
  return subtitulos.map(
    (s, i) =>
      `drawtext=fontfile=/tmp/marca.ttf:textfile=/tmp/sub${i}.txt:` +
      `fontcolor=white:fontsize=h/30:borderw=6:bordercolor=black@0.85:` +
      `x=(w-tw)/2:y=h*0.71:enable='between(t,${s.desde},${s.hasta})'`,
  );
}

/**
 * El comando que mide dónde hay voz en un audio (o en la pista de un
 * video): pasa la pista por un filtro de banda de voz (200–3000 Hz, para
 * que la música de fondo pese menos) y `silencedetect` apunta cada
 * silencio de más de 0.25 s. Todo va a la salida del comando, que
 * `tramosDeVoz` lee.
 */
export function comandoMedirVoz(urlAudio: string): string {
  return [
    `curl -sSL --max-time 90 -o /tmp/medir.bin '${urlAudio}'`,
    `ffmpeg -hide_banner -nostats -i /tmp/medir.bin -vn -af "highpass=f=200,lowpass=f=3000,silencedetect=noise=-32dB:d=0.25" -f null - 2>&1`,
    "echo LISTO_MEDIR",
  ].join(" && ");
}

/**
 * Mide en el sandbox los tramos de voz del audio que va a llevar el video
 * (la voz aprobada si la hay; si no, la pista del video mismo). Devuelve
 * null si no se pudo medir: el que llama reparte parejo, como antes. Medir
 * nunca tumba la quemada: la marca y los subtítulos valen más que la
 * sincronía fina.
 */
export async function medirVoz(
  sesion: SesionMCP,
  urlAudio: string,
  duracionVideo?: number | null,
): Promise<TramoVoz[] | null> {
  try {
    const res = await llamarHerramienta(sesion, "sandbox_exec", {
      command: comandoMedirVoz(urlAudio),
      timeout_seconds: 90,
    });
    const texto = JSON.stringify(resultadoEstructurado(res) ?? res);
    if (!texto.includes("LISTO_MEDIR")) return null;
    // El JSON trae la salida con los saltos de línea escapados; a los
    // números no les afecta.
    return tramosDeVoz(texto.replace(/\\n/g, "\n"), duracionVideo);
  } catch (err) {
    console.error("videos: no se pudo medir la voz:", err);
    return null;
  }
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
  // Los tiempos salen de DÓNDE se oye la voz en la pista que va a llevar
  // el archivo final (la aprobada, o la del video); si no se pudo medir,
  // se reparten parejo.
  const conVoz = Boolean(audioUrl);
  const subtitulos = guion
    ? armarSubtitulos(
        guion,
        duracion || 15,
        await medirVoz(sesion, conVoz ? (audioUrl as string) : urlVideo, duracion || 15),
      )
    : [];
  const filtros = filtrosSubtitulos(subtitulos);
  filtros.push(
    `drawtext=fontfile=/tmp/marca.ttf:text='${MARCA_AGUA}':` +
      `fontcolor=white@0.9:fontsize=h/24:x=w-tw-h/38:y=h-th-h/38:` +
      `shadowcolor=black@0.35:shadowx=2:shadowy=2`,
  );

  // Con audio APROBADO (la voz que el usuario ya escuchó y validó), esa
  // pista sustituye a la del video: las palabras quedan exactamente como
  // se oyeron en la prueba, y los labios ya vienen sincronizados porque el
  // mismo audio viajó de referencia a la generación.
  const entradas = conVoz ? "-i /tmp/entrada.mp4 -i /tmp/voz.m4a" : "-i /tmp/entrada.mp4";
  const mapeo = conVoz ? "-map 0:v:0 -map 1:a:0 -c:a aac -b:a 160k" : "-c:a copy";
  const comando = [
    "set -e",
    `curl -sSL --max-time 120 -o /tmp/entrada.mp4 '${urlVideo}'`,
    ...(conVoz ? [`curl -sSL --max-time 60 -o /tmp/voz.m4a '${audioUrl}'`] : []),
    `curl -sSL --max-time 60 -o /tmp/marca.ttf '${FUENTE_MARCA}'`,
    ...archivosSubtitulos(subtitulos),
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
