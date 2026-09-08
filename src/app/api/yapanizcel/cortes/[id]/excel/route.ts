import { NextResponse, type NextRequest } from "next/server";
import { conSesion } from "@/lib/yapanizcel/api";
import { cargarCorteGuardado } from "@/lib/servicios/corte-meli";
import { excelDelCorte } from "@/lib/servicios/corte-meli-excel";
import { respuestaExcel } from "@/app/api/ventas/_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await conSesion();
  if (!s.ok) return s.respuesta;
  const { id } = await ctx.params;
  const corteId = Number(id);
  if (!Number.isFinite(corteId)) return NextResponse.json({ error: "Corte inválido." }, { status: 400 });
  const corte = await cargarCorteGuardado(s.db, s.cuenta.id, corteId, "yz_cortes");
  if (!corte) return NextResponse.json({ error: "Ese corte no existe." }, { status: 404 });
  return respuestaExcel(await excelDelCorte(corte.estado, { negocio: "YAPANIZCEL · fundas" }), `corte-fundas-${corte.estado.periodo}.xlsx`);
}
