import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cancelarPedidoTienda, enviarPedidoTienda, marcarEntregado } from "@/lib/servicios/tienda-pedidos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Acciones sobre un pedido de la tienda en línea (con sesión; el rol
 * TikTok también, porque despacha).
 * Cuerpo: { accion: "enviar", guia, paqueteria } | { accion: "entregado" } | { accion: "cancelar", nota? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  // La RLS decide si esta sesión puede ver el pedido; lo demás va con service_role.
  const id = Number((await params).id);
  const { data: visible } = await supabase.from("tienda_pedidos").select("id").eq("id", id).maybeSingle();
  if (!visible) return NextResponse.json({ error: "Ese pedido no existe." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const admin = clienteAdmin();
  try {
    if (body?.accion === "enviar") {
      const r = await enviarPedidoTienda(admin, cuenta.id, id, { guia: String(body.guia ?? ""), paqueteria: String(body.paqueteria ?? "") }, user.id);
      return NextResponse.json(r);
    }
    if (body?.accion === "entregado") return NextResponse.json(await marcarEntregado(admin, cuenta.id, id));
    if (body?.accion === "cancelar") {
      return NextResponse.json(await cancelarPedidoTienda(admin, cuenta.id, id, body.nota ? String(body.nota) : null));
    }
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
