import { NextResponse } from "next/server";
import { normalizarRango } from "@/lib/servicios/ventas-monitor";
import { excelDeAuditoria, ordenesDelRangoParaAuditar } from "@/lib/servicios/finanzas/auditoria";
import { respuestaExcel, sesionYCuenta } from "../_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → Excel con TODAS las órdenes del
 * rango y su cascada (comisión, envío, retenciones, neto, fuente), para
 * cotejar contra Mercado Pago o el reporte "Ventas MX".
 */
export async function GET(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const p = new URL(req.url).searchParams;
  const rango = normalizarRango(p.get("desde") ?? undefined, p.get("hasta") ?? undefined);
  try {
    const ordenes = await ordenesDelRangoParaAuditar(s.supabase, s.cuenta.id, rango);
    return respuestaExcel(await excelDeAuditoria(ordenes, rango), `auditoria-ordenes-${rango.desde}_${rango.hasta}.xlsx`);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
