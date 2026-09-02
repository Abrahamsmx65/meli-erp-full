import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { efectoDeEstado } from "@/lib/tiktok/kardex";
import { FiltroFechas } from "@/components/filtro-fechas";
import { PedidosTikTok, type PedidoPorEnviar } from "@/components/tiktok-pedidos";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

const NOMBRE_ESTADO: Record<string, string> = {
  UNPAID: "Sin pagar",
  ON_HOLD: "Retenido",
  AWAITING_SHIPMENT: "Por enviar",
  PARTIALLY_SHIPPING: "Enviado a medias",
  AWAITING_COLLECTION: "Esperando al repartidor",
  IN_TRANSIT: "En camino",
  DELIVERED: "Entregado",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
};

/**
 * Ventas y pedidos de TikTok Shop.
 *
 * Lo primero que se ve no son las cifras sino LO QUE HAY QUE ENVIAR: en un
 * canal de envío propio, un pedido pagado sin despachar es trabajo pendiente,
 * y además tiene apartado un par que nadie más puede comprar.
 */
export default async function VentasTikTok({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  const rango = normalizarRango(sp.desde, sp.hasta);

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta Mercado Libre primero</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          TikTok Shop cuelga de la misma cuenta del ERP.
        </p>
      </div>
    );
  }

  const [ventas, ordenes, items] = await Promise.all([
    traerTodo<any>(supabase, "tiktok_ventas_diarias", "sku, fecha, unidades, ordenes, importe", (q) =>
      q.eq("account_id", cuenta.id).gte("fecha", rango.desde).lte("fecha", rango.hasta),
    ),
    traerTodo<any>(supabase, "tiktok_ordenes", "order_id, estado, fecha_creacion, total, guia, shipping_type, detalle", (q) =>
      q.eq("account_id", cuenta.id),
    ),
    traerTodo<any>(supabase, "tiktok_orden_items", "order_id, sku_interno, seller_sku, cantidad, estado", (q) =>
      q.eq("account_id", cuenta.id),
    ),
  ]);

  const unidades = (ventas ?? []).reduce((a, v) => a + (v.unidades ?? 0), 0);
  const importe = (ventas ?? []).reduce((a, v) => a + Number(v.importe ?? 0), 0);

  // Por modelo+color: la talla se vende sola, pero el producto es el que se
  // decide comprar o dejar de comprar.
  const porProducto = new Map<string, { unidades: number; importe: number }>();
  for (const v of ventas ?? []) {
    const producto = String(v.sku).split("-").slice(0, 2).join("-");
    const acc = porProducto.get(producto) ?? { unidades: 0, importe: 0 };
    acc.unidades += v.unidades ?? 0;
    acc.importe += Number(v.importe ?? 0);
    porProducto.set(producto, acc);
  }
  const productos = [...porProducto].sort((a, b) => b[1].unidades - a[1].unidades).slice(0, 30);

  // Lo que falta despachar, que es la lista de trabajo del día.
  const porEnviar = (items ?? []).filter((i) => efectoDeEstado(i.estado) === "apartado");
  const paresPorEnviar = porEnviar.reduce((a, i) => a + (i.cantidad ?? 0), 0);
  const idsPorEnviar = new Set(porEnviar.map((i) => i.order_id));

  // Pedido por pedido, para empacar y confirmar desde aquí.
  const itemsPorPedido = new Map<string, Map<string, number>>();
  for (const i of porEnviar) {
    const sku = i.sku_interno ?? i.seller_sku ?? "(sin SKU)";
    const m = itemsPorPedido.get(i.order_id) ?? new Map<string, number>();
    m.set(sku, (m.get(sku) ?? 0) + (i.cantidad ?? 0));
    itemsPorPedido.set(i.order_id, m);
  }
  const pedidosPorEnviar: PedidoPorEnviar[] = (ordenes ?? [])
    .filter((o) => itemsPorPedido.has(o.order_id))
    .map((o) => ({
      orderId: o.order_id,
      estado: o.estado,
      creadoEn: o.fecha_creacion ?? null,
      destinatario: o.detalle?.destinatario ?? null,
      shippingType: o.shipping_type ?? null,
      renglones: [...(itemsPorPedido.get(o.order_id) ?? new Map())].map(([sku, pares]) => ({ sku, pares })),
    }))
    .sort((a, b) => (a.creadoEn ?? "").localeCompare(b.creadoEn ?? ""));

  const porEstado = new Map<string, number>();
  for (const o of ordenes ?? []) {
    porEstado.set(o.estado, (porEstado.get(o.estado) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Ventas TikTok Shop</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            {rango.desde} → {rango.hasta}
          </p>
        </div>
        <FiltroFechas base="/tiktok/ventas" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx()} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Ficha titulo="Pares vendidos" valor={n(unidades)} nota="en el rango" />
        <Ficha titulo="Importe" valor={pesos(importe)} nota="precio de venta" />
        <Ficha
          titulo="Pedidos por enviar"
          valor={idsPorEnviar.size}
          nota="pagados, sin despachar"
          tono={idsPorEnviar.size ? "alerta" : "bien"}
        />
        <Ficha titulo="Pares apartados" valor={n(paresPorEnviar)} nota="ya tienen dueño" />
      </div>

      <PedidosTikTok pedidos={pedidosPorEnviar} />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="tarjeta overflow-hidden">
          <h2 className="px-4 pt-4 text-sm font-semibold">Lo más vendido</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                  <th className="px-4 py-2 font-semibold">Producto</th>
                  <th className="px-4 py-2 text-right font-semibold">Pares</th>
                  <th className="px-4 py-2 text-right font-semibold">Importe</th>
                </tr>
              </thead>
              <tbody>
                {productos.map(([producto, d]) => (
                  <tr key={producto} className="hairline">
                    <td className="px-4 py-2 font-medium">{producto}</td>
                    <td className="num px-4 py-2 text-right">{n(d.unidades)}</td>
                    <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>
                      {pesos(d.importe)}
                    </td>
                  </tr>
                ))}
                {!productos.length ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm" colSpan={3} style={{ color: "var(--ink-2)" }}>
                      Sin ventas en el rango.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tarjeta overflow-hidden">
          <h2 className="px-4 pt-4 text-sm font-semibold">Pedidos por estado</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {[...porEstado]
                  .sort((a, b) => b[1] - a[1])
                  .map(([estado, cuantos]) => (
                    <tr key={estado} className="hairline">
                      <td className="px-4 py-2">{NOMBRE_ESTADO[estado] ?? estado}</td>
                      <td className="num px-4 py-2 text-right">{n(cuantos)}</td>
                    </tr>
                  ))}
                {!porEstado.size ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
                      Sin pedidos sincronizados.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
