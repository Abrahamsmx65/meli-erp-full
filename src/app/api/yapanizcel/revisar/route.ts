import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { conSesion } from "@/lib/yapanizcel/api";
import { revisarPeriodoYz } from "@/lib/yapanizcel/devoluciones";
import { rangoDelPeriodo, validarPeriodo } from "@/lib/servicios/corte-meli";
import { claveCorte } from "@/lib/servicios/corte-cache";
import { invalidarYz } from "@/lib/yapanizcel/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST { periodo } -> revisa devoluciones y cancelaciones del mes que falten, con el tiempo que alcance. */
export async function POST(req: Request) {
  const s = await conSesion();
  if (!s.ok) return s.respuesta;
  const periodo = validarPeriodo((await req.json().catch(() => ({})))?.periodo);
  if (!periodo) return NextResponse.json({ error: "Periodo inválido (YYYY-MM)." }, { status: 400 });
  try {
    const r = await revisarPeriodoYz(clienteAdmin(), s.cuenta.id, rangoDelPeriodo(periodo), Date.now() + 250_000);
    // La revisión mueve netos y devoluciones: el corte masticado quedó viejo.
    await invalidarYz(s.db, s.cuenta.id, "Se revisaron devoluciones del periodo.", [claveCorte(periodo)]);
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
