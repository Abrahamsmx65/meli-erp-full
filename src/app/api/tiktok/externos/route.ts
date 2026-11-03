import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { desligarPublicacion, guardarStockExterno, ligarPublicacion } from "@/lib/servicios/tiktok-externos";
import { VENDEDOR_DAVID } from "@/lib/tiktok/externos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vendedores externos de TikTok (David). Cuerpo:
 *   { accion: "ligar",    productId, vendedor? }   — la publicación es de David
 *   { accion: "desligar", productId }              — vuelve a ser del dueño
 *   { accion: "stock",    renglones: [{ sku, pares }], vendedor? }
 *                                                  — su conteo: ajusta el kardex y publica a TikTok
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const admin = clienteAdmin();
  const vendedor = String(body?.vendedor ?? VENDEDOR_DAVID);
  try {
    if (body?.accion === "ligar") {
      return NextResponse.json({ ok: true, ...(await ligarPublicacion(admin, cuenta.id, String(body?.productId ?? ""), vendedor, user.id)) });
    }
    if (body?.accion === "desligar") {
      await desligarPublicacion(admin, cuenta.id, String(body?.productId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body?.accion === "stock") {
      const renglones = Array.isArray(body?.renglones) ? body.renglones : [];
      if (!renglones.length) return NextResponse.json({ error: "No se capturó nada." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await guardarStockExterno(admin, cuenta.id, vendedor, renglones, user.id)) });
    }
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
