import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, RecursoOcupadoError } from "@/lib/datos/repos";
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
  const admin = clienteAdmin();

  try {
    // La sincronización necesita leer tokens, que RLS esconde a propósito.
    const resultado = await sincronizar(admin, cuenta.id, {
      diasHistoria: body?.diasHistoria,
      soloStock: body?.soloStock === true,
    });
    // Lo que haya quedado sin SKU se resuelve solo, en segundo plano. Las
    // cookies van de respaldo: sin CRON_SECRET, la sesión del que sincroniza
    // también enciende el proceso.
    if (resultado.descartadas.sinSku > 0) {
      await dispararPendientes(
        process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin,
        req.headers.get("cookie"),
      );
    }

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    if (err instanceof RecursoOcupadoError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
