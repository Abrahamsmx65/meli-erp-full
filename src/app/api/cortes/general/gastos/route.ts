import { NextResponse } from "next/server";
import { sesionYCuenta } from "@/app/api/ventas/_comun";
import { borrarGastoEmpresarial, crearGastoEmpresarial, editarGastoEmpresarial } from "@/lib/servicios/gastos-empresariales";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const r = await crearGastoEmpresarial(s.supabase, s.cuenta.id, s.userId, await req.json().catch(() => ({})));
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.id ? 500 : 400 });
  return NextResponse.json({ id: r.id });
}

export async function PUT(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const r = await editarGastoEmpresarial(s.supabase, s.cuenta.id, await req.json().catch(() => ({})));
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ id: r.id });
}

export async function DELETE(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const r = await borrarGastoEmpresarial(s.supabase, s.cuenta.id, await req.json().catch(() => ({})));
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}