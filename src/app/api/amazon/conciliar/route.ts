import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { conciliarReporte } from "@/lib/amazon/conciliar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Conciliación del dinero de Amazon: recibe el CSV del reporte de
 * transacciones de Seller Central (multipart, campo `archivo`) y devuelve
 * el cruce contra los eventos de la Finances API del mismo rango. No
 * escribe nada.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta de Amazon conectada." }, { status: 400 });

  let archivo: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("archivo");
    if (f instanceof File) archivo = f;
  } catch {
    return NextResponse.json({ error: "Manda el reporte como archivo (campo «archivo»)." }, { status: 400 });
  }
  if (!archivo) return NextResponse.json({ error: "Falta el archivo del reporte." }, { status: 400 });
  if (archivo.size > 40 * 1024 * 1024) return NextResponse.json({ error: "El archivo pasa de 40 MB." }, { status: 413 });

  try {
    const texto = new TextDecoder("utf-8").decode(await archivo.arrayBuffer());
    const informe = await conciliarReporte(supabase, cuenta.id, texto);
    return NextResponse.json(informe, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
