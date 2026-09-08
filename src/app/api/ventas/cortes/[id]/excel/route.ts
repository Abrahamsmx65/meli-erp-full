import { NextResponse, type NextRequest } from "next/server";
import { cargarCorteGuardado } from "@/lib/servicios/corte-meli";
import { excelDelCorte } from "@/lib/servicios/corte-meli-excel";
import { respuestaExcel, sesionYCuenta } from "../../../_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET -> Excel de un corte guardado. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const { id } = await ctx.params;
  const corteId = Number(id);
  if (!Number.isFinite(corteId)) return NextResponse.json({ error: "Corte inválido." }, { status: 400 });
  const corte = await cargarCorteGuardado(s.supabase, s.cuenta.id, corteId);
  if (!corte) return NextResponse.json({ error: "Ese corte no existe." }, { status: 404 });
  return respuestaExcel(await excelDelCorte(corte.estado), `corte-meli-${corte.estado.periodo}.xlsx`);
}
