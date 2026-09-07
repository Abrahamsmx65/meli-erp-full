import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { configuracionTikTok } from "@/lib/tiktok/client";
import { firmaDeWebhook, firmaValida } from "@/lib/tiktok/firma";
import { procesarWebhooksPendientes } from "@/lib/servicios/tiktok";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Bandeja de entrada de los avisos de TikTok Shop.
 *
 * TikTok avisa en el momento en que un pedido cambia de estado (pagado,
 * enviado, cancelado, devuelto). Igual que con MELI: se guarda, se contesta
 * 200 de inmediato, y el trabajo de verdad —jalar ese pedido, mover el
 * kardex, republicar— corre DESPUÉS de responder.
 *
 * La ruta es pública por necesidad, así que cada aviso trae una firma
 * (HMAC con el app_secret sobre app_key + cuerpo) que se verifica en tiempo
 * constante. Sin firma válida no se guarda nada.
 */
export async function POST(req: NextRequest) {
  const app = configuracionTikTok();
  if (!app) return NextResponse.json({ ok: true });

  const crudo = await req.text();
  const esperada = firmaDeWebhook(app.appKey, crudo, app.appSecret);
  if (!firmaValida(req.headers.get("authorization"), esperada)) {
    return NextResponse.json({ error: "Firma inválida." }, { status: 401 });
  }

  let cuerpo: any;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const shopId = cuerpo?.shop_id ? String(cuerpo.shop_id) : null;
  const orderId = cuerpo?.data?.order_id ? String(cuerpo.data.order_id) : null;

  const admin = clienteAdmin();
  const { data: tienda } = shopId
    ? await admin.from("tiktok_tienda").select("account_id").eq("shop_id", shopId).maybeSingle()
    : { data: null };

  // Aviso de una tienda que no es nuestra: 200 y nada más, para que TikTok
  // no lo reintente para siempre.
  if (!tienda) return NextResponse.json({ ok: true });

  await admin.from("tiktok_webhooks").insert({
    account_id: tienda.account_id,
    shop_id: shopId,
    tipo: Number(cuerpo?.type) || null,
    order_id: orderId,
    payload: cuerpo,
  });

  after(async () => {
    try {
      await procesarWebhooksPendientes(admin, tienda.account_id);
    } catch (err) {
      console.error("tiktok webhook: no se pudo procesar:", (err as Error).message);
    }
  });

  return NextResponse.json({ ok: true });
}
