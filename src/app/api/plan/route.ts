import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { generarPlanCompleto, guardarPlan } from "@/lib/servicios/plan";
import { recalcular } from "@/lib/servicios/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Recalcula el plan y opcionalmente lo guarda en el historial. */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json(
      { error: "Conecta primero tu cuenta de Mercado Libre." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));

  try {
    // Recalcular es lo más común: rehace el plan y refresca la caché, que es
    // de donde lee la pantalla.
    if (body?.recalcular) {
      const t0 = Date.now();
      const r = await recalcular(supabase, cuenta.id);
      return NextResponse.json({
        ok: true,
        ms: r.msCalculo ?? Date.now() - t0,
        resumen: r.plan.resumen,
      });
    }

    const completo = await generarPlanCompleto(supabase, cuenta.id, {
      parametros: body?.parametros,
    });

    let planId: string | null = null;
    if (body?.guardar) planId = await guardarPlan(supabase, cuenta.id, completo);

    // Respuesta CHICA: el cliente solo lee ok/planId/resumen. Antes se
    // devolvían también catálogo, cajas y líneas completos — megabytes de
    // JSON que el botón «Archivar» descartaba en cada clic.
    return NextResponse.json({
      ok: true,
      planId,
      resumen: completo.plan.resumen,
      avisos: completo.avisos,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
