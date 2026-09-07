import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { conSesion } from "@/lib/yapanizcel/api";
import { almacenYz } from "@/lib/yapanizcel/corte";
import { sincronizarCargosCon } from "@/lib/servicios/cargos-meli";
import { validarPeriodo } from "@/lib/servicios/corte-meli";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST { periodo } -> lee (o sigue leyendo) la facturación de MELI de la cuenta de fundas. */
export async function POST(req: Request) {
  const s = await conSesion();
  if (!s.ok) return s.respuesta;
  const periodo = validarPeriodo((await req.json().catch(() => ({})))?.periodo);
  if (!periodo) return NextResponse.json({ error: "Periodo inválido (YYYY-MM)." }, { status: 400 });
  try {
    const admin = clienteAdmin();
    const r = await sincronizarCargosCon(admin, s.cuenta.id, periodo, await almacenYz(admin, s.cuenta.id), Date.now() + 240_000);
    if (r.error && r.cargos === 0) return NextResponse.json(r, { status: 502 });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
