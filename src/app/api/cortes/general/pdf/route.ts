import { NextResponse } from "next/server";
import { periodoActual, periodoAnterior, validarPeriodo } from "@/lib/servicios/corte-meli";
import { leerConsolidadoGuardado, leerMismosDiasGuardado, obtenerConsolidado } from "@/lib/servicios/consolidado-cargar";
import { compararMeses } from "@/lib/servicios/consolidado-comparar";
import { pdfDelConsolidado } from "@/lib/servicios/consolidado-pdf";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { respuestaPdf, sesionYCuenta } from "@/app/api/ventas/_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET ?periodo=YYYY-MM -> informe en PDF con lo que hay HOY (vista previa, sin guardar corte). */
export async function GET(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const periodo = validarPeriodo(new URL(req.url).searchParams.get("periodo")) ?? periodoActual();
  try {
    const [cns, anterior, mismosDias] = await Promise.all([
      obtenerConsolidado(s.supabase, s.cuenta, periodo),
      leerConsolidadoGuardado(s.supabase, s.cuenta, periodoAnterior(periodo)).catch(() => null),
      leerMismosDiasGuardado(s.supabase, s.cuenta, periodo).catch(() => null),
    ]);
    const comparacion = anterior ? compararMeses(cns, anterior, fechaMx(0), mismosDias) : null;
    return respuestaPdf(await pdfDelConsolidado(cns, { comparacion, preliminar: true }), `corte-general-${periodo}-vista-previa.pdf`);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
