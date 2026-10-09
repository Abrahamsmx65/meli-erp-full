import { NextResponse } from "next/server";
import { periodoActual, periodoAnterior, validarPeriodo } from "@/lib/servicios/corte-meli";
import { leerConsolidadoGuardado, leerMismosDiasGuardado, obtenerConsolidado } from "@/lib/servicios/consolidado-cargar";
import { compararMeses } from "@/lib/servicios/consolidado-comparar";
import { pdfDelConsolidado } from "@/lib/servicios/consolidado-pdf";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { respuestaPdf, sesionYCuenta } from "@/app/api/ventas/_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET ?periodo=YYYY-MM[&descargar=1] -> informe en PDF con lo que hay HOY (vista previa, sin guardar corte). */
export async function GET(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const url = new URL(req.url);
  const periodo = validarPeriodo(url.searchParams.get("periodo")) ?? periodoActual();
  const descargar = url.searchParams.get("descargar") === "1";
  try {
    const [cns, anterior, mismosDias] = await Promise.all([
      obtenerConsolidado(s.supabase, s.cuenta, periodo),
      leerConsolidadoGuardado(s.supabase, s.cuenta, periodoAnterior(periodo)).catch(() => null),
      leerMismosDiasGuardado(s.supabase, s.cuenta, periodo).catch(() => null),
    ]);
    const comparacion = anterior ? compararMeses(cns, anterior, fechaMx(0), mismosDias) : null;
    return respuestaPdf(await pdfDelConsolidado(cns, { comparacion, preliminar: true }), `estado-de-resultados-${periodo}-vista-previa.pdf`, descargar);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
