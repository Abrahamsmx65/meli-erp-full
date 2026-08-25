import { NextResponse, type NextRequest } from "next/server";
import { credencialesHiggsfield } from "@/lib/higgsfield/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Ruta TEMPORAL de diagnóstico (segunda ronda): busca en la API oficial
// modelos de video con AUDIO NATIVO y más de 8 s (Sora 2, Kling 2.6/3.0,
// Wan 2.5/2.6…) para que la voz de IA del UGC también alcance 10-15 s.
// Un 404 model_not_found = no existe; un 400/422 pidiendo campos = existe.
// Los cuerpos son inválidos a propósito: nada se encola ni se cobra.
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
    return { ruta, status: res.status, detalle: texto.slice(0, 400) };
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

  // duration inválida a propósito: si el modelo existe, el error enumera las
  // duraciones que acepta sin encolar nada.
  const cuerpoMalo = { prompt: "x", image_url: "https://example.com/x.jpg", duration: 99 };

  const sondeos = await Promise.all([
    sondear("/sora-2/image-to-video", cuerpoMalo),
    sondear("/sora-2/text-to-video", cuerpoMalo),
    sondear("/openai/sora-2/image-to-video", cuerpoMalo),
    sondear("/sora2/image-to-video", cuerpoMalo),
    sondear("/kling-video/v2.6/standard/image-to-video", cuerpoMalo),
    sondear("/kling-video/v2.6/pro/image-to-video", cuerpoMalo),
    sondear("/kling-video/v3.0/standard/image-to-video", cuerpoMalo),
    sondear("/kling-video/v3.0/pro/image-to-video", cuerpoMalo),
    sondear("/wan/v2.5/image-to-video", cuerpoMalo),
    sondear("/wan/v2.6/image-to-video", cuerpoMalo),
    sondear("/wan-25-preview/image-to-video", cuerpoMalo),
    sondear("/alibaba/wan-2.5/image-to-video", cuerpoMalo),
    sondear("/veo3/image-to-video", cuerpoMalo),
    sondear("/veo3.1/fast/image-to-video", cuerpoMalo),
    sondear("/veo3.1/image-to-video", cuerpoMalo),
    sondear("/grok/image-to-video", cuerpoMalo),
    sondear("/xai/grok-video/image-to-video", cuerpoMalo),
    sondear("/bytedance/seedance/v2/pro/image-to-video", cuerpoMalo),
    sondear("/minimax/hailuo-02/standard/image-to-video", cuerpoMalo),
  ]);

  return NextResponse.json({ sondeos });
}
