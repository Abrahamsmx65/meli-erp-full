import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { marcarPreparado } from "@/lib/servicios/tiktok-despacho";
import { clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Constancia de que un paquete pasó los tres escaneos. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const { id } = await ctx.params;
  const corteId = Number(id);
  const body = await req.json().catch(() => ({}));
  const numero = Number(body?.numero);
  const orderId = String(body?.orderId ?? "");
  if (!Number.isFinite(corteId) || !Number.isFinite(numero) || !orderId) {
    return NextResponse.json({ error: "Faltan datos del paquete." }, { status: 400 });
  }

  try {
    await marcarPreparado(supabase, cuenta.id, corteId, {
      numero,
      orderId,
      packageId: String(body?.packageId ?? ""),
      escaneos: Array.isArray(body?.escaneos) ? body.escaneos.map(String).slice(0, 50) : [],
      usuario: user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
