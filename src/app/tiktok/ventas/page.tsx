import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { efectoDeEstado } from "@/lib/tiktok/kardex";
import { muestrasEnRango, pedidosDeVenta, resumenPorModelo } from "@/lib/tiktok/ventas";
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
        <h1 className="titulo-seccion">Conecta Mercado Libre primero</h1>
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
    traerTodo<any>(supabase, "tiktok_ordenes", "order_id, estado, fecha_creacion, fecha_actualizacion, total, guia, shipping_type, detalle, es_muestra, neto_recibido", (q) =>
      q.eq("account_id", cuenta.id),
    ),
    traerTodo<any>(supabase, "tiktok_orden_items", "order_id, sku_interno, seller_sku, cantidad, precio, estado", (q) =>
      q.eq("account_id", cuenta.id),
    ),
  ]);

  const unidades = (ventas ?? []).reduce((a, v) => a + (v.unidades ?? 0), 0);
  const importe = (ventas ?? []).reduce((a, v) => a + Number(v.importe ?? 0), 0);

  // Por MODELO (GT134), no por color y talla: es el nivel al que se decide
  // qué comprar y qué empujar. Las muestras van aparte: no son venta.
  const ordenesParaVentas = (ordenes ?? []).map((o) => ({
    orderId: o.order_id as string,
    estado: o.estado as string,
    creadoEn: o.fecha_creacion as string | null,
    actualizadoEn: o.fecha_actualizacion as string | null,
    esMuestra: Boolean(o.es_muestra),
    netoRecibido: o.neto_recibido != null ? Number(o.neto_recibido) : null,
    destinatario: (o.detalle?.destinatario ?? null) as string | null,
  }));
  const renglonesParaVentas = (items ?? []).map((i) => ({
    orderId: i.order_id as string,
    skuInterno: (i.sku_interno ?? null) as string | null,
    cantidad: (i.cantidad ?? 0) as number,
    precio: i.precio != null ? Number(i.precio) : null,
    estado: (i.estado ?? null) as string | null,
  }));
  const modelos = resumenPorModelo(ordenesParaVentas, renglonesParaVentas, rango);
  const recibido = modelos.reduce((a, m) => a + m.recibido, 0);
  const cobradoLiquidado = modelos.reduce((a, m) => a + m.cobradoLiquidado, 0);
  const comision = cobradoLiquidado > 0 ? 1 - recibido / cobradoLiquidado : null;
  // Pedidos del rango que TikTok todavía no liquida (uno con dos modelos cuenta una vez).
  const sinLiquidar = pedidosDeVenta(ordenesParaVentas, rango).filter((o) => o.netoRecibido == null).length;

  const muestras = muestrasEnRango(ordenesParaVentas, rango);
  const skusPorPedido = new Map<string, string[]>();
  for (const i of items ?? []) {
    const lista = skusPorPedido.get(i.order_id) ?? [];
    lista.push(i.sku_interno ?? i.seller_sku ?? "(sin SKU)");
    skusPorPedido.set(i.order_id, lista);
  }
  const paresMuestra = muestras.reduce((a, m) => a + (skusPorPedido.get(m.orderId)?.length ?? 0), 0);

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
      esMuestra: Boolean(o.es_muestra),
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
          <h1 className="titulo-pagina">Ventas TikTok Shop</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            {rango.desde} → {rango.hasta}
          </p>
        </div>
        <FiltroFechas base="/tiktok/ventas" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx()} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Ficha titulo="Pares vendidos" valor={n(unidades)} nota="sin contar muestras" />
        <Ficha titulo="Cobrado" valor={pesos(importe)} nota="precio de venta al cliente" />
        <Ficha
          titulo="Recibido"
          valor={pesos(recibido)}
          nota={
            sinLiquidar
              ? `liquidado por TikTok · ${sinLiquidar} pedido${sinLiquidar === 1 ? "" : "s"} sin liquidar`
              : comision != null
                ? `liquidado por TikTok · ${Math.round(comision * 100)}% de comisión`
                : "TikTok todavía no liquida nada"
          }
          tono={sinLiquidar ? "alerta" : "neutro"}
        />
        <Ficha titulo="Muestras" valor={muestras.length} nota={`${paresMuestra} pares regalados, fuera de ventas`} />
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
          <div className="px-4 pt-4">
            <h2 className="text-sm font-semibold">Ventas por modelo</h2>
            <p className="text-xs" style={{ color: "var(--ink-2)" }}>
              Cobrado es lo que pagó el cliente. Recibido es lo que TikTok ya liquidó, descontando comisiones y envío;
              un pedido se liquida días después de entregarse. Abre un modelo para ver sus tallas.
            </p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                  <th className="px-4 py-2 font-semibold">Modelo</th>
                  <th className="px-4 py-2 text-right font-semibold">Pares</th>
                  <th className="px-4 py-2 text-right font-semibold">Pedidos</th>
                  <th className="px-4 py-2 text-right font-semibold">Cobrado</th>
                  <th className="px-4 py-2 text-right font-semibold">Recibido</th>
                  <th className="px-4 py-2 text-right font-semibold">Sin liquidar</th>
                </tr>
              </thead>
              <tbody>
                {modelos.map((m) => (
                  <tr key={m.modelo} className="hairline align-top">
                    <td className="px-4 py-2">
                      <details>
                        <summary className="cursor-pointer font-medium">{m.modelo}</summary>
                        <ul className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
                          {m.tallas.map((t) => (
                            <li key={t.sku} className="flex justify-between gap-3">
                              <span>{t.sku}</span>
                              <span className="num">
                                {n(t.unidades)} · {pesos(t.cobrado)}
                                {t.recibido ? ` · ${pesos(t.recibido)}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td className="num px-4 py-2 text-right">{n(m.unidades)}</td>
                    <td className="num px-4 py-2 text-right">{n(m.pedidos)}</td>
                    <td className="num px-4 py-2 text-right">{pesos(m.cobrado)}</td>
                    <td className="num px-4 py-2 text-right font-medium">{m.recibido ? pesos(m.recibido) : "—"}</td>
                    <td className="num px-4 py-2 text-right" style={{ color: m.sinLiquidar ? "var(--estado-alerta)" : "var(--ink-2)" }}>
                      {m.sinLiquidar || "—"}
                    </td>
                  </tr>
                ))}
                {!modelos.length ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm" colSpan={6} style={{ color: "var(--ink-2)" }}>
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

      <section className="tarjeta overflow-hidden">
        <div className="px-4 pt-4">
          <h2 className="text-sm font-semibold">Solicitudes de muestras</h2>
          <p className="text-xs" style={{ color: "var(--ink-2)" }}>
            Pedidos de $0 que TikTok crea cuando un creador pide muestra. Se despachan y descuentan del almacén
            como cualquier pedido, pero no cuentan como venta.
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                <th className="px-4 py-2 font-semibold">Fecha</th>
                <th className="px-4 py-2 font-semibold">Pedido</th>
                <th className="px-4 py-2 font-semibold">SKU</th>
                <th className="px-4 py-2 font-semibold">Para</th>
                <th className="px-4 py-2 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {muestras.map((m) => (
                <tr key={m.orderId} className="hairline">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {m.creadoEn ? new Date(m.creadoEn).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }) : ""}
                  </td>
                  <td className="px-4 py-2 font-medium">{m.orderId}</td>
                  <td className="px-4 py-2">{(skusPorPedido.get(m.orderId) ?? []).join(", ")}</td>
                  <td className="px-4 py-2" style={{ color: "var(--ink-2)" }}>{m.destinatario ?? ""}</td>
                  <td className="px-4 py-2">{NOMBRE_ESTADO[m.estado ?? ""] ?? m.estado}</td>
                </tr>
              ))}
              {!muestras.length ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm" colSpan={5} style={{ color: "var(--ink-2)" }}>
                    Sin solicitudes de muestra en el rango.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
