/**
 * Cliente mínimo de la API de Higgsfield (https://platform.higgsfield.ai).
 *
 * Solo lo que este ERP usa: mandar una imagen a video (modelo DoP) y
 * preguntar cómo va la solicitud. Sin SDK: son dos endpoints REST y así no
 * se agrega una dependencia por eso.
 *
 * La autenticación es `Authorization: Key ID:SECRETO`, con las credenciales
 * que se crean en https://cloud.higgsfield.ai. Aquí viven en la variable de
 * entorno HIGGSFIELD_CREDENTIALS con el formato "ID:SECRETO", solo servidor.
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

export interface RespuestaHF {
  status: EstadoHF;
  request_id: string;
  status_url: string;
  cancel_url: string;
  video?: { url: string } | null;
  images?: { url: string }[] | null;
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
  intentos = 3,
): Promise<T> {
  let ultimo: Error | null = null;

  for (let i = 0; i < intentos; i++) {
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

    if (REINTENTABLES.has(res.status)) {
      ultimo = new Error(`Higgsfield contestó ${res.status}.`);
      continue;
    }

    const detalle = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("Credenciales de Higgsfield inválidas.");
    if (res.status === 403) throw new Error("Sin créditos en Higgsfield.");
    throw new Error(
      `Higgsfield rechazó la solicitud (${res.status}): ${detalle.slice(0, 300)}`,
    );
  }

  throw ultimo ?? new Error("No se pudo hablar con Higgsfield.");
}

export interface EntradaDop {
  model: ModeloDop;
  prompt: string;
  input_images: { type: "image_url"; image_url: string }[];
  enhance_prompt?: boolean;
  seed?: number;
}

/** Encola una generación imagen→video. Contesta de inmediato con el request_id. */
export async function generarVideo(entrada: EntradaDop): Promise<RespuestaHF> {
  // La API pide el cuerpo envuelto en `params`; mandarlo directo da 422.
  return llamar<RespuestaHF>("/v1/image2video/dop", {
    method: "POST",
    body: JSON.stringify({ params: entrada }),
  });
}

/** Pregunta cómo va una solicitud; al completarse trae la URL del video. */
export async function estadoSolicitud(requestId: string): Promise<RespuestaHF> {
  return llamar<RespuestaHF>(`/requests/${requestId}/status`, { method: "GET" });
}
