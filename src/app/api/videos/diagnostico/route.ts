import { NextResponse, type NextRequest } from "next/server";
import { credencialesHiggsfield } from "@/lib/higgsfield/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Ruta TEMPORAL (tercera ronda): descubrir los parámetros exactos de
// Seedream v4 Edit — el modelo de EDICIÓN que va a sustituir a Soul en el
// UGC porque preserva el producto real. Cuerpos inválidos a propósito: el
// error enumera los valores aceptados sin encolar ni cobrar nada.
const LLAVE = "dx-mgx7q4wkzt";

const BASE = "https://platform.higgsfield.ai";

async function sondear(
  ruta: string,
  cuerpo: unknown,
): Promise<{ ruta: string; cuerpo: unknown; status: number | string; detalle: string }> {
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
    return { ruta, cuerpo, status: res.status, detalle: texto.slice(0, 400) };
  } catch (err) {
    return { ruta, cuerpo, status: "error", detalle: (err as Error).message.slice(0, 200) };
  }
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("llave") !== LLAVE) {
    return NextResponse.json({ error: "No." }, { status: 404 });
  }
  if (!credencialesHiggsfield()) {
    return NextResponse.json({ error: "Sin HIGGSFIELD_CREDENTIALS en este entorno." });
  }

  const sondeos = [
    // ¿Existe y qué campos exige?
    await sondear("/bytedance/seedream/v4/edit", {}),
    // ¿Qué valores acepta aspect_ratio? (inválido a propósito)
    await sondear("/bytedance/seedream/v4/edit", {
      prompt: "x",
      image_url: "https://example.com/x.jpg",
      aspect_ratio: "9:99",
    }),
    // ¿Qué valores acepta resolution? (inválido a propósito)
    await sondear("/bytedance/seedream/v4/edit", {
      prompt: "x",
      image_url: "https://example.com/x.jpg",
      aspect_ratio: "9:16",
      resolution: "9K",
    }),
    // ¿image_url o image_urls? (por si pide lista)
    await sondear("/bytedance/seedream/v4/edit", {
      prompt: "x",
      image_urls: ["https://example.com/x.jpg"],
      aspect_ratio: "9:99",
    }),
  ];

  return NextResponse.json({ sondeos });
}
