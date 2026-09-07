import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/tiktok";
import { paquetesDePedido } from "@/lib/tiktok/api";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Diagnóstico de entrega: qué método registró TikTok para los paquetes de
 * un pedido (recolección o drop-off) y qué opciones ofrece. Se guarda en la
 * bitácora tal cual contesta TikTok, sin la dirección del comprador, para
 * poder leerlo después sin volver a preguntar.
 *
 *   /api/tiktok/diagnostico/entrega?order=585847154291017119
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const orderId = req.nextUrl.searchParams.get("order")?.trim();
  if (!orderId) return NextResponse.json({ error: "Falta ?order=" }, { status: 400 });

  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, accountIdDe(cuenta), 50_000);
  if (!cliente) return NextResponse.json({ error: "TikTok Shop no está conectado." }, { status: 400 });

  const sinDireccion = (o: any) => {
    if (!o || typeof o !== "object") return o;
    const { recipient_address: _a, ...resto } = o;
    return resto;
  };

  const salida: any = { orderId, paquetes: [] as any[] };
  try {
    const paquetes = await paquetesDePedido(cliente, orderId);
    for (const p of paquetes) {
      const item: any = { packageId: p.id };
      try {
        item.detalle = sinDireccion(await cliente.llamar<any>("GET", `/fulfillment/202309/packages/${p.id}`));
      } catch (err) {
        item.detalleError = (err as Error).message;
      }
      try {
        item.horarios = await cliente.llamar<any>("GET", `/fulfillment/202309/packages/${p.id}/handover_time_slots`);
      } catch (err) {
        item.horariosError = (err as Error).message;
      }
      salida.paquetes.push(item);
    }
  } catch (err) {
    salida.error = (err as Error).message;
  }

  await admin.from("tiktok_sync_log").insert({
    account_id: cuenta.id,
    tarea: "diagnostico-entrega",
    inicio: new Date().toISOString(),
    fin: new Date().toISOString(),
    estado: salida.error ? "error" : "ok",
    detalle: salida,
  });

  return NextResponse.json(salida);
}

function accountIdDe(cuenta: { id: string }): string {
  return cuenta.id;
}
