import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { efectoDeEstado } from "@/lib/tiktok/kardex";
import { muestrasEnRango, pedidosDeVenta, resumenPorModelo } from "@/lib/tiktok/ventas";
import { FiltroFechas } from "@/components/filtro-fechas";
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
    traerTodo<any>(supabase, "tiktok_ordenes", "order_id, estado, fecha_creacion, fecha_actualizacion, total, guia, shipping_type, detalle, es_muestra, neto_recibido, pago_esperado, pago_estado, pago_afiliado", (q) =>
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
    pagoEsperado: o.pago_esperado != null ? Number(o.pago_esperado) : null,
    afiliado: o.pago_afiliado != null ? Number(o.pago_afiliado) : null,
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

  // Costo por MODELO (productos_config, MXN final): ganancia = lo que TikTok
  // va a pagar − costo de los pares con dato. Sin costo capturado no se
  // inventa nada.
  const costosRaw = await traerTodo<any>(supabase, "productos_config", "modelo, costo_mxn", (q) =>
    q.eq("account_id", cuenta.id).not("costo_mxn", "is", null),
  );
  const costoDe = new Map<string, number>();
  for (const c of costosRaw ?? []) {
    const modelo = String(c.modelo ?? "").toUpperCase();
    if (modelo && c.costo_mxn != null && !costoDe.has(modelo)) costoDe.set(modelo, Number(c.costo_mxn));
  }
  // «Cuánto me van a pagar» y «cuánto gano» salen del número de TikTok
  // (sus transacciones por pedido, liquidadas o por liquidar), nunca de una
  // estimación del ERP (decisión del dueño, 25-sep-2026). Lo que TikTok
  // todavía no calcula se declara como «sin dato» y se deja fuera de la
  // ganancia hasta que llegue.
  const conCosto = modelos.map((m) => {
    const costoUnitario = costoDe.get(m.modelo) ?? null;
    const costo = costoUnitario != null ? costoUnitario * m.unidadesConDato : null;
    const ganancia = costo != null && m.unidadesConDato > 0 ? m.aRecibir - costo : null;
    return { ...m, costoUnitario, costo, ganancia };
  });
  const gananciaTotal = conCosto.reduce((a, m) => a + (m.ganancia ?? 0), 0);
  const hayGanancia = conCosto.some((m) => m.ganancia != null);
  const sinCosto = conCosto.filter((m) => m.costoUnitario == null).length;
  const aRecibir = modelos.reduce((a, m) => a + m.aRecibir, 0);
  const aRecibirLiquidado = modelos.reduce((a, m) => a + m.aRecibirLiquidado, 0);
  const aRecibirPorLiquidar = modelos.reduce((a, m) => a + m.aRecibirPorLiquidar, 0);
  const afiliados = modelos.reduce((a, m) => a + m.afiliado, 0);
  const cobradoConDato = modelos.reduce((a, m) => a + (m.cobrado - m.cobradoSinDato), 0);
  const cobradoSinDato = modelos.reduce((a, m) => a + m.cobradoSinDato, 0);
  const costoTotal = conCosto.reduce((a, m) => a + (m.costo ?? 0), 0);
  const comision = cobradoConDato > 0 ? 1 - aRecibir / cobradoConDato : null;
  // Pedidos EN PIE del rango: pagados, no cancelados, no muestra.
  const enPie = pedidosDeVenta(ordenesParaVentas, rango);
  const pedidosEnPie = enPie.length;
  const pedidosLiquidados = enPie.filter((o) => o.netoRecibido != null).length;
  const pedidosSinDato = enPie.filter((o) => o.netoRecibido == null && o.pagoEsperado == null).length;
  const pedidosPorLiquidar = pedidosEnPie - pedidosLiquidados - pedidosSinDato;

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
  // Lo cancelado no se enseña (decisión del dueño, 25-sep-2026: «lo
  // cancelado ni me lo enseñes porque hay mucho ahí»).
  const porEstado = new Map<string, number>();
  for (const o of ordenes ?? []) {
    if (String(o.estado ?? "").toUpperCase().startsWith("CANCEL")) continue;
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <Ficha titulo="Pares vendidos" valor={n(unidades)} nota={`${n(pedidosEnPie)} pedidos en pie · sin muestras ni cancelados`} />
        <Ficha titulo="Cobrado" valor={pesos(importe)} nota="precio de venta al cliente" />
        <Ficha
          titulo="Me va a pagar TikTok"
          valor={pesos(aRecibir)}
          nota={
            aRecibir > 0
              ? `${pesos(aRecibirLiquidado)} ya liquidado · ${pesos(aRecibirPorLiquidar)} por liquidar${comision != null ? ` · ${Math.round(comision * 100)}% se queda TikTok` : ""}`
              : "TikTok todavía no publica las transacciones de estos pedidos"
          }
        />
        <Ficha
          titulo="Sin dato de TikTok"
          valor={n(pedidosSinDato)}
          nota={pedidosSinDato ? `pedidos · ${pesos(cobradoSinDato)} cobrados; TikTok aún no calcula su pago (recién creados)` : "TikTok ya calculó el pago de todos"}
          tono={pedidosSinDato ? "alerta" : "bien"}
        />
        <Ficha titulo="Afiliados" valor={pesos(afiliados)} nota="comisión a creadores, ya descontada en lo que paga TikTok" />
        <Ficha
          titulo="Costo"
          valor={hayGanancia ? pesos(costoTotal) : "—"}
          nota={hayGanancia ? `de los pares con dato${sinCosto ? ` · ${sinCosto} modelos sin costo` : ""}` : "captura costos en Productos y costos"}
        />
        <Ficha
          titulo="Ganancia"
          valor={hayGanancia ? pesos(gananciaTotal) : "—"}
          nota={hayGanancia ? "lo que paga TikTok − costo de esos pares" : "se calcula con costo capturado"}
          tono={hayGanancia && gananciaTotal < 0 ? "critico" : "neutro"}
        />
        <Ficha
          titulo="Pedidos por enviar"
          valor={idsPorEnviar.size}
          nota={`pagados, sin despachar · ${n(paresPorEnviar)} pares apartados`}
          tono={idsPorEnviar.size ? "alerta" : "bien"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="tarjeta overflow-hidden">
          <div className="px-4 pt-4">
            <h2 className="text-sm font-semibold">Ventas por modelo</h2>
            <p className="text-xs" style={{ color: "var(--ink-2)" }}>
              Cobrado es lo que pagó el cliente. «Me paga TikTok» es lo que TikTok dice que va a pagar por esos
              pedidos según sus propias transacciones (ya sin comisión, afiliados, envío ni retenciones), estén
              liquidados o no; el ERP no lo estima. Un pedido recién creado del que TikTok aún no publica
              transacciones va en «sin dato» y no entra a la ganancia hasta que llega. Ganancia = lo que paga
              TikTok − costo (Productos y costos) de esos pares. Los cancelados no se enseñan. Abre un modelo
              para ver sus tallas.
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
                  <th className="px-4 py-2 text-right font-semibold">Me paga TikTok</th>
                  <th className="px-4 py-2 text-right font-semibold">Afiliados</th>
                  <th className="px-4 py-2 text-right font-semibold">Sin dato</th>
                  <th className="px-4 py-2 text-right font-semibold">Costo</th>
                  <th className="px-4 py-2 text-right font-semibold">Ganancia</th>
                </tr>
              </thead>
              <tbody>
                {conCosto.map((m) => (
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
                                {t.aRecibir ? ` · paga ${pesos(t.aRecibir)}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td className="num px-4 py-2 text-right">{n(m.unidades)}</td>
                    <td className="num px-4 py-2 text-right" title={`${m.pedidosLiquidados} liquidados`}>{n(m.pedidos)}</td>
                    <td className="num px-4 py-2 text-right">{pesos(m.cobrado)}</td>
                    <td className="num px-4 py-2 text-right font-medium" title={`${pesos(m.aRecibirLiquidado)} liquidado · ${pesos(m.aRecibirPorLiquidar)} por liquidar`}>
                      {m.aRecibir ? pesos(m.aRecibir) : "—"}
                    </td>
                    <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>{m.afiliado ? pesos(m.afiliado) : "—"}</td>
                    <td
                      className="num px-4 py-2 text-right"
                      style={{ color: m.pedidosSinDato ? "var(--estado-alerta)" : "var(--ink-2)" }}
                      title={m.pedidosSinDato ? `${m.pedidosSinDato} pedido${m.pedidosSinDato === 1 ? "" : "s"} · ${pesos(m.cobradoSinDato)} cobrados sin dato de TikTok` : undefined}
                    >
                      {m.pedidosSinDato ? `${n(m.pedidosSinDato)} ped.` : "—"}
                    </td>
                    <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }} title={m.costoUnitario != null ? `${pesos(m.costoUnitario)} por par × ${n(m.unidadesConDato)} pares con dato` : "sin costo capturado"}>
                      {m.costo != null && m.unidadesConDato > 0 ? pesos(m.costo) : m.costoUnitario == null ? "sin costo" : "—"}
                    </td>
                    <td className="num px-4 py-2 text-right font-semibold" style={{ color: m.ganancia == null ? "var(--ink-2)" : m.ganancia < 0 ? "var(--estado-critico)" : "var(--estado-bien)" }}>
                      {m.ganancia != null ? pesos(m.ganancia) : "—"}
                    </td>
                  </tr>
                ))}
                {!modelos.length ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm" colSpan={9} style={{ color: "var(--ink-2)" }}>
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
