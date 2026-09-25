import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta, liquidarPedidos } from "@/lib/servicios/tiktok";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Tope de pedidos por llamada: TikTok contesta ~1/s y Vercel da 5 min. */
const TOPE = 250;

/**
 * Lee de un jalón lo que TikTok va a pagar por hasta `cuantos` pedidos en
 * pie (los nunca leídos primero), con la misma lectura del sync
 * (`liquidarPedidos`). Es para el ARRANQUE: el sync lee 60 cada 15 min y
 * con miles de pedidos tardaría un día en tener todos. Se puede llamar
 * varias veces seguidas hasta que conteste `leidos: 0`.
 *
 *   /api/tiktok/diagnostico/pagos?cuantos=250
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const cuantos = Math.min(TOPE, Math.max(1, Number(req.nextUrl.searchParams.get("cuantos") ?? TOPE) || TOPE));
  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, cuenta.id, 280_000);
  if (!cliente || !cliente.tienda.shopCipher) return NextResponse.json({ error: "TikTok Shop no está conectado." }, { status: 400 });

  const avisos: string[] = [];
  const inicio = Date.now();
  const leidos = await liquidarPedidos(admin, cuenta.id, cliente, avisos, cuantos);
  const { count: pendientes } = await admin
    .from("tiktok_ordenes")
    .select("order_id", { count: "exact", head: true })
    .eq("account_id", cuenta.id)
    .eq("es_muestra", false)
    .in("estado", ["AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION", "IN_TRANSIT", "DELIVERED", "COMPLETED", "ON_HOLD"])
    .is("pago_leido_en", null);
  return NextResponse.json({ leidos, pedidosSinLeerTodavia: pendientes ?? null, segundos: Math.round((Date.now() - inicio) / 1000), avisos });
}
