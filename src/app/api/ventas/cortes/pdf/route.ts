import { NextResponse } from "next/server";
import { cargarEstadoResultados, periodoActual, validarPeriodo } from "@/lib/servicios/corte-meli";
import { pdfDelCorte } from "@/lib/servicios/corte-meli-pdf";
import { respuestaPdf, sesionYCuenta } from "../../_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET ?periodo=YYYY-MM -> PDF de vista previa con lo que hay HOY, sin guardar corte. */
export async function GET(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const url = new URL(req.url);
  const periodo = validarPeriodo(url.searchParams.get("periodo")) ?? periodoActual();
  try {
    const estado = await cargarEstadoResultados(s.supabase, s.cuenta, periodo);
    const bytes = await pdfDelCorte(estado, { preliminar: true });
    return respuestaPdf(bytes, `corte-meli-${periodo}-preliminar.pdf`);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
