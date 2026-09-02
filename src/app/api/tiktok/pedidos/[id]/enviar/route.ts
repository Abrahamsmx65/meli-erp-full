import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { confirmarEnvio } from "@/lib/servicios/tiktok";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Confirma el envío de un pedido en TikTok desde el ERP y descuenta en el
 * mismo clic. Cuerpo: { handover: "PICKUP" | "DROP_OFF", guia?, proveedorId? }.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const handover = body?.handover === "DROP_OFF" ? "DROP_OFF" : "PICKUP";

  try {
    const r = await confirmarEnvio(clienteAdmin(), cuenta.id, id, {
      handover,
      guia: body?.guia ? String(body.guia) : null,
      proveedorId: body?.proveedorId ? String(body.proveedorId) : null,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
