import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { motivosDeCancelacion } from "@/lib/tiktok/api";
import { clienteDeCuenta } from "@/lib/servicios/tiktok";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Sonda de cancelación, SIN cancelar nada: le pregunta a TikTok los motivos
 * de cancelación de un pedido por todas las versiones del endpoint de
 * elegibilidad y además prueba la calculadora de reembolso con el motivo
 * de «sin stock», que suele contestar con la lista válida cuando el motivo
 * no le gusta. Contesta el crudo de todo, para leerlo tal cual.
 *
 *   /api/tiktok/diagnostico/cancelacion?pedido=586074997450901248
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const orderId = req.nextUrl.searchParams.get("pedido")?.trim();
  if (!orderId) return NextResponse.json({ error: "Falta ?pedido=" }, { status: 400 });

  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, cuenta.id, 100_000);
  if (!cliente || !cliente.tienda.shopCipher) return NextResponse.json({ error: "TikTok Shop no está conectado." }, { status: 400 });

  const { data: renglones } = await admin
    .from("tiktok_orden_items")
    .select("line_item_id, sku_id, cantidad, estado, bloqueo_motivo, bloqueo_resultado")
    .eq("account_id", cuenta.id)
    .eq("order_id", orderId);

  const elegibilidad = await motivosDeCancelacion(cliente, orderId);

  const probar = async (nombre: string, metodo: "GET" | "POST", ruta: string, opciones: any) => {
    try {
      return { nombre, ruta, opciones, respuesta: await cliente.llamar<any>(metodo, ruta, opciones) };
    } catch (err) {
      return { nombre, ruta, opciones, error: (err as Error).message };
    }
  };
  const ids = (renglones ?? []).map((r: any) => String(r.line_item_id));
  const skus = (renglones ?? []).map((r: any) => ({ sku_id: String(r.sku_id), quantity: Number(r.cantidad ?? 1) }));
  const sondas = await Promise.all([
    probar("calculadora con motivo sin stock (por renglón)", "POST", "/return_refund/202309/refunds/calculate", {
      cuerpo: { order_id: orderId, request_type: "CANCEL", reason_name: "ecom_order_to_ship_canceled_reason_out_of_stock", order_line_item_ids: ids },
    }),
    probar("calculadora con motivo sin stock (por sku)", "POST", "/return_refund/202309/refunds/calculate", {
      cuerpo: { order_id: orderId, request_type: "CANCEL", reason_name: "seller_out_of_stock", skus },
    }),
    probar("calculadora con motivo inventado (a ver si lista los válidos)", "POST", "/return_refund/202309/refunds/calculate", {
      cuerpo: { order_id: orderId, request_type: "CANCEL", reason_name: "x", order_line_item_ids: ids },
    }),
    probar("motivos de rechazo (locale es-MX)", "GET", "/return_refund/202309/reject_reasons", {
      params: { return_or_cancel_id: orderId, locale: "es-MX" },
    }),
  ]);

  return NextResponse.json({ pedido: orderId, renglones, elegibilidad, sondas });
}
