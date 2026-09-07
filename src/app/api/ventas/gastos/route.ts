import { NextResponse } from "next/server";
import { borrarGasto, crearGasto } from "@/lib/servicios/gastos-api";
import { sesionYCuenta } from "../_comun";

export const dynamic = "force-dynamic";

/** POST { fecha, concepto, categoria, monto } -> captura un gasto del mes. */
export async function POST(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const r = await crearGasto(s.supabase, s.cuenta.id, s.userId, await req.json().catch(() => ({})), "gastos_meli");
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.id ? 500 : 400 });
  return NextResponse.json({ id: r.id });
}

/** DELETE { id } -> borra un gasto capturado. */
export async function DELETE(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const r = await borrarGasto(s.supabase, s.cuenta.id, await req.json().catch(() => ({})), "gastos_meli");
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
