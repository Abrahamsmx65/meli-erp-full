import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { rangoDelPeriodo, validarPeriodo } from "@/lib/servicios/corte-meli";
import { claveCorte } from "@/lib/servicios/corte-cache";
import { invalidarApp } from "@/lib/servicios/cache-app";
import { revisarPeriodo } from "@/lib/servicios/devoluciones";
import { sesionYCuenta } from "../_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST { periodo } -> revisa devoluciones y cancelaciones de las órdenes del
 * mes que falten, con el tiempo que alcance. Se puede repetir hasta que
 * `quedan` sea 0.
 */
export async function POST(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const b = await req.json().catch(() => ({}));
  const periodo = validarPeriodo(b?.periodo);
  if (!periodo) return NextResponse.json({ error: "Periodo inválido (YYYY-MM)." }, { status: 400 });
  try {
    const r = await revisarPeriodo(clienteAdmin(), s.cuenta.id, rangoDelPeriodo(periodo), Date.now() + 250_000);
    // La revisión mueve netos y devoluciones: el corte masticado del periodo
    // quedó viejo; el refresco de fondo lo rehace en la siguiente visita.
    await invalidarApp(s.supabase, s.cuenta.id, "Se revisaron devoluciones del periodo.", { claves: [claveCorte(periodo)] });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
