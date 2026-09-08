import { NextResponse } from "next/server";
import { borrarGasto, crearGasto } from "@/lib/servicios/gastos-api";
import { refrescarCorteMeli } from "@/lib/servicios/corte-cache";
import { validarPeriodo } from "@/lib/servicios/corte-meli";
import { sesionYCuenta } from "../_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * El corte del periodo vive masticado: tras capturar o borrar un gasto se
 * recalcula AQUÍ el renglón de su mes, para que quien capturó lo vea al
 * recargar (si falla, el refresco de fondo del corte lo levanta después).
 */
async function refrescarPeriodoDeFecha(s: { supabase: any; cuenta: any }, fecha?: string | null): Promise<void> {
  const periodo = validarPeriodo(typeof fecha === "string" ? fecha.slice(0, 7) : null);
  if (!periodo) return;
  try {
    await refrescarCorteMeli(s.supabase, s.cuenta, periodo);
  } catch (err) {
    console.error("gastos: corte sin refrescar:", (err as Error).message);
  }
}

/** POST { fecha, concepto, categoria, monto } -> captura un gasto del mes. */
export async function POST(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const cuerpo = await req.json().catch(() => ({}));
  const r = await crearGasto(s.supabase, s.cuenta.id, s.userId, cuerpo, "gastos_meli");
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.id ? 500 : 400 });
  await refrescarPeriodoDeFecha(s, cuerpo?.fecha);
  return NextResponse.json({ id: r.id });
}

/** DELETE { id } -> borra un gasto capturado. */
export async function DELETE(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const r = await borrarGasto(s.supabase, s.cuenta.id, await req.json().catch(() => ({})), "gastos_meli");
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  await refrescarPeriodoDeFecha(s, r.fecha);
  return NextResponse.json({ ok: true });
}
