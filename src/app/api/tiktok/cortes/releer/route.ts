import { NextResponse } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { DIAS_RELEER_BOTON, TOPE_RELEER_BOTON, releerSinPrepararDeCortesRecientes } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * El botón «Actualizar» de Despacho: vuelve a leer en TikTok los pedidos
 * sin preparar de los cortes que la pantalla enseña y contesta cuáles
 * dejaron de faltar (ya enviados o cancelados). Lo mismo que corre de fondo
 * después de cada corte, pero en el momento y con respuesta.
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
    const r = await releerSinPrepararDeCortesRecientes(clienteAdmin(), cuenta.id, {
      dias: DIAS_RELEER_BOTON,
      tope: TOPE_RELEER_BOTON,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
