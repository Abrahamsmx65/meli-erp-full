import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { revisarOrdenes } from "@/lib/servicios/devoluciones";
import { invalidarApp } from "@/lib/servicios/cache-app";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Re-enriquecer órdenes puntuales contra Mercado Libre y Mercado Pago, para
 * auditar al centavo contra el reporte oficial "Ventas MX" del vendedor.
 *
 * Vuelve a leer la orden (etiquetas de reventa, envío del comprador,
 * renglones) y cada uno de sus pagos por `/v1/payments/{id}`, recalcula la
 * cascada (comisión, envío del vendedor, retenciones, reventa reconstruida)
 * y la guarda en `ordenes_neto`. Luego tumba las finanzas cacheadas para
 * que /ventas muestre el efecto.
 *
 *   POST /api/meli/reenriquecer?ordenes=2000018341066916,2000014843734267
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const ids = (req.nextUrl.searchParams.get("ordenes") ?? "")
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x))
    .map(Number);
  if (!ids.length || ids.length > 50) {
    return NextResponse.json(
      { error: "Falta ?ordenes=<id,id,…> (hasta 50). Ejemplo: /api/meli/reenriquecer?ordenes=2000018341066916" },
      { status: 400 },
    );
  }

  // Los tokens viven en meli_tokens (RLS con cero políticas): solo el
  // service role los lee. La sesión ya validó quién pide y de qué cuenta.
  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI." }, { status: 400 });

  const r = await revisarOrdenes(admin, cuenta.id, cliente, {
    desde: "2000-01-01",
    hasta: "2100-01-01",
    tope: ids.length,
    finMs: Date.now() + 100_000,
    ordenIds: ids,
  });
  await invalidarApp(admin, cuenta.id, "reenriquecer", { prefijo: "finanzas:" }).catch(() => {});

  const { data: guardadas } = await admin
    .from("ordenes_neto")
    .select(
      "order_id, fecha, total, pagado, envio_comprador, envio_vendedor, neto, neto_actual, neto_calculado, facturado, comision_mp, envio_mp, isr_mp, iva_mp, retencion_mp, otros_mp, cargos_sin_desglosar, tipo_venta, total_comprador, cargos_fuente, cargos_completos, libera_en, static_tags, detalle_cargos",
    )
    .eq("account_id", cuenta.id)
    .in("order_id", ids);

  return NextResponse.json(
    { pedidas: ids.length, revisadas: r.revisadas, errores: r.errores, ordenes: guardadas ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
