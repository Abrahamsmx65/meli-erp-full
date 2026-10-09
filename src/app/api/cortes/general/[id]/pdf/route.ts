import { NextResponse, type NextRequest } from "next/server";
import { periodoAnterior } from "@/lib/servicios/corte-meli";
import { cargarCorteGeneral, leerConsolidadoGuardado } from "@/lib/servicios/consolidado-cargar";
import { compararMeses } from "@/lib/servicios/consolidado-comparar";
import { pdfDelConsolidado } from "@/lib/servicios/consolidado-pdf";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { respuestaPdf, sesionYCuenta } from "@/app/api/ventas/_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET -> el informe en PDF de un corte general guardado (tal como quedó al hacerlo). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const { id } = await ctx.params;
  const corteId = Number(id);
  if (!Number.isFinite(corteId)) return NextResponse.json({ error: "Corte inválido." }, { status: 400 });
  const cns = await cargarCorteGeneral(s.supabase, s.cuenta.id, corteId);
  if (!cns) return NextResponse.json({ error: "Ese corte no existe." }, { status: 404 });
  // El mes anterior solo se LEE (masticado por el cron); sin él, el informe sale sin comparación.
  const anterior = await leerConsolidadoGuardado(s.supabase, s.cuenta, periodoAnterior(cns.periodo)).catch(() => null);
  const comparacion = anterior ? compararMeses(cns, anterior, fechaMx(0)) : null;
  return respuestaPdf(await pdfDelConsolidado(cns, { comparacion }), `corte-general-${cns.periodo}.pdf`);
}
