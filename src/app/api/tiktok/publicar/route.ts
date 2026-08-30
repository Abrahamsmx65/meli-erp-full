import { NextResponse } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { publicarDisponibilidad } from "@/lib/servicios/tiktok";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Empuja a TikTok el disponible de todo lo que quedó desfasado, sin volver a
 * bajar pedidos. Es el botón de "ya capturé las entradas, publícalo".
 */
export async function POST() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  try {
    const r = await publicarDisponibilidad(clienteAdmin(), cuenta.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
