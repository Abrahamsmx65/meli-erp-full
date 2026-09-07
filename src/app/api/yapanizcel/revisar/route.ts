import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { conSesion } from "@/lib/yapanizcel/api";
import { revisarPeriodoYz } from "@/lib/yapanizcel/devoluciones";
import { rangoDelPeriodo, validarPeriodo } from "@/lib/servicios/corte-meli";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST { periodo } -> revisa devoluciones y cancelaciones del mes que falten, con el tiempo que alcance. */
export async function POST(req: Request) {
  const s = await conSesion();
  if (!s.ok) return s.respuesta;
  const periodo = validarPeriodo((await req.json().catch(() => ({})))?.periodo);
  if (!periodo) return NextResponse.json({ error: "Periodo inválido (YYYY-MM)." }, { status: 400 });
  try {
    return NextResponse.json(await revisarPeriodoYz(clienteAdmin(), s.cuenta.id, rangoDelPeriodo(periodo), Date.now() + 250_000));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
