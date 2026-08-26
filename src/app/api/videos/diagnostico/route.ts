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

  // Ronda 6: el MCP oficial de Higgsfield (mcp.higgsfield.ai). Queremos ver
  // su reto de autenticación OAuth y metadatos — sin credenciales todavía.
  async function ver(url: string, init?: RequestInit) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      const texto = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
      const headers: Record<string, string> = {};
      for (const k of ["www-authenticate", "content-type", "mcp-session-id"]) {
        const v = res.headers.get(k);
        if (v) headers[k] = v;
      }
      return { url, status: res.status, headers, texto };
    } catch (err) {
      return { url, error: (err as Error).message.slice(0, 200) };
    }
  }

  const sondeos = [
    await ver("https://mcp.higgsfield.ai/.well-known/oauth-protected-resource"),
    await ver("https://mcp.higgsfield.ai/.well-known/oauth-protected-resource/mcp"),
    await ver("https://mcp.higgsfield.ai/.well-known/oauth-authorization-server"),
    await ver("https://mcp.higgsfield.ai/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "meli-erp", version: "1.0" },
        },
      }),
    }),
  ];

  return NextResponse.json({ sondeos });
}
