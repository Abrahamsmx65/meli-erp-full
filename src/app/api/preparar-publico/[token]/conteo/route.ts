import { NextResponse, type NextRequest } from "next/server";
import { cuentaPorTokenPreparar } from "@/lib/servicios/acceso-preparar";
import { guardarConteo, renglonesDelCuerpo } from "@/lib/servicios/tiktok-conteo";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * El conteo cíclico desde la estación sin contraseña. Del otro lado no hay
 * RLS: el token es la puerta y solo escribe ajustes en el kardex de TikTok
 * de la cuenta del token (ningún otro almacén, ninguna otra tabla).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const cuenta = await cuentaPorTokenPreparar(token);
  if (!cuenta) return NextResponse.json({ error: "Este link ya no sirve." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const renglones = renglonesDelCuerpo(body);
  if (!renglones.length) return NextResponse.json({ error: "No se contó nada." }, { status: 400 });

  try {
    const r = await guardarConteo(clienteAdmin(), cuenta.id, renglones, {
      usuario: null,
      escaneos: Array.isArray(body?.escaneos) ? body.escaneos.map(String) : [],
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
