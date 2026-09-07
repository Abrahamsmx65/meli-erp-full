import { NextResponse } from "next/server";
import { conSesion } from "@/lib/yapanizcel/api";
import { borrarGasto, crearGasto } from "@/lib/servicios/gastos-api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const s = await conSesion();
  if (!s.ok) return s.respuesta;
  const r = await crearGasto(s.db, s.cuenta.id, s.userId, await req.json().catch(() => ({})), "yz_gastos");
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ id: r.id });
}

export async function DELETE(req: Request) {
  const s = await conSesion();
  if (!s.ok) return s.respuesta;
  const r = await borrarGasto(s.db, s.cuenta.id, await req.json().catch(() => ({})), "yz_gastos");
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
