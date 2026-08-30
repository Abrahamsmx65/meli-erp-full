import { NextResponse } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { sincronizarTikTok } from "@/lib/servicios/tiktok";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Una vuelta completa a mano: pedidos, kardex y disponibilidad publicada.
 * Corre con service_role porque tiene que leer los tokens de la tienda.
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
    const r = await sincronizarTikTok(clienteAdmin(), cuenta.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
