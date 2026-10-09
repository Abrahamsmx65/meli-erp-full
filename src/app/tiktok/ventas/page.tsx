import { after } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { leerVentasTikTok, recalcularVentasTikTok } from "@/lib/servicios/tiktok-ventas";
import { FiltroFechas } from "@/components/filtro-fechas";
import { Ficha } from "@/components/tiles";
import { Cifras, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";
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
  if (!cuenta) return <SinCuenta titulo="Ventas TikTok Shop" />;

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
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Ventas TikTok Shop"
        descripcion="Lo vendido, lo que va a pagar TikTok y la ganancia por modelo."
        frescura={lectura.generadoEn}
        ayuda={
          <>
            <p>
              Cobrado es lo que pagó el cliente. «Me paga TikTok» es lo que TikTok dice que va a pagar por esos pedidos según
              sus propias transacciones (ya sin comisión, afiliados, envío ni retenciones), estén liquidados o no; el ERP no
              lo estima.
            </p>
            <p>
              Un pedido recién creado del que TikTok aún no publica transacciones va en «sin dato» y no entra a la ganancia
              hasta que llega.
            </p>
            <p>
              Ganancia = lo que paga TikTok − costo (Productos y costos) de esos pares; «Por par» es esa ganancia entre los
              pares con dato: lo que queda por cada par vendido después de comisión, afiliados, envío, impuestos retenidos y
              costo. Los cancelados no se enseñan.
            </p>
          </>
        }
      />
      <FiltroFechas base="/tiktok/ventas" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx()} />

      <Cifras columnas={5}>
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
      </Cifras>
      <Cifras columnas={4}>
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
      </Cifras>

      <OrigenVentasTikTok origen={origen} />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Seccion titulo="Ventas por modelo" descripcion="Abre un modelo para ver sus tallas." sinRelleno>
          <div className="tabla-caja">
            <table className="datos">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th className="num">Pares</th>
                  <th className="num">Pedidos</th>
                  <th className="num">Cobrado</th>
                  <th className="num">Me paga TikTok</th>
                  <th className="num">Afiliados</th>
                  <th className="num">Sin dato</th>
                  <th className="num">Costo</th>
                  <th className="num">Ganancia</th>
                  <th className="num">Por par</th>
                </tr>
              </thead>
              <tbody>
                {conCosto.map((m) => (
                  <tr key={m.modelo} className="align-top">
                    <td>
                      <details>
                        <summary className="cursor-pointer font-medium">{m.modelo}</summary>
                        <ul className="mt-1 text-xs texto-2">
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
                    <td className="num cifra">{n(m.unidades)}</td>
                    <td className="num cifra" title={`${m.pedidosLiquidados} liquidados`}>{n(m.pedidos)}</td>
                    <td className="num cifra">{pesos(m.cobrado)}</td>
                    <td className="num cifra font-medium" title={`${pesos(m.aRecibirLiquidado)} liquidado · ${pesos(m.aRecibirPorLiquidar)} por liquidar`}>
                      {m.aRecibir ? pesos(m.aRecibir) : "—"}
                    </td>
                    <td className="num cifra texto-2">{m.afiliado ? pesos(m.afiliado) : "—"}</td>
                    <td
                      className="num cifra"
                      style={{ color: m.pedidosSinDato ? "var(--estado-alerta)" : "var(--ink-2)" }}
                      title={m.pedidosSinDato ? `${m.pedidosSinDato} pedido${m.pedidosSinDato === 1 ? "" : "s"} · ${pesos(m.cobradoSinDato)} cobrados sin dato de TikTok` : undefined}
                    >
                      {m.pedidosSinDato ? `${n(m.pedidosSinDato)} ped.` : "—"}
                    </td>
                    <td className="num cifra texto-2" title={m.costoUnitario != null ? `${pesos(m.costoUnitario)} por par × ${n(m.unidadesConDato)} pares con dato` : "sin costo capturado"}>
                      {m.costo != null && m.unidadesConDato > 0 ? pesos(m.costo) : m.costoUnitario == null ? "sin costo" : "—"}
                    </td>
                    <td className="num cifra font-semibold" style={{ color: m.ganancia == null ? "var(--ink-2)" : m.ganancia < 0 ? "var(--estado-critico)" : "var(--estado-bien)" }}>
                      {m.ganancia != null ? pesos(m.ganancia) : "—"}
                    </td>
                    <td
                      className="num cifra font-semibold"
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
                    <td className="px-4 py-6 text-center text-sm texto-2" colSpan={10}>
                      Sin ventas en el rango.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Seccion>

        <Seccion titulo="Pedidos por estado" descripcion="Los del rango y, de cualquier fecha, los que todavía no salen." sinRelleno>
          <div className="tabla-caja">
            <table className="datos">
              <tbody>
                {porEstado.map(([estado, cuantos]) => (
                    <tr key={estado}>
                      <td>{NOMBRE_ESTADO[estado] ?? estado}</td>
                      <td className="num cifra">{n(cuantos)}</td>
                    </tr>
                  ))}
                {!porEstado.length ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm texto-2">
                      Sin pedidos sincronizados.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Seccion>
      </div>

      <Seccion
        titulo="Solicitudes de muestras"
        descripcion="Pedidos de $0 para creadores: se despachan y descuentan, pero no son venta."
        sinRelleno
      >
        <div className="tabla-caja">
          <table className="datos">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Pedido</th>
                <th>SKU</th>
                <th>Para</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {muestras.map((m) => (
                <tr key={m.orderId}>
                  <td className="whitespace-nowrap">
                    {m.creadoEn ? new Date(m.creadoEn).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }) : ""}
                  </td>
                  <td className="font-medium">{m.orderId}</td>
                  <td>{m.skus.join(", ")}</td>
                  <td className="texto-2">{m.destinatario ?? ""}</td>
                  <td>{NOMBRE_ESTADO[m.estado ?? ""] ?? m.estado}</td>
                </tr>
              ))}
              {!muestras.length ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm texto-2" colSpan={5}>
                    Sin solicitudes de muestra en el rango.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Seccion>
    </Pagina>
  );
}
