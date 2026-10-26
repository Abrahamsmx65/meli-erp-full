import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { excelFacturaContenedor } from "@/lib/servicios/calculadora-precios";
import { mandarSolicitudFactura } from "@/lib/servicios/calculadora-correo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Excel para pedir la factura de un contenedor: modelo, código SAT, pares y precio con la calculadora fiscal. */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const numero = req.nextUrl.searchParams.get("numero");
  if (!numero) return NextResponse.json({ error: "Falta el contenedor." }, { status: 400 });
  const archivo = await excelFacturaContenedor(supabase as DB, cuenta, numero);
  if (!archivo) return NextResponse.json({ error: "Contenedor no encontrado." }, { status: 404 });
  return new NextResponse(new Uint8Array(archivo.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${archivo.nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Manda por correo la solicitud de factura del contenedor con el Excel adjunto. Cuerpo: { numero, para }. */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const cuerpo = (await req.json().catch(() => ({}))) as { numero?: string; para?: unknown };
  if (!cuerpo.numero) return NextResponse.json({ error: "Falta el contenedor." }, { status: 400 });
  try {
    const r = await mandarSolicitudFactura(supabase as DB, cuenta, cuerpo.numero, cuerpo.para);
    if (!r.enviado) return NextResponse.json({ error: r.motivo ?? "No se pudo mandar el correo.", para: r.para }, { status: 502 });
    return NextResponse.json({ ok: true, para: r.para });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
