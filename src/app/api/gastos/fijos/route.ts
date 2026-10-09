import { NextResponse } from "next/server";
import { sesionYCuenta } from "@/app/api/ventas/_comun";
import { crearGastoFijo, darDeBajaGastoFijo, editarGastoFijo } from "@/lib/servicios/gastos-fijos";

export const dynamic = "force-dynamic";

/** Alta de un gasto fijo: { concepto, categoria, monto, desde: "YYYY-MM" }. */
export async function POST(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const r = await crearGastoFijo(s.supabase, s.cuenta.id, await req.json().catch(() => ({})));
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ id: r.id });
}

/** Cambio de la plantilla: aplica del mes en curso en adelante. */
export async function PUT(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const r = await editarGastoFijo(s.supabase, s.cuenta.id, await req.json().catch(() => ({})));
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ id: r.id });
}

/** Baja: { id, desde?: "YYYY-MM" } — deja de aplicar desde ese mes (por omisión, el actual). */
export async function DELETE(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const r = await darDeBajaGastoFijo(s.supabase, s.cuenta.id, await req.json().catch(() => ({})));
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
