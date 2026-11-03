import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { guardarParametrosCalculadora } from "@/lib/servicios/calculadora-precios";

export const dynamic = "force-dynamic";

/** Guarda los parámetros de la calculadora fiscal (gasto de Industher, unidades, %). */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  try {
    const parametros = await guardarParametrosCalculadora(supabase as DB, cuenta.id, await req.json().catch(() => ({})));
    return NextResponse.json({ ok: true, parametros });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
