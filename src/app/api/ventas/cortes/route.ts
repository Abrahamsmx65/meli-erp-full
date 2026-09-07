import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { hacerCorte, rangoDelPeriodo, validarPeriodo } from "@/lib/servicios/corte-meli";
import { revisarPeriodo } from "@/lib/servicios/devoluciones";
import { sesionYCuenta } from "../_comun";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST { periodo: "YYYY-MM" } -> hace el corte del mes.
 *
 * Antes de congelar nada revisa devoluciones y cancelaciones de las órdenes
 * del mes que falten (con el tiempo que quede); lo que no alcance lo
 * declara el corte en sus avisos y lo sigue el latido.
 */
export async function POST(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const cuerpo = await req.json().catch(() => ({}));
  const periodo = validarPeriodo(cuerpo?.periodo);
  if (!periodo) return NextResponse.json({ error: "Periodo inválido (YYYY-MM)." }, { status: 400 });

  const inicio = Date.now();
  let revision: unknown = null;
  let errorRevision: string | null = null;
  try {
    revision = await revisarPeriodo(clienteAdmin(), s.cuenta.id, rangoDelPeriodo(periodo), inicio + 200_000);
  } catch (err) {
    errorRevision = (err as Error).message;
  }

  try {
    const { id, estado } = await hacerCorte(s.supabase, s.cuenta, periodo, s.userId);
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
