import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { guardarCategoria } from "@/lib/servicios/contenido-escribir";

export const dynamic = "force-dynamic";

/**
 * Las categorías de la store de Amazon: alta, palomeos, renombrar y borrar.
 * Son lista propia (no las de productos_config, que agrupan por material para
 * costear): aquí se lleva cuáles ya se crearon, cuáles ya tienen imágenes y
 * cuáles ya tienen su página en la tienda.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay ninguna cuenta de Amazon conectada." }, { status: 400 });
  }

  const r = await guardarCategoria(supabase, cuenta.id, await req.json().catch(() => ({})));
  return r.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
}
