import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { confirmarDevolucionRecibida, sincronizarDevoluciones } from "@/lib/servicios/tiktok-devoluciones";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function sesion() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) };
  return { supabase, user, cuenta };
}

/**
 * POST { accion: "sincronizar" } → vuelve a leer las devoluciones de TikTok.
 * POST { accion: "confirmar", returnId, decisiones: [{ returnLineItemId, destino }] }
 *   → le dice a TikTok que el paquete llegó (reembolsa) y mueve el kardex.
 */
export async function POST(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  const admin = clienteAdmin();
  try {
    if (body?.accion === "sincronizar") {
      return NextResponse.json(await sincronizarDevoluciones(admin, s.cuenta.id, { msPresupuesto: 90_000 }));
    }
    if (body?.accion === "confirmar") {
      const r = await confirmarDevolucionRecibida(admin, s.cuenta.id, String(body.returnId ?? ""), body.decisiones ?? [], s.user.id);
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
