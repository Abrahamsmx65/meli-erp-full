import { NextResponse, type NextRequest } from "next/server";
import { sesionYCuenta } from "../_comun";
import { conciliarVentasMeli } from "@/lib/meli/conciliar-ventas-db";
import type { VentaReporte } from "@/lib/meli/conciliar-ventas";
import { leerCuerpoGzip } from "@/lib/servicios/cuerpo-gzip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Conciliación de MELI: el navegador lee el Excel de Ventas de Mercado
 * Libre (`leerReporteVentas`) y manda las ventas compactas en gzip:
 * `{ ventas: VentaReporte[] }`. Aquí se cruzan contra `ordenes_neto` por
 * venta. No escribe nada.
 */
export async function POST(req: NextRequest) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;

  let ventas: VentaReporte[];
  try {
    const cuerpo = await leerCuerpoGzip<{ ventas?: VentaReporte[] }>(req);
    ventas = Array.isArray(cuerpo?.ventas) ? cuerpo.ventas : [];
  } catch (err) {
    return NextResponse.json({ error: `No pude leer el envío: ${(err as Error).message}` }, { status: 400 });
  }
  if (!ventas.length) return NextResponse.json({ error: "El reporte no trae ventas." }, { status: 400 });

  try {
    const informe = await conciliarVentasMeli(s.supabase, s.cuenta.id, ventas);
    return NextResponse.json(informe, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
