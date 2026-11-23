import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { rolDeSesion } from "@/lib/acceso/roles";
import { guardarModelosRetenidos, modelosRetenidos } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Modelos RETENIDOS de los cortes de despacho (preventa; dueño, 23-nov-2026:
 * «estoy haciendo en TikTok una preventa del GT148, lo voy a despachar en
 * 2 semanas; que no me lo metas a los cortes por ninguna manera»). Un pedido
 * con algún par de un modelo retenido no entra a ningún corte hasta que se
 * quita el modelo de la lista. Solo el dueño la cambia.
 *
 * GET → { modelos }. POST { modelos: string[] } reemplaza la lista completa.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  return NextResponse.json({ modelos: await modelosRetenidos(clienteAdmin(), cuenta.id) });
}

export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  if (rolDeSesion(user) !== "dueño") return NextResponse.json({ error: "Solo el dueño puede retener modelos de los cortes." }, { status: 403 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body?.modelos)) return NextResponse.json({ error: "Falta la lista de modelos." }, { status: 400 });
  try {
    const modelos = await guardarModelosRetenidos(clienteAdmin(), cuenta.id, body.modelos);
    return NextResponse.json({ ok: true, modelos });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
