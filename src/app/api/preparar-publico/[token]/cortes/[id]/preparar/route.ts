import { NextResponse, type NextRequest } from "next/server";
import { cuentaPorTokenPreparar } from "@/lib/servicios/acceso-preparar";
import { marcarPreparado } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * La constancia de los escaneos, para quien entra con el link sin
 * contraseña. Del otro lado no hay RLS: solo se escribe en
 * tiktok_preparaciones y solo de la cuenta del token.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await ctx.params;
  const cuenta = await cuentaPorTokenPreparar(token);
  if (!cuenta) return NextResponse.json({ error: "Este link ya no sirve." }, { status: 404 });

  const corteId = Number(id);
  const body = await req.json().catch(() => ({}));
  const numero = Number(body?.numero);
  const orderId = String(body?.orderId ?? "");
  if (!Number.isFinite(corteId) || !Number.isFinite(numero) || !orderId) {
    return NextResponse.json({ error: "Faltan datos del paquete." }, { status: 400 });
  }

  // El corte tiene que ser de esta cuenta: el token no abre cortes ajenos.
  const admin = clienteAdmin();
  const { data: corte } = await admin
    .from("tiktok_cortes")
    .select("id")
    .eq("account_id", cuenta.id)
    .eq("id", corteId)
    .maybeSingle();
  if (!corte) return NextResponse.json({ error: "Ese corte no existe." }, { status: 404 });

  try {
    await marcarPreparado(admin, cuenta.id, corteId, {
      numero,
      orderId,
      packageId: String(body?.packageId ?? ""),
      escaneos: Array.isArray(body?.escaneos) ? body.escaneos.map(String).slice(0, 50) : [],
      usuario: null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
