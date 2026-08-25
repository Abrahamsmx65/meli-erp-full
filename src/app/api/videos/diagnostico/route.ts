import { NextResponse, type NextRequest } from "next/server";
import { credencialesHiggsfield } from "@/lib/higgsfield/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Ruta TEMPORAL de diagnóstico: sondea qué endpoints existen en la API de
// Higgsfield con la llave real y reproduce la subida de foto al CDN.
// No expone secretos (solo códigos y cuerpos de error) y se borra al
// terminar la investigación.
const LLAVE = "dx-mgx7q4wkzt";

const BASE = "https://platform.higgsfield.ai";

async function sondear(
  ruta: string,
  cuerpo: unknown,
): Promise<{ ruta: string; status: number | string; detalle: string }> {
  try {
    const res = await fetch(`${BASE}${ruta}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${credencialesHiggsfield()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30_000),
    });
    const texto = (await res.text().catch(() => "")).replace(/\s+/g, " ");
    return { ruta, status: res.status, detalle: texto.slice(0, 300) };
  } catch (err) {
    return { ruta, status: "error", detalle: (err as Error).message.slice(0, 200) };
  }
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("llave") !== LLAVE) {
    return NextResponse.json({ error: "No." }, { status: 404 });
  }
  if (!credencialesHiggsfield()) {
    return NextResponse.json({ error: "Sin HIGGSFIELD_CREDENTIALS en este entorno." });
  }

  // 1. Subida al CDN: el PUT prefirmado da SignatureDoesNotMatch en Vercel,
  //    así que se prueban variantes para aislar qué rompe la firma. Cada
  //    variante pide su PROPIA URL (podrían ser de un solo uso).
  // JPEG válido de 1x1 (mínimo verdadero, ~160 bytes).
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );

  async function pedirEnlace(): Promise<{ upload_url: string; public_url: string } | null> {
    const res = await fetch(`${BASE}/files/generate-upload-url`, {
      method: "POST",
      headers: {
        Authorization: `Key ${credencialesHiggsfield()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content_type: "image/jpeg" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { upload_url: string; public_url: string };
  }

  async function probarPut(
    nombre: string,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const enlace = await pedirEnlace().catch(() => null);
    if (!enlace?.upload_url) return { nombre, error: "sin enlace" };
    const u = new URL(enlace.upload_url);
    try {
      const put = await fetch(enlace.upload_url, {
        method: "PUT",
        headers,
        body: jpeg,
        signal: AbortSignal.timeout(60_000),
      });
      const detalle = put.ok
        ? ""
        : (await put.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      let lectura: number | null = null;
      if (put.ok) {
        const r = await fetch(enlace.public_url, { signal: AbortSignal.timeout(30_000) });
        lectura = r.status;
      }
      return {
        nombre,
        status: put.status,
        detalle,
        lectura,
        firma_headers: u.searchParams.get("X-Amz-SignedHeaders"),
        params: [...u.searchParams.keys()].filter((k) => k !== "X-Amz-Signature"),
      };
    } catch (err) {
      return { nombre, error: (err as Error).message.slice(0, 200) };
    }
  }

  const subida = {
    variantes: [
      await probarPut("con content-type", { "Content-Type": "image/jpeg" }),
      await probarPut("sin headers", {}),
      await probarPut("content-type y sin compresion", {
        "Content-Type": "image/jpeg",
        "Accept-Encoding": "identity",
      }),
    ],
  };

  // 2. Sondeo de endpoints: cuerpo vacío a propósito — un 404 dice "no
  //    existe", un 422/400 dice "existe y pide parámetros". Nada se encola.
  const sondeos = await Promise.all([
    sondear("/v1/speak/higgsfield", { params: {} }),
    sondear("/v1/speak/higgsfield", {}),
    sondear("/v1/text2speech", { params: {} }),
    sondear("/v1/text2speech/higgsfield", { params: {} }),
    sondear("/v1/text2speech_v2", { params: {} }),
    sondear("/text2speech_v2", { params: {} }),
    sondear("/v1/tts", { params: {} }),
    sondear("/v1/audio/tts", { params: {} }),
    sondear("/v1/speech/higgsfield", { params: {} }),
    sondear("/minimax/speech-02-hd", {}),
    sondear("/minimax/speech-2.5-hd-preview", {}),
    sondear("/elevenlabs/text-to-speech", {}),
    sondear("/elevenlabs/tts", {}),
    sondear("/bytedance/seed-speech", {}),
    sondear("/inworld/text-to-speech", {}),
    sondear("/vibe-voice/text-to-speech", {}),
    sondear("/veo3.1/image-to-video", {}),
    sondear("/kling-video/v2.5-turbo/standard/image-to-video", {}),
  ]);

  return NextResponse.json({ subida, sondeos });
}
