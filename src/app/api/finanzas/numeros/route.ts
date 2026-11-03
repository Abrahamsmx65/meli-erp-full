import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { guardarNumeros } from "@/lib/servicios/numeros";

export const dynamic = "force-dynamic";

/** Guarda lo que el dueño fija de un modelo en Números (precios, envíos, variantes). */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({}));
    await guardarNumeros(supabase as DB, cuenta.id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
