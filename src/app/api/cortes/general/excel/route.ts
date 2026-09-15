import { NextResponse } from "next/server";
import { periodoActual, validarPeriodo } from "@/lib/servicios/corte-meli";
import { obtenerConsolidado } from "@/lib/servicios/consolidado-cargar";
import { excelDelConsolidado } from "@/lib/servicios/consolidado-excel";
import { respuestaExcel, sesionYCuenta } from "@/app/api/ventas/_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET ?periodo=YYYY-MM -> Excel del corte general con el cálculo de hoy. */
export async function GET(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const periodo = validarPeriodo(new URL(req.url).searchParams.get("periodo")) ?? periodoActual();
  try {
    const cns = await obtenerConsolidado(s.supabase, s.cuenta, periodo);
    return respuestaExcel(await excelDelConsolidado(cns), `corte-general-${periodo}.xlsx`);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
