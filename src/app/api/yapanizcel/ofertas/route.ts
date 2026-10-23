import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { clienteDeCuenta } from "@/lib/yapanizcel/cuenta";
import { guardarConfigOfertasFundas, revisarOfertasFundas } from "@/lib/servicios/fundas-ofertas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * Ofertas con aporte de MELI de las fundas: `revisar` (solo lee), `aceptar`
 * (acepta las que cumplen el PV MELI del sheet) y `automatico` (prende o
 * apaga que relámpago, Buen Fin, todos los días y ofertas con aporte se
 * confirmen solas).
 */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const cuerpo = (await req.json().catch(() => ({}))) as { accion?: string; valor?: unknown };
  const admin = clienteAdmin() as DB;
  try {
    if (cuerpo.accion === "automatico") {
      await guardarConfigOfertasFundas(admin, ctx.cuenta.id, { automatico: Boolean(cuerpo.valor) });
      return NextResponse.json({ automatico: Boolean(cuerpo.valor) });
    }
    if (cuerpo.accion !== "revisar" && cuerpo.accion !== "aceptar") {
      return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
    const cliente = await clienteDeCuenta(admin, ctx.cuenta.id);
    const r = await revisarOfertasFundas(admin, cliente, ctx.cuenta.id, { aceptar: cuerpo.accion === "aceptar", origen: "manual" });
    return NextResponse.json({ generadoEn: r.generadoEn, ultimaAceptacion: r.ultimaAceptacion, avisos: r.avisos });
  } catch (err) {
    return errorJson(err);
  }
}
