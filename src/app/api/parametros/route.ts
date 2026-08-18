import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, guardarParametros, leerParametros } from "@/lib/datos/repos";
import { normalizarParametros } from "@/lib/engine/params";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const previos = await leerParametros(supabase, cuenta.id);

  // Se normaliza antes de guardar: así lo que queda en la base ya es válido
  // y ninguna lectura posterior tiene que desconfiar de estos números.
  const limpios = normalizarParametros({ ...previos, ...body });

  try {
    await guardarParametros(supabase, cuenta.id, limpios);
    return NextResponse.json({ ok: true, parametros: limpios });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
