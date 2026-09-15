import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { conciliarRenglones } from "@/lib/amazon/conciliar-db";
import type { RenglonReporte } from "@/lib/amazon/conciliar";
import { leerCuerpoGzip } from "@/lib/servicios/cuerpo-gzip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Conciliación del dinero de Amazon. El navegador lee el CSV del reporte de
 * transacciones de Seller Central (`leerReporteTransacciones`) y manda los
 * renglones compactos en gzip: `{ renglones: RenglonReporte[] }`. Aquí se
 * cruzan contra los eventos de la Finances API del mismo rango. No escribe.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta de Amazon conectada." }, { status: 400 });

  let renglones: RenglonReporte[];
  try {
    const cuerpo = await leerCuerpoGzip<{ renglones?: RenglonReporte[] }>(req);
    renglones = Array.isArray(cuerpo?.renglones) ? cuerpo.renglones : [];
  } catch (err) {
    return NextResponse.json({ error: `No pude leer el envío: ${(err as Error).message}` }, { status: 400 });
  }
  if (!renglones.length) return NextResponse.json({ error: "El reporte no trae renglones." }, { status: 400 });

  try {
    const informe = await conciliarRenglones(supabase, cuenta.id, renglones);
    return NextResponse.json(informe, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
