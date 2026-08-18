import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { sincronizar } from "@/lib/servicios/sync";

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

  try {
    // La sincronización necesita leer tokens, que RLS esconde a propósito.
    const resultado = await sincronizar(clienteAdmin(), cuenta.id, {
      diasHistoria: body?.diasHistoria,
      soloStock: body?.soloStock === true,
    });
    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
