import { NextResponse } from "next/server";
import { cargarEstadoResultados, periodoActual, validarPeriodo } from "@/lib/servicios/corte-meli";
import { excelDelCorte } from "@/lib/servicios/corte-meli-excel";
import { respuestaExcel, sesionYCuenta } from "../../_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET ?periodo=YYYY-MM -> Excel con toda la información del corte (cálculo de hoy). */
export async function GET(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const periodo = validarPeriodo(new URL(req.url).searchParams.get("periodo")) ?? periodoActual();
  try {
    const estado = await cargarEstadoResultados(s.supabase, s.cuenta, periodo);
    return respuestaExcel(await excelDelCorte(estado), `corte-meli-${periodo}.xlsx`);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
