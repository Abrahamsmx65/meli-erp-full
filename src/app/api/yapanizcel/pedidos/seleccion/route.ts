import { NextResponse, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { guardarDisenosElegidos } from "@/lib/yapanizcel/cuenta";

export const dynamic = "force-dynamic";

/**
 * Guarda los diseños ELEGIDOS en Pedidos a China, por cuenta: se quedan
 * hasta que el dueño los quite, en cualquier equipo. Body: { disenos: string[] }.
 */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => null);
  const disenos = Array.isArray(body?.disenos)
    ? [...new Set((body.disenos as unknown[]).map((d) => String(d ?? "").trim().toUpperCase()).filter(Boolean))].slice(0, 500)
    : null;
  if (!disenos) return NextResponse.json({ error: "Faltan los diseños." }, { status: 400 });
  try {
    await guardarDisenosElegidos(ctx.db, ctx.cuenta.id, disenos);
    return NextResponse.json({ ok: true, disenos });
  } catch (err) {
    return errorJson(err);
  }
}
