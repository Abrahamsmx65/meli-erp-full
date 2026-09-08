import { NextResponse, type NextRequest } from "next/server";
import { cargarCorteGeneral } from "@/lib/servicios/consolidado-cargar";
import { excelDelConsolidado } from "@/lib/servicios/consolidado-excel";
import { respuestaExcel, sesionYCuenta } from "@/app/api/ventas/_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const { id } = await ctx.params;
  const corteId = Number(id);
  if (!Number.isFinite(corteId)) return NextResponse.json({ error: "Corte inválido." }, { status: 400 });
  const cns = await cargarCorteGeneral(s.supabase, s.cuenta.id, corteId);
  if (!cns) return NextResponse.json({ error: "Ese corte no existe." }, { status: 404 });
  return respuestaExcel(await excelDelConsolidado(cns), `corte-general-${cns.periodo}.xlsx`);
}
