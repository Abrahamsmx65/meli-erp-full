import { NextResponse } from "next/server";
import { conSesion } from "@/lib/yapanizcel/api";
import { borrarGasto, crearGasto } from "@/lib/servicios/gastos-api";
import { refrescarCorteYz } from "@/lib/servicios/corte-cache";
import { validarPeriodo } from "@/lib/servicios/corte-meli";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * El corte del periodo vive masticado: tras capturar o borrar un gasto se
 * recalcula AQUÍ el renglón de su mes, para que quien capturó lo vea al
 * recargar (si falla, el refresco de fondo del corte lo levanta después).
 */
async function refrescarPeriodoDeFecha(s: { db: any; cuenta: any }, fecha?: string | null): Promise<void> {
  const periodo = validarPeriodo(typeof fecha === "string" ? fecha.slice(0, 7) : null);
  if (!periodo) return;
  try {
    await refrescarCorteYz(s.db, s.cuenta, periodo);
  } catch (err) {
    console.error("gastos yz: corte sin refrescar:", (err as Error).message);
  }
}

export async function POST(req: Request) {
  const s = await conSesion();
  if (!s.ok) return s.respuesta;
  const cuerpo = await req.json().catch(() => ({}));
  const r = await crearGasto(s.db, s.cuenta.id, s.userId, cuerpo, "yz_gastos");
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  await refrescarPeriodoDeFecha(s, cuerpo?.fecha);
  return NextResponse.json({ id: r.id });
}

export async function DELETE(req: Request) {
  const s = await conSesion();
  if (!s.ok) return s.respuesta;
  const r = await borrarGasto(s.db, s.cuenta.id, await req.json().catch(() => ({})), "yz_gastos");
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  await refrescarPeriodoDeFecha(s, r.fecha);
  return NextResponse.json({ ok: true });
}
