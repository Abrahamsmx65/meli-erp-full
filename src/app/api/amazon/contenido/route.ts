import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { guardarModelo } from "@/lib/servicios/contenido-escribir";

export const dynamic = "force-dynamic";

/**
 * Guarda lo que se le anota a un modelo en /amazon/contenido: categoría de la
 * store, prioridad de trabajo, palomeos de imágenes y A+, notas, y el
 * "quitar" que solo lo oculta de la lista. El cuerpo del guardado lo comparte
 * con el link sin contraseña (`contenido-escribir.ts`).
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

  const r = await guardarModelo(supabase, cuenta.id, await req.json().catch(() => ({})));
  return r.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
}
