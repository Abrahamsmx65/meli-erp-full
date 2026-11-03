import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { familiasDeCuenta, guardarFamilia, quitarFamilia } from "@/lib/servicios/familias-modelos";
import { refrescarCompraChinaSiHaceFalta } from "@/lib/servicios/compras-china";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Familias de modelos (`modelos_familias`): varios números que la fábrica
 * hace como un solo zapato y se piden juntos (GT117…GT122).
 *
 *   GET                                    → { familias: [{ familia, modelos }] }
 *   POST { familia, modelos: ["GT117", …] } → da de alta o rehace la familia
 *   POST { quitar: "GT117-GT122" }          → la quita (los modelos vuelven solos)
 *
 * Al guardar, la sugerencia de compra se vuelve a masticar por atrás para
 * que Planeación de compras ya los enseñe juntos.
 */
async function contexto() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No has iniciado sesión.", status: 401 as const };
  const c = await cuentaActiva(supabase);
  if (!c) return { error: "Conecta primero tu cuenta de Mercado Libre.", status: 400 as const };
  return { supabase, cuenta: c };
}

export async function GET() {
  const ctx = await contexto();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  return NextResponse.json({ familias: await familiasDeCuenta(ctx.supabase, ctx.cuenta.id) });
}

export async function POST(req: NextRequest) {
  const ctx = await contexto();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const cuerpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!cuerpo) return NextResponse.json({ error: "Se esperaba JSON." }, { status: 400 });
  const { supabase, cuenta } = ctx;
  try {
    const familias =
      typeof cuerpo.quitar === "string"
        ? await quitarFamilia(supabase, cuenta.id, cuerpo.quitar)
        : await guardarFamilia(
            supabase,
            cuenta.id,
            String(cuerpo.familia ?? ""),
            Array.isArray(cuerpo.modelos) ? (cuerpo.modelos as unknown[]).map(String) : [],
          );
    // La sugerencia guardada ya no agrupa como debe: se tumba y se rehace.
    await supabase
      .from("app_cache")
      .update({ vigente: false, motivo: "Cambiaron las familias de modelos." })
      .eq("account_id", cuenta.id)
      .like("clave", "compras-china%");
    after(async () => {
      await refrescarCompraChinaSiHaceFalta(supabase, cuenta.id).catch(() => null);
    });
    return NextResponse.json({ ok: true, familias });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
