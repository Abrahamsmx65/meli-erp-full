import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { sincronizarCargos } from "@/lib/servicios/cargos-meli";
import { validarPeriodo } from "@/lib/servicios/corte-meli";
import { sesionYCuenta } from "../_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST { periodo } -> lee del API de facturación de MELI los cargos del periodo. */
export async function POST(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const b = await req.json().catch(() => ({}));
  const periodo = validarPeriodo(b?.periodo);
  if (!periodo) return NextResponse.json({ error: "Periodo inválido (YYYY-MM)." }, { status: 400 });
  const r = await sincronizarCargos(clienteAdmin(), s.cuenta.id, periodo);
  if (r.error) return NextResponse.json({ error: r.error, cargos: r.cargos }, { status: 502 });
  return NextResponse.json(r);
}
