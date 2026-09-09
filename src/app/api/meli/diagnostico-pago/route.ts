import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { leerPagoMercadoPago } from "@/lib/meli/pagos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Radiografía de UNA orden y sus pagos, tal como los devuelve MELI.
 *
 * Existe porque el desglose de cargos salió mal y no se puede arreglar a
 * ciegas: en la base, de 8,384 órdenes con cargos leídos, las retenciones de
 * ISR e IVA salieron en CERO y dos tercios del dinero acabó en
 * `cargos_sin_desglosar`. La sincronización pide `/collections/{id}`, que es
 * la forma vieja del pago, y de ahí solo salen escalares sueltos.
 *
 * Esto pregunta lo mismo por TRES caminos y enseña la respuesta cruda de cada
 * uno, para ver con qué nombre viene realmente cada cargo antes de escribir
 * una línea de clasificación. NO guarda nada: solo lee y responde.
 *
 *   /api/meli/diagnostico-pago?orden=2000018341066916
 */
const CAMINOS = [
  { nombre: "collections", ruta: (id: string) => `/collections/${id}` },
  { nombre: "payments_meli", ruta: (id: string) => `/payments/${id}` },
  { nombre: "payments_mp", ruta: (id: string) => `https://api.mercadopago.com/v1/payments/${id}` },
];

export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const ordenId = (req.nextUrl.searchParams.get("orden") ?? "").trim();
  if (!/^\d+$/.test(ordenId)) {
    return NextResponse.json(
      { error: "Falta ?orden=<número de venta>. Ejemplo: /api/meli/diagnostico-pago?orden=2000018341066916" },
      { status: 400 },
    );
  }

  const cliente = await clienteDeCuenta(supabase, cuenta.id);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI." }, { status: 400 });

  // 1. La orden cruda: de ahí salen los ids de pago y el precio de lista.
  let orden: any = null;
  let errorOrden: string | null = null;
  try {
    orden = await cliente.get<any>(`/orders/${ordenId}`, undefined, { reintentos: 1 });
  } catch (err) {
    errorOrden = (err as Error).message;
  }

  const idsPago: string[] = (orden?.payments ?? [])
    .map((p: any) => String(p?.id ?? ""))
    .filter(Boolean);

  // 2. Cada pago por los tres caminos, con lo que el clasificador saca de
  //    cada respuesta. Así se ve de un vistazo cuál trae ISR/IVA y cuál no.
  const pagos = [];
  for (const idPago of idsPago) {
    const intentos: Record<string, unknown> = {};
    for (const camino of CAMINOS) {
      try {
        const crudo = await cliente.get<unknown>(camino.ruta(idPago), undefined, { reintentos: 0 });
        intentos[camino.nombre] = {
          ok: true,
          llaves: Object.keys((crudo as any)?.collection ?? crudo ?? {}).sort(),
          interpretado: leerPagoMercadoPago(crudo),
          crudo,
        };
      } catch (err) {
        intentos[camino.nombre] = { ok: false, error: (err as Error).message };
      }
    }
    pagos.push({ idPago, intentos });
  }

  // 3. Lo que el ERP tiene guardado hoy de esa orden, para comparar.
  const { data: guardado } = await supabase
    .from("ordenes_neto")
    .select(
      "order_id, fecha, total, neto, neto_actual, comision_mp, envio_mp, isr_mp, iva_mp, otros_mp, cargos_sin_desglosar, tipo_venta, detalle_cargos, cargos_leidos_en",
    )
    .eq("account_id", cuenta.id)
    .eq("order_id", ordenId)
    .maybeSingle();

  return NextResponse.json(
    {
      orden: ordenId,
      errorOrden,
      // Lo que se busca en la orden: qué pagó el cliente (para la reventa) y
      // qué dice MELI que cobra de comisión y envío.
      resumenOrden: orden && {
        status: orden.status,
        tags: orden.tags,
        total_amount: orden.total_amount,
        paid_amount: orden.paid_amount,
        llaves: Object.keys(orden).sort(),
        pagos: (orden.payments ?? []).map((p: any) => ({
          id: p.id,
          status: p.status,
          transaction_amount: p.transaction_amount,
          total_paid_amount: p.total_paid_amount,
          net_received_amount: p.net_received_amount,
          marketplace_fee: p.marketplace_fee,
          shipping_cost: p.shipping_cost,
          taxes_amount: p.taxes_amount,
          llaves: Object.keys(p).sort(),
        })),
        renglones: (orden.order_items ?? []).map((i: any) => ({
          sku: i?.item?.seller_sku,
          quantity: i.quantity,
          unit_price: i.unit_price,
          full_unit_price: i.full_unit_price,
          sale_fee: i.sale_fee,
          listing_type_id: i.listing_type_id,
        })),
      },
      pagos,
      guardadoEnElErp: guardado ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
