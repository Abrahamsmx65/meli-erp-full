import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { MeliClient } from "@/lib/meli/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Radiografía del NETO por venta: cuánto deposita MELI de verdad.
 *
 * La comisión (sale_fee) es solo una parte del descuento; también hay costo
 * de envío, cargos fijos y retenciones de impuestos. Mercado Pago expone el
 * neto ya masticado en transaction_details.net_received_amount, pero hay que
 * comprobar con datos reales (a) que nuestro token puede leerlo y (b) qué
 * incluye el desglose. Eso hace esta ruta: toma 3 órdenes recientes y
 * devuelve el pago como lo trae la orden, y el detalle completo pedido a
 * Mercado Pago por los dos caminos posibles.
 *
 * Es de lectura y pide sesión. Se borra cuando el neto quede integrado.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const admin = clienteAdmin();
  const { data: tok } = await admin
    .from("meli_tokens")
    .select("access_token, refresh_token, expira_en")
    .eq("account_id", cuenta.id)
    .single();
  if (!tok) return NextResponse.json({ error: "Sin tokens guardados." }, { status: 400 });

  const cliente = new MeliClient({
    clientId: process.env.MELI_CLIENT_ID!,
    clientSecret: process.env.MELI_CLIENT_SECRET!,
    credenciales: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiraEn: new Date(tok.expira_en).getTime(),
    },
    alRenovar: async (c) => {
      await admin
        .from("meli_tokens")
        .update({
          access_token: c.accessToken,
          refresh_token: c.refreshToken,
          expira_en: new Date(c.expiraEn).toISOString(),
          actualizado_en: new Date().toISOString(),
        })
        .eq("account_id", cuenta.id);
    },
  });

  const { data: cta } = await admin
    .from("meli_accounts")
    .select("meli_user_id")
    .eq("id", cuenta.id)
    .single();

  const r = await cliente.get<{ results: Record<string, unknown>[] }>("/orders/search", {
    seller: cta?.meli_user_id,
    "order.status": "paid",
    sort: "date_desc",
    limit: 3,
    offset: 0,
  });

  const salida: Record<string, unknown>[] = [];

  for (const orden of (r.results ?? []).slice(0, 3)) {
    const pagos = (orden as any).payments ?? [];
    const pago = pagos[0] ?? null;
    const pagoId = pago?.id;

    const fila: Record<string, unknown> = {
      orden: (orden as any).id,
      total: (orden as any).total_amount,
      // El pago tal como viene INCRUSTADO en la orden (qué campos trae).
      pagoEnOrden: pago,
    };

    if (pagoId) {
      // Camino 1: la API de Mercado Pago con el mismo token.
      try {
        const rp = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, {
          headers: { authorization: `Bearer ${tok.access_token}` },
          cache: "no-store",
        });
        const cuerpo = await rp.json().catch(() => null);
        fila.mercadoPago = {
          status: rp.status,
          transaction_details: cuerpo?.transaction_details ?? null,
          fee_details: cuerpo?.fee_details ?? null,
          charges_details: cuerpo?.charges_details ?? null,
          taxes_amount: cuerpo?.taxes_amount ?? null,
          shipping_amount: cuerpo?.shipping_amount ?? null,
        };
      } catch (err) {
        fila.mercadoPago = { error: (err as Error).message.slice(0, 200) };
      }

      // Camino 2: el endpoint clásico de MELI para cobros.
      try {
        const rc = await fetch(`https://api.mercadolibre.com/collections/${pagoId}`, {
          headers: { authorization: `Bearer ${tok.access_token}` },
          cache: "no-store",
        });
        const cuerpo = await rc.json().catch(() => null);
        fila.collections = {
          status: rc.status,
          transaction_details: cuerpo?.transaction_details ?? null,
          net_received_amount: cuerpo?.net_received_amount ?? null,
        };
      } catch (err) {
        fila.collections = { error: (err as Error).message.slice(0, 200) };
      }
    }

    salida.push(fila);
  }

  return NextResponse.json({ ordenes: salida });
}
