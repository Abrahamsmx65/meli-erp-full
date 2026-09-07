import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { conSesion } from "@/lib/yapanizcel/api";
import { hacerCorteYz } from "@/lib/yapanizcel/corte";
import { revisarPeriodoYz } from "@/lib/yapanizcel/devoluciones";
import { rangoDelPeriodo, validarPeriodo } from "@/lib/servicios/corte-meli";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST { periodo } -> revisa devoluciones y cancelaciones del mes (lo que alcance) y hace el corte de fundas. */
export async function POST(req: Request) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const cuerpo = await req.json().catch(() => ({}));
  const periodo = validarPeriodo(cuerpo?.periodo);
  if (!periodo) return NextResponse.json({ error: "Periodo inválido (YYYY-MM)." }, { status: 400 });
  const inicio = Date.now();
  let revision: unknown = null;
  let errorRevision: string | null = null;
  try {
    revision = await revisarPeriodoYz(clienteAdmin(), ctx.cuenta.id, rangoDelPeriodo(periodo), inicio + 200_000);
  } catch (err) {
    errorRevision = (err as Error).message;
  }
  try {
    const { id, estado } = await hacerCorteYz(ctx.db, ctx.cuenta, periodo, ctx.userId);
    return NextResponse.json({
      id,
      periodo,
      utilidadNeta: estado.utilidadNeta,
      exacto: estado.revision.exacto,
      pendientes: estado.revision.pendientes,
      avisos: estado.avisos,
      revision,
      errorRevision,
      ms: Date.now() - inicio,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, revision, errorRevision }, { status: 500 });
  }
}
