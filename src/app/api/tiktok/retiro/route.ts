import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { rolDeSesion } from "@/lib/acceso/roles";
import { retirarDelAlmacenTikTok } from "@/lib/servicios/tiktok-retiro";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Retira del almacén de TikTok lo disponible de unos SKU: salida en el
 * kardex, salida a Industher y cero publicado en TikTok. Solo el dueño.
 *
 * Cuerpo: { skus: string[] }
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  if (rolDeSesion(user) !== "dueño") return NextResponse.json({ error: "Solo el dueño puede retirar inventario." }, { status: 403 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const skus = Array.isArray(body?.skus) ? body.skus.map(String) : [];
  if (!skus.length) return NextResponse.json({ error: "No se eligió ningún SKU." }, { status: 400 });

  try {
    const r = await retirarDelAlmacenTikTok(clienteAdmin(), cuenta.id, skus, user.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
