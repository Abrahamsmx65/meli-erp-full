import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { guardarModeloNuevo } from "@/lib/servicios/modelos-nuevos";

export const dynamic = "force-dynamic";

/**
 * Agrega, anota o quita modelos de la lista de modelos nuevos: llegada a
 * mano, imágenes de China, clip, video, A+ cargado, notas y "listo". La
 * categoría y el precio se guardan por /api/costos, que es su dueño.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const r = await guardarModeloNuevo(supabase, cuenta.id, await req.json().catch(() => ({})));
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
}
