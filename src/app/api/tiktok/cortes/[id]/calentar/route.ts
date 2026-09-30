import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { dispararEtiquetasDelCorte } from "@/lib/servicios/disparar-etiquetas";
import {
  calentarEtiquetasDelCorte,
  corteSigueAbierto,
  estadoEtiquetasDelCorte,
  MAX_ESLABONES_ETIQUETAS,
  rearmarEtiquetasDelCorte,
} from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Presupuesto por llamada desde la pantalla: corto, para que el avance se vea y la pestaña no se quede colgada. */
const MS_POR_LLAMADA = 75_000;
/** Presupuesto de un eslabón de fondo: casi toda la función. */
const MS_POR_ESLABON = 280_000;

/**
 * Un ESLABÓN de fondo: el corte (o el eslabón anterior) lo prende con el
 * bearer de CRON_SECRET y `?cuenta=…&eslabon=n`. Contesta 202 en el acto y
 * trabaja después de responder; si al terminar todavía falta y hubo avance,
 * prende el siguiente. Así las etiquetas se arman y se guardan solas
 * después de confirmar el corte, sin pestaña ni cron (dueño, 30-sep-2026).
 */
function eslabonDeFondo(req: NextRequest, corteId: number): NextResponse | null {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secreto || auth !== `Bearer ${secreto}`) return null;
  const accountId = req.nextUrl.searchParams.get("cuenta") ?? "";
  const eslabon = Number(req.nextUrl.searchParams.get("eslabon") ?? "1");
  if (!accountId || !Number.isInteger(eslabon) || eslabon < 1) return NextResponse.json({ error: "Faltan cuenta o eslabón." }, { status: 400 });
  const inicio = Date.now();
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(async () => {
    const admin = clienteAdmin();
    try {
      // Mientras venga otra ronda que se le una, solo guías: los tomos se renumeran.
      const soloGuias = await corteSigueAbierto(admin, accountId, corteId);
      const r = await calentarEtiquetasDelCorte(admin, accountId, corteId, MS_POR_ESLABON - (Date.now() - inicio), { soloGuias });
      const falta = !r.completo || r.guiasSinRevisar > 0;
      const seguir = falta && !r.ocupado && r.avanzo && eslabon < MAX_ESLABONES_ETIQUETAS;
      await admin
        .from("tiktok_sync_log")
        .insert({
          account_id: accountId,
          tarea: "etiquetas",
          inicio: new Date(inicio).toISOString(),
          fin: new Date().toISOString(),
          estado: r.ocupado ? "con avisos" : "ok",
          detalle: { corteId, eslabon, soloGuias, ...r, seguir },
        })
        .then(() => undefined, () => undefined);
      if (seguir) await dispararEtiquetasDelCorte(origen, accountId, corteId, eslabon + 1);
    } catch (err) {
      await admin
        .from("tiktok_sync_log")
        .insert({ account_id: accountId, tarea: "etiquetas", inicio: new Date(inicio).toISOString(), fin: new Date().toISOString(), estado: "error", detalle: { corteId, eslabon, error: (err as Error).message } })
        .then(() => undefined, () => undefined);
    }
  });
  return NextResponse.json({ ok: true, corteId, eslabon }, { status: 202 });
}

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
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const corteIdFondo = Number(id);
  if (Number.isFinite(corteIdFondo)) {
    const fondo = eslabonDeFondo(req, corteIdFondo);
    if (fondo) return fondo;
  }
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
