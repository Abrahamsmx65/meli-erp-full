import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { sincronizar } from "@/lib/servicios/sync";
import { dispararPendientes } from "@/lib/servicios/disparar-pendientes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json(
      { error: "Todavía no conectas una cuenta de Mercado Libre." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));

  // Dos sincronizaciones a la vez compiten por la cuota de MELI y acaban
  // tumbándose entre ellas por tiempo. Si ya hay una viva, no se arranca otra.
  const admin = clienteAdmin();
  const { data: corriendo } = await admin
    .from("sync_log")
    .select("inicio")
    .eq("account_id", cuenta.id)
    .eq("estado", "corriendo")
    .gte("inicio", new Date(Date.now() - 10 * 60_000).toISOString())
    .limit(1);

  if (corriendo?.length) {
    return NextResponse.json(
      {
        error:
          "Ya hay una sincronización en curso. Espera a que termine antes de lanzar otra.",
      },
      { status: 409 },
    );
  }

  try {
    // La sincronización necesita leer tokens, que RLS esconde a propósito.
    const resultado = await sincronizar(admin, cuenta.id, {
      diasHistoria: body?.diasHistoria,
      soloStock: body?.soloStock === true,
    });
    // Lo que haya quedado sin SKU se resuelve solo, en segundo plano.
    if (resultado.descartadas.sinSku > 0) {
      await dispararPendientes(process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin);
    }

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
