import { NextResponse } from "next/server";
import { conSesion } from "@/lib/yapanizcel/api";
import { cargarEstadoResultadosYz } from "@/lib/yapanizcel/corte";
import { periodoActual, validarPeriodo } from "@/lib/servicios/corte-meli";
import { pdfDelCorte } from "@/lib/servicios/corte-meli-pdf";
import { respuestaPdf } from "@/app/api/ventas/_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET ?periodo=YYYY-MM -> PDF de vista previa del corte de fundas, sin guardar. */
export async function GET(req: Request) {
  const s = await conSesion();
  if (!s.ok) return s.respuesta;
  const periodo = validarPeriodo(new URL(req.url).searchParams.get("periodo")) ?? periodoActual();
  try {
    const estado = await cargarEstadoResultadosYz(s.db, s.cuenta, periodo);
    return respuestaPdf(await pdfDelCorte(estado, { preliminar: true, negocio: "YAPANIZCEL · fundas" }), `corte-fundas-${periodo}-preliminar.pdf`);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
