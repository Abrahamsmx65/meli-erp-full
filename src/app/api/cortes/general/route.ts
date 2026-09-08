import { NextResponse } from "next/server";
import { validarPeriodo } from "@/lib/servicios/corte-meli";
import { hacerCorteGeneral } from "@/lib/servicios/consolidado-cargar";
import { sesionYCuenta } from "@/app/api/ventas/_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST { periodo } -> congela el corte general del mes (calzado + fundas + Amazon). */
export async function POST(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const periodo = validarPeriodo((await req.json().catch(() => ({})))?.periodo);
  if (!periodo) return NextResponse.json({ error: "Periodo inválido (YYYY-MM)." }, { status: 400 });
  try {
    const { id, consolidado } = await hacerCorteGeneral(s.supabase, s.cuenta, periodo, s.userId);
    return NextResponse.json({ id, periodo, utilidadNeta: consolidado.total.utilidadNeta, exacto: consolidado.exacto, avisos: consolidado.avisos.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
