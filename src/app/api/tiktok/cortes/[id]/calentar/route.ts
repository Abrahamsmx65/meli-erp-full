import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { calentarEtiquetasDelCorte, estadoEtiquetasDelCorte, rearmarEtiquetasDelCorte } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Presupuesto por llamada desde la pantalla: corto, para que el avance se vea y la pestaña no se quede colgada. */
const MS_POR_LLAMADA = 75_000;

async function contexto(ctx: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) };
  const { id } = await ctx.params;
  const corteId = Number(id);
  if (!Number.isFinite(corteId)) return { error: NextResponse.json({ error: "Corte inválido." }, { status: 400 }) };
  return { cuenta, corteId };
}

/** Qué tomos del PDF de etiquetas ya están guardados (no arma nada). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const c = await contexto(ctx);
  if ("error" in c) return c.error;
  try {
    return NextResponse.json(await estadoEtiquetasDelCorte(clienteAdmin(), c.cuenta.id, c.corteId));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Arma por atrás lo que falte de las etiquetas del corte, un rato por
 * llamada, y contesta el avance; la pantalla lo llama en bucle hasta que
 * `completo`. Si otro calentador ya lo tiene, contesta `ocupado` con el
 * estado.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const c = await contexto(ctx);
  if ("error" in c) return c.error;
  try {
    return NextResponse.json(await calentarEtiquetasDelCorte(clienteAdmin(), c.cuenta.id, c.corteId, MS_POR_LLAMADA));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Tira los tomos guardados del corte para que se rearmen (botón «Rearmar
 * etiquetas»: una hoja salió mal y el tomo ya estaba guardado). Contesta
 * el estado vacío; la pantalla llama al POST en bucle para rearmarlos.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const c = await contexto(ctx);
  if ("error" in c) return c.error;
  try {
    return NextResponse.json(await rearmarEtiquetasDelCorte(clienteAdmin(), c.cuenta.id, c.corteId));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
