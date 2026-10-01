import { after } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { leerVentasTikTok, recalcularVentasTikTok } from "@/lib/servicios/tiktok-ventas";
import { FiltroFechas } from "@/components/filtro-fechas";
import { Ficha } from "@/components/tiles";
import { Frescura } from "@/components/yapanizcel/comunes";
import { OrigenVentasTikTok } from "@/components/origen-ventas-tiktok";

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
 *
 * Todo sale MASTICADO de `app_cache` (`servicios/tiktok-ventas.ts`): la
 * pantalla lee un renglón y, si está viejo, pide el recálculo por atrás.
 * Como MELI y Amazon (dueño, 1-oct-2026): «que la info se vaya guardando,
 * no que cada vez jale todo».
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

  const admin = clienteAdmin();
  const lectura = await leerVentasTikTok(admin, cuenta.id, rango);
  if (lectura.refrescar) {
    after(async () => {
      await recalcularVentasTikTok(admin, cuenta.id, rango).catch(() => undefined);
    });
  }
  const d = lectura.datos;
  const t = d.totales;
  const { unidades, importe, modelos, muestras, porEnviar, porEstado, origen } = d;
  const conCosto = modelos;
  const {
    gananciaTotal, hayGanancia, sinCosto, aRecibir, aRecibirLiquidado, aRecibirPorLiquidar, afiliados, cobradoSinDato, costoTotal, comision,
    paresConGanancia, gananciaPorParTotal, pedidosEnPie, pedidosSinDato,
  } = t;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="titulo-pagina">Ventas TikTok Shop</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            {rango.desde} → {rango.hasta}
          </p>
          <Frescura generadoEn={lectura.generadoEn} />
        </div>
        <FiltroFechas base="/tiktok/ventas" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx()} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-9">
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
          titulo="Ganancia por par"
          valor={gananciaPorParTotal != null ? pesos(gananciaPorParTotal) : "—"}
          nota={gananciaPorParTotal != null ? `sobre ${n(paresConGanancia)} pares con dato y costo` : "se calcula con costo capturado"}
          tono={gananciaPorParTotal != null && gananciaPorParTotal < 0 ? "critico" : "neutro"}
        />
        <Ficha
          titulo="Pedidos por enviar"
          valor={porEnviar.pedidos}
          nota={`pagados, sin despachar · ${n(porEnviar.pares)} pares apartados`}
          tono={porEnviar.pedidos ? "alerta" : "bien"}
        />
      </div>

      <OrigenVentasTikTok origen={origen} />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="tarjeta overflow-hidden">
          <div className="px-4 pt-4">
            <h2 className="text-sm font-semibold">Ventas por modelo</h2>
            <p className="text-xs" style={{ color: "var(--ink-2)" }}>
              Cobrado es lo que pagó el cliente. «Me paga TikTok» es lo que TikTok dice que va a pagar por esos
              pedidos según sus propias transacciones (ya sin comisión, afiliados, envío ni retenciones), estén
              liquidados o no; el ERP no lo estima. Un pedido recién creado del que TikTok aún no publica
              transacciones va en «sin dato» y no entra a la ganancia hasta que llega. Ganancia = lo que paga
              TikTok − costo (Productos y costos) de esos pares; «Por par» es esa ganancia entre los pares con dato: lo que
              queda por cada par vendido después de comisión, afiliados, envío, impuestos retenidos y costo. Los cancelados no se enseñan. Abre un modelo
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
                  <th className="px-4 py-2 text-right font-semibold">Por par</th>
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
                    <td
                      className="num px-4 py-2 text-right font-semibold"
                      style={{ color: m.gananciaPorPar == null ? "var(--ink-2)" : m.gananciaPorPar < 0 ? "var(--estado-critico)" : "var(--estado-bien)" }}
                      title={
                        m.pagaPorPar != null
                          ? `TikTok paga ${pesos(m.pagaPorPar)} por par${m.costoUnitario != null ? ` − costo ${pesos(m.costoUnitario)} = ${pesos(m.gananciaPorPar ?? 0)}` : " (sin costo capturado)"} · ${n(m.unidadesConDato)} pares con dato`
                          : "sin dato de TikTok"
                      }
                    >
                      {m.gananciaPorPar != null ? pesos(m.gananciaPorPar) : m.pagaPorPar != null && m.costoUnitario == null ? "sin costo" : "—"}
                    </td>
                  </tr>
                ))}
                {!modelos.length ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm" colSpan={10} style={{ color: "var(--ink-2)" }}>
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
          <p className="px-4 pt-1 text-xs" style={{ color: "var(--ink-2)" }}>
            Los del rango y, de cualquier fecha, los que todavía no salen.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {porEstado.map(([estado, cuantos]) => (
                    <tr key={estado} className="hairline">
                      <td className="px-4 py-2">{NOMBRE_ESTADO[estado] ?? estado}</td>
                      <td className="num px-4 py-2 text-right">{n(cuantos)}</td>
                    </tr>
                  ))}
                {!porEstado.length ? (
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
                  <td className="px-4 py-2">{m.skus.join(", ")}</td>
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
