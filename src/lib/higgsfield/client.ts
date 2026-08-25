/**
 * Cliente mínimo de la API de Higgsfield (https://platform.higgsfield.ai).
 *
 * Lo que este ERP usa: imagen→video (DoP), texto→imagen (Soul, para poner al
 * personaje usando el producto), personajes consistentes (custom references,
 * los "Soul ID") y subida de fotos a su CDN. Sin SDK: son endpoints REST y
 * así no se agrega una dependencia por eso.
 *
 * Mañas de la API aprendidas a golpes (el SDK v2 documenta otra cosa):
 * - El cuerpo de generación va envuelto en `params`; directo contesta 422.
 * - La respuesta puede venir en formato v2 ({request_id, status}) o v1
 *   ({id, jobs:[…]}); el estado se consulta en /requests/{id}/status y si
 *   eso da 404, en /v1/job-sets/{id}. Aquí se aceptan las dos formas.
 *
 * La autenticación es `Authorization: Key ID:SECRETO`, con credenciales de
 * https://cloud.higgsfield.ai en HIGGSFIELD_CREDENTIALS, solo servidor.
 */

const BASE = "https://platform.higgsfield.ai";

/** Reintentables: los mismos criterios que con MELI. */
const REINTENTABLES = new Set([408, 429, 500, 502, 503, 504]);

// Los que acepta la API hoy (lo confirma su propio error 422 de enum);
// el "dop-standard" que menciona el SDK ya no existe.
export type ModeloDop = "dop-lite" | "dop-preview" | "dop-turbo";

export type EstadoHF =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "nsfw"
  | "canceled";

/** Una generación en curso o terminada, ya normalizada. */
export interface Generacion {
  id: string;
  status: EstadoHF;
  /** URL del resultado (video o imagen) cuando status es completed. */
  url: string | null;
}

export function credencialesHiggsfield(): string | null {
  const cred = process.env.HIGGSFIELD_CREDENTIALS?.trim();
  if (!cred || !cred.includes(":")) return null;
  return cred;
}

function encabezados(): Record<string, string> {
  const cred = credencialesHiggsfield();
  if (!cred) {
    throw new Error(
      "Falta HIGGSFIELD_CREDENTIALS (formato ID:SECRETO, se crea en cloud.higgsfield.ai).",
    );
  }
  return {
    Authorization: `Key ${cred}`,
    "Content-Type": "application/json",
  };
}

async function llamar<T>(
  ruta: string,
  init: RequestInit,
  opciones?: { nullEn404?: boolean },
): Promise<T | null> {
  let ultimo: Error | null = null;

  for (let i = 0; i < 3; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));

    let res: Response;
    try {
      res = await fetch(`${BASE}${ruta}`, {
        ...init,
        headers: { ...encabezados(), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      ultimo = err as Error;
      continue;
    }

    if (res.ok) return (await res.json()) as T;
    if (res.status === 404 && opciones?.nullEn404) return null;

    if (REINTENTABLES.has(res.status)) {
      ultimo = new Error(`Higgsfield contestó ${res.status}.`);
      continue;
    }

    const detalle = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("Credenciales de Higgsfield inválidas.");
    if (res.status === 403) throw new Error("Sin créditos de API en Higgsfield (se compran en cloud.higgsfield.ai).");
    throw new Error(
      `Higgsfield rechazó la solicitud (${res.status}): ${detalle.slice(0, 300)}`,
    );
  }

  throw ultimo ?? new Error("No se pudo hablar con Higgsfield.");
}

// ---------------------------------------------------------------------------
// Normalización de respuestas (v2 y v1 job-set)
// ---------------------------------------------------------------------------

interface CrudoV2 {
  status?: EstadoHF;
  request_id?: string;
  video?: { url: string } | null;
  images?: { url: string }[] | null;
}

interface CrudoJobSet {
  id?: string;
  jobs?: { id: string; status: EstadoHF; results?: { raw?: { url?: string } } | null }[];
}

function aGeneracion(cuerpo: CrudoV2 & CrudoJobSet): Generacion {
  if (cuerpo.request_id || cuerpo.status) {
    return {
      id: cuerpo.request_id ?? cuerpo.id ?? "",
      status: cuerpo.status ?? "queued",
      url: cuerpo.video?.url ?? cuerpo.images?.[0]?.url ?? null,
    };
  }
  // Formato v1: el estado del conjunto es el del primer trabajo (batch 1).
  const trabajo = cuerpo.jobs?.[0];
  return {
    id: cuerpo.id ?? "",
    status: trabajo?.status ?? "queued",
    url: trabajo?.results?.raw?.url ?? null,
  };
}

// ---------------------------------------------------------------------------
// Generación
// ---------------------------------------------------------------------------

export interface EntradaDop {
  model: ModeloDop;
  prompt: string;
  input_images: { type: "image_url"; image_url: string }[];
  enhance_prompt?: boolean;
  seed?: number;
}

export interface EntradaSoul {
  prompt: string;
  width_and_height: string; // p. ej. "1536x2048"
  quality: "720p" | "1080p";
  batch_size: 1 | 4;
  custom_reference_id?: string;
  custom_reference_strength?: number;
  image_reference?: { type: "image_url"; image_url: string };
  enhance_prompt?: boolean;
  seed?: number;
}

/** Encola una generación imagen→video. Contesta de inmediato. */
export async function generarVideo(entrada: EntradaDop): Promise<Generacion> {
  const cuerpo = await llamar<CrudoV2 & CrudoJobSet>("/v1/image2video/dop", {
    method: "POST",
    body: JSON.stringify({ params: entrada }),
  });
  return aGeneracion(cuerpo!);
}

export interface EntradaKling {
  prompt: string;
  image_url: string;
  /** La API solo acepta 5 o 10; MELI Clips pide mínimo 10. */
  duration: 5 | 10;
}

/**
 * Encola imagen→video con Kling 2.5 turbo (endpoint nuevo: cuerpo directo,
 * sin envoltura params). El video sale con el formato de la imagen de
 * entrada: para 9:16 hay que darle una imagen 9:16.
 */
export async function generarVideoKling(entrada: EntradaKling): Promise<Generacion> {
  const cuerpo = await llamar<CrudoV2 & CrudoJobSet>(
    "/kling-video/v2.5-turbo/standard/image-to-video",
    { method: "POST", body: JSON.stringify(entrada) },
  );
  return aGeneracion(cuerpo!);
}

export interface EntradaWan {
  prompt: string;
  image_url: string;
  /** Wan 2.6 acepta 5, 10 o 15 segundos. */
  duration: 5 | 10 | 15;
}

/**
 * Encola imagen→video con Wan 2.6 (cuerpo directo, como Kling y Veo). Genera
 * AUDIO NATIVO con lip sync: si el prompt trae un diálogo entre comillas, la
 * persona lo dice. Es el único modelo de la API con voz y 10-15 s — el motor
 * de la voz de IA del UGC. El endpoint no está en los SDK oficiales; se
 * encontró sondeando la API en vivo (contesta 400 enumerando [5, 10, 15]).
 */
export async function generarVideoWan(entrada: EntradaWan): Promise<Generacion> {
  const cuerpo = await llamar<CrudoV2 & CrudoJobSet>("/wan/v2.6/image-to-video", {
    method: "POST",
    body: JSON.stringify(entrada),
  });
  return aGeneracion(cuerpo!);
}

export interface EntradaVeo {
  prompt: string;
  image_url: string;
  /** Veo 3.1 solo acepta 4, 6 u 8 segundos. */
  duration: 4 | 6 | 8;
  resolution: "720p" | "1080p";
}

/**
 * Encola imagen→video con Veo 3.1 (cuerpo directo). Genera audio nativo:
 * si el prompt trae un diálogo entre comillas, el personaje lo dice con
 * lip sync — así habla español sin necesitar un audio aparte.
 */
export async function generarVideoVeo(entrada: EntradaVeo): Promise<Generacion> {
  const cuerpo = await llamar<CrudoV2 & CrudoJobSet>("/veo3.1/image-to-video", {
    method: "POST",
    body: JSON.stringify(entrada),
  });
  return aGeneracion(cuerpo!);
}

/** Encola una imagen Soul (el personaje usando el producto). */
export async function generarImagenSoul(entrada: EntradaSoul): Promise<Generacion> {
  const cuerpo = await llamar<CrudoV2 & CrudoJobSet>("/v1/text2image/soul", {
    method: "POST",
    body: JSON.stringify({ params: entrada }),
  });
  return aGeneracion(cuerpo!);
}

export interface EntradaSpeak {
  input_image: { type: "image_url"; image_url: string };
  /** Solo acepta WAV. */
  input_audio: { type: "audio_url"; audio_url: string };
  prompt: string;
  quality: "mid" | "high";
  duration: 5 | 10 | 15;
  seed?: number;
}

/**
 * Encola Speak v2: anima a la persona de la imagen para que DIGA el audio,
 * con lip sync. Es el motor del modo UGC — el video dura 5, 10 o 15 s según
 * lo que se pida (el audio debe caber). Endpoint v1: cuerpo envuelto en
 * params, igual que DoP y Soul.
 */
export async function generarVideoSpeak(entrada: EntradaSpeak): Promise<Generacion> {
  const cuerpo = await llamar<CrudoV2 & CrudoJobSet>("/v1/speak/higgsfield", {
    method: "POST",
    body: JSON.stringify({ params: entrada }),
  });
  return aGeneracion(cuerpo!);
}

/** Cómo va una generación; acepta ids de las dos épocas de la API. */
export async function estadoGeneracion(id: string): Promise<Generacion> {
  const v2 = await llamar<CrudoV2>(`/requests/${id}/status`, { method: "GET" }, { nullEn404: true });
  if (v2) return aGeneracion(v2);

  const v1 = await llamar<CrudoJobSet>(`/v1/job-sets/${id}`, { method: "GET" }, { nullEn404: true });
  if (v1) return aGeneracion(v1);

  throw new Error("Higgsfield ya no conoce esa generación.");
}

// ---------------------------------------------------------------------------
// Personajes (custom references / Soul ID)
// ---------------------------------------------------------------------------

export type EstadoPersonajeHF =
  | "not_ready"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed";

export interface PersonajeHF {
  id: string;
  name?: string;
  status: EstadoPersonajeHF;
}

/** Crea un personaje consistente a partir de fotos de referencia. */
export async function crearPersonajeHF(
  nombre: string,
  fotos: string[],
): Promise<PersonajeHF> {
  const cuerpo = await llamar<PersonajeHF>("/v1/custom-references", {
    method: "POST",
    body: JSON.stringify({
      name: nombre,
      input_images: fotos.map((url) => ({ type: "image_url", image_url: url })),
    }),
  });
  return cuerpo!;
}

/** Cómo va el entrenamiento del personaje. */
export async function estadoPersonajeHF(id: string): Promise<PersonajeHF> {
  const cuerpo = await llamar<PersonajeHF>(`/v1/custom-references/${id}`, { method: "GET" });
  return cuerpo!;
}

// ---------------------------------------------------------------------------
// Subida de archivos al CDN de Higgsfield
// ---------------------------------------------------------------------------

/**
 * Sube un archivo (foto o audio WAV) y devuelve su URL pública en el CDN de
 * Higgsfield.
 *
 * El 403 (SignatureDoesNotMatch) que daba el PUT era porque la firma de la
 * URL exige las cabeceras content-type y x-amz-tagging EXACTAS: vienen en el
 * campo upload_headers de generate-upload-url, que ni los SDK oficiales
 * viejos leen (la API cambió después). El PUT debe mandarlas tal cual.
 * Cada intento pide una URL NUEVA (caducan y pueden ser de un solo uso) y,
 * si el almacén rechaza, el error trae el cuerpo con la causa real.
 */
export async function subirArchivo(
  datos: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  let ultimo = "";

  for (let i = 0; i < 3; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));

    const enlace = await llamar<{
      upload_url: string;
      public_url: string;
      upload_headers?: Record<string, string>;
    }>("/files/generate-upload-url", {
      method: "POST",
      body: JSON.stringify({ content_type: contentType }),
    });
    if (!enlace?.upload_url || !enlace.public_url) {
      ultimo = "Higgsfield no devolvió la URL de subida";
      continue;
    }

    let res: Response;
    try {
      res = await fetch(enlace.upload_url, {
        method: "PUT",
        headers: enlace.upload_headers ?? { "Content-Type": contentType },
        body: Buffer.from(datos),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      ultimo = (err as Error).message;
      continue;
    }
    if (res.ok) return enlace.public_url;

    const detalle = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim();
    ultimo = `el almacén contestó ${res.status}${detalle ? `: ${detalle.slice(0, 200)}` : ""}`;
  }

  throw new Error(`No se pudo subir el archivo (${ultimo}).`);
}
