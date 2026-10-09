import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { GraficaVentasTiempo } from "@/components/ui/grafica-ventas-tiempo";
import { servirVariosCanales } from "@/lib/servicios/ventas-tiempo";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { servirMonitorAmazon } from "@/lib/servicios/amazon-monitor";
import { diasDeRango, fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { Ficha } from "@/components/tiles";
import { FiltroFechas } from "@/components/filtro-fechas";
import { Aviso, Ayuda, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

/**
 * Monitor de ventas de Amazon: el mismo panel que el de Mercado Libre, con
 * su filtro de fechas, por modelo y por categoría. Los envíos a FBA viven
 * en su propia sección.
 */
export default async function VentasAmazon({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  const rango = normalizarRango(sp.desde, sp.hasta);
  const dias = diasDeRango(rango);

  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) return <SinCuenta titulo="Ventas Amazon" servicio="amazon" />;

  const cuentaMeli = await cuentaActiva(supabase);
  // Masticado en `app_cache`: se sirve aunque esté viejo y se refresca por
  // atrás; el latido de Amazon deja listo el rango de 7 días.
  const [servido, tiempo] = await Promise.all([
    servirMonitorAmazon(supabase, cuenta.id, cuentaMeli?.id ?? null, rango),
    servirVariosCanales(clienteAdmin(), [{ canal: "amazon", accountId: cuenta.id }], rango),
  ]);
  const m = servido.datos;
  const etiquetaRango = `${rango.desde} → ${rango.hasta}`;
  const economiaCompleta =
    m.economia?.cobertura.completa === true && m.economia.coberturaCosto >= 0.999;
  const real = m.real && (m.real.ventas.eventos > 0 || m.real.reembolsos.eventos > 0) ? m.real : null;

  return (
    <Pagina>
      <Encabezado
        ceja="Amazon"
        titulo="Ventas Amazon"
        descripcion={`Ventas de ${cuenta.nombre ?? "tu cuenta"} en Amazon ${cuenta.pais} contra el periodo anterior del mismo largo.`}
        frescura={servido.generadoEn}
      />

      <FiltroFechas base="/amazon/ventas" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx(0)} />

      <Cifras columnas={5}>
        <Ficha
          titulo="Hoy"
          valor={n(m.hoy.unidades)}
          nota={`${pesos(m.hoy.importe)} · ${n(m.hoy.ordenes)} órdenes`}
          tono="bien"
        />
        <Ficha titulo="Ayer" valor={n(m.ayer.unidades)} nota={pesos(m.ayer.importe)} />
        <Ficha
          titulo={`Periodo (${dias} días)`}
          valor={n(m.periodo.unidades)}
          nota={`${pesos(m.periodo.importe)} · ${etiquetaRango}`}
        />
        <Ficha
          titulo="Ritmo diario"
          valor={n(m.periodo.unidades / dias)}
          nota="Promedio del periodo"
        />
        {/* UNA sola ganancia, la del corte general: neto del SKU Economics
            (ventas − tarifas − publicidad, por fecha de venta) − costo.
            Sin economía cae a lo liquidado y al final a venta − costo, y la
            nota dice cuál fue: ya no hay «real» y «final» contradiciéndose. */}
        <Ficha
          titulo="Ganancia del periodo"
          valor={
            real?.ganancia != null
              ? pesos(real.ganancia)
              : m.economia?.gananciaFinal != null
              ? pesos(m.economia.gananciaFinal)
              : m.gananciaReal != null
                ? pesos(m.gananciaReal)
                : m.coberturaCosto > 0
                  ? pesos(m.ganancia)
                  : "—"
          }
          nota={
            real?.ganancia != null
              ? `${real.exacto ? "Exacta" : "Parcial"} · Dinero real de Amazon (Finances API) − costo · ${Math.round(real.coberturaCosto * 100)}% con costo`
              : m.economia?.gananciaFinal != null
              ? `${economiaCompleta ? "Exacta" : "Parcial"} · Neto Amazon (ventas − tarifas − publicidad) − costo · ${Math.round(m.economia.coberturaCosto * 100)}% con costo`
              : m.gananciaReal != null
                ? `Sin economía por producto en el rango: es lo LIQUIDADO (${pesos(m.netoReal ?? 0)}) − costo de ${n(m.unidadesLiquidadas)} pares`
                : m.coberturaCosto > 0
                  ? `Sin economía ni liquidaciones: venta − costo, ANTES de tarifas de Amazon · ${Math.round(m.coberturaCosto * 100)}% con costo`
                  : "Captura costos en Productos y costos"
          }
          tono={
            (real?.ganancia ?? m.economia?.gananciaFinal ?? m.gananciaReal ?? m.ganancia) < 0 &&
            (real?.ganancia != null || m.economia?.gananciaFinal != null || m.gananciaReal != null || m.coberturaCosto > 0)
              ? "critico"
              : "neutro"
          }
        />
      </Cifras>

      {!m.economia && m.netoReal == null && m.pagosHasta ? (
        <Aviso tono="alerta" titulo="El dinero real de este periodo aún no llega">
          <p>
            Los pagos de Amazon llegan hasta el <strong className="cifra">{m.pagosHasta}</strong>.
          </p>
          <a
            href={`/amazon/ventas?desde=${new Date(Date.parse(m.pagosHasta) - 13 * 86_400_000)
              .toISOString()
              .slice(0, 10)}&hasta=${m.pagosHasta}`}
            className="boton boton-borde boton-chico mt-2"
          >
            Ver las últimas 2 semanas liquidadas
          </a>
        </Aviso>
      ) : null}

      <Seccion titulo="Venta por día y por hora" descripcion={etiquetaRango}>
        <GraficaVentasTiempo datos={tiempo} desde={rango.desde} hasta={rango.hasta} />
      </Seccion>

      <Pestanas
        pestanas={[
          Boolean(real || m.economia || m.netoReal != null) && {
            id: "dinero",
            titulo: "Dinero",
            contenido: (
              <>
                {/* ---- El dinero REAL: eventos de la Finances API por fecha de asiento ---- */}
                {real ? (
                  <Seccion
                    titulo="A dónde se fue el dinero (real, por fecha de asiento)"
                    descripcion={real.cobertura.hasta ? `Liquidaciones cerradas hasta ${real.cobertura.hasta.slice(0, 10)}.` : undefined}
                  >
                    <div className="flex flex-col gap-3">
                    <Ayuda titulo="¿De dónde sale?">
                      <p>
                        Cada peso sale de un evento de la Finances API de Amazon con su nombre: precio,
                        impuesto, comisión, FBA, IVA retenido, promociones, reembolsos y la factura de
                        publicidad con IVA. Nada se estima.
                      </p>
                    </Ayuda>
                    {real.avisos.length ? (
                      <Aviso tono="alerta">
                        <ul className="flex flex-col gap-1">
                          {real.avisos.map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </Aviso>
                    ) : null}
                    <Cifras columnas={4}>
                      <Ficha titulo="Venta bruta" valor={pesos(real.ventas.bruto)} nota={`${n(real.ventas.unidades)} unidades · ${n(real.ventas.eventos)} envíos`} />
                      <Ficha titulo="Comisión" valor={pesos(real.ventas.comision)} nota="Referral fee" tono={real.ventas.comision < 0 ? "alerta" : "neutro"} />
                      <Ficha titulo="FBA" valor={pesos(real.ventas.fba)} nota="Tarifa de logística" tono={real.ventas.fba < 0 ? "alerta" : "neutro"} />
                      <Ficha titulo="IVA retenido" valor={pesos(real.ventas.retenido)} nota="MarketplaceFacilitator" tono={real.ventas.retenido < 0 ? "alerta" : "neutro"} />
                      <Ficha
                        titulo="Promos y otras"
                        valor={pesos(real.ventas.promociones + real.ventas.otrasTarifas)}
                        nota="Promociones y otras tarifas"
                        tono={real.ventas.promociones + real.ventas.otrasTarifas < 0 ? "alerta" : "neutro"}
                      />
                      <Ficha titulo="Devoluciones" valor={pesos(real.reembolsos.neto)} nota={`${n(real.reembolsos.unidades)} unidades · ${n(real.reembolsos.eventos)} reembolsos`} tono={real.reembolsos.neto < 0 ? "alerta" : "neutro"} />
                      <Ficha
                        titulo="Publicidad"
                        valor={pesos(real.publicidad.monto)}
                        nota={real.publicidad.impuesto ? `Factura real · incluye ${pesos(real.publicidad.impuesto)} de IVA` : "Factura real de Product Ads"}
                        tono={real.publicidad.monto < 0 ? "alerta" : "neutro"}
                      />
                      <Ficha titulo="Neto depositado" valor={pesos(real.netoDepositado)} nota={`Productos ${pesos(real.netoProductos)} · otros ${pesos(real.otrosTotal)}`} />
                    </Cifras>
                    {real.otros.length ? (
                      <p className="texto-2 text-xs">
                        Otros cargos del periodo:{" "}
                        {real.otros.map((o) => `${o.lista.replace(/EventList$/, "")} ${pesos(o.monto)}${o.sinClasificar ? ` (${o.sinClasificar} sin clasificar)` : ""}`).join(" · ")}
                      </p>
                    ) : null}
                    <Cifras columnas={3}>
                      <Ficha titulo="Costo de producto" valor={real.costoProducto > 0 ? pesos(-real.costoProducto) : "—"} nota={`${Math.round(real.coberturaCosto * 100)}% de las unidades con costo capturado`} />
                      <Ficha
                        titulo="Ganancia"
                        valor={real.ganancia != null ? pesos(real.ganancia) : "—"}
                        nota={`${real.exacto ? "Exacta" : "Parcial"} · neto de productos − costo − publicidad − otros cargos`}
                        tono={real.ganancia == null ? "neutro" : real.ganancia < 0 ? "critico" : "bien"}
                      />
                      <Ficha
                        titulo="Liquidaciones"
                        valor={`${n(real.cobertura.cerrados)} cerradas`}
                        nota={`${n(real.cobertura.abiertos)} en curso · ${n(real.cobertura.incompletos)} a medio leer · ${n(real.cobertura.descuadrados)} sin cuadrar`}
                        tono={real.cobertura.descuadrados ? "critico" : real.cobertura.abiertos || real.cobertura.incompletos ? "alerta" : "bien"}
                      />
                    </Cifras>
                    </div>
                  </Seccion>
                ) : null}

                {/* ---- Economía POR PRODUCTO (SKU Economics vía Data Kiosk) ---------- */}
                {m.economia ? (
                  <Seccion
                    titulo="A dónde se fue el dinero (por producto)"
                    descripcion={m.economia.hasta ? `Datos hasta ${m.economia.hasta}.` : undefined}
                  >
                    <div className="flex flex-col gap-3">
                    {!economiaCompleta ? (
                      <Aviso tono="alerta">
                        Datos parciales: {Math.round(m.economia.cobertura.importe * 100)}% del importe,{" "}
                        {Math.round(m.economia.cobertura.unidades * 100)}% de las unidades y{" "}
                        {m.economia.cobertura.diasCubiertos} de {m.economia.cobertura.diasVenta} días con venta.
                      </Aviso>
                    ) : null}
                    <Cifras columnas={6}>
                      <Ficha
                        titulo="Ventas"
                        valor={pesos(m.economia.ventas)}
                        nota={`${n(m.economia.unidades)} unidades netas`}
                      />
                      <Ficha
                        titulo="Tarifas Amazon"
                        valor={pesos(-m.economia.tarifas)}
                        nota="Comisión, FBA y demás tarifas"
                        tono={m.economia.tarifas > 0 ? "alerta" : "neutro"}
                      />
                      <Ficha
                        titulo="Publicidad"
                        valor={pesos(-m.economia.publicidad)}
                        nota="Gasto de anuncios del periodo"
                        tono={m.economia.publicidad > 0 ? "alerta" : "neutro"}
                      />
                      <Ficha
                        titulo="Neto Amazon"
                        valor={pesos(m.economia.neto)}
                        nota="Ventas − tarifas − publicidad"
                      />
                      <Ficha
                        titulo="Costo de producto"
                        valor={m.economia.costoProducto > 0 ? pesos(-m.economia.costoProducto) : "—"}
                        nota={`${Math.round(m.economia.coberturaCosto * 100)}% con costo capturado`}
                      />
                      <Ficha
                        titulo="Ganancia final"
                        valor={m.economia.gananciaFinal != null ? pesos(m.economia.gananciaFinal) : "—"}
                        nota={`${economiaCompleta ? "Exacta" : "Parcial"} · Neto Amazon − costo de producto`}
                        tono={
                          m.economia.gananciaFinal == null
                            ? "neutro"
                            : m.economia.gananciaFinal < 0
                              ? "critico"
                              : "bien"
                        }
                      />
                    </Cifras>
                    </div>
                  </Seccion>
                ) : null}

                {!m.economia && m.netoReal != null ? (
                  <Seccion
                    titulo="A dónde se fue el dinero (liquidado en el periodo)"
                  >
                    <div className="flex flex-col gap-3">
                    <Ayuda titulo="¿De dónde sale?">
                      <p>
                        Sale del reporte de pagos de Amazon: es lo que de verdad se depositó, con
                        comisiones, envíos e impuestos ya descontados por producto, y los gastos de
                        cuenta aparte.
                      </p>
                    </Ayuda>
                    <Cifras columnas={5}>
                      <Ficha
                        titulo="Neto por productos"
                        valor={pesos(m.netoReal)}
                        nota={`${n(m.unidadesLiquidadas)} pares liquidados`}
                      />
                      <Ficha
                        titulo="Costo de producto"
                        valor={m.gananciaReal != null ? pesos(m.gananciaReal - m.netoReal) : "—"}
                        nota="De los pares liquidados, a costo capturado"
                      />
                      <Ficha
                        titulo="Publicidad"
                        valor={m.publicidad != null ? pesos(m.publicidad) : "—"}
                        nota="Cargos de anuncios en el periodo"
                        tono={(m.publicidad ?? 0) < 0 ? "alerta" : "neutro"}
                      />
                      <Ficha
                        titulo="Otros cargos"
                        valor={m.otrosCargos != null ? pesos(m.otrosCargos) : "—"}
                        nota="Almacenaje, suscripción y demás"
                        tono={(m.otrosCargos ?? 0) < 0 ? "alerta" : "neutro"}
                      />
                      <Ficha
                        titulo="Ganancia final"
                        valor={m.gananciaFinal != null ? pesos(m.gananciaFinal) : "—"}
                        nota="Neto − costo − publicidad − otros cargos"
                        tono={
                          m.gananciaFinal == null ? "neutro" : m.gananciaFinal < 0 ? "critico" : "bien"
                        }
                      />
                    </Cifras>
                    </div>
                  </Seccion>
                ) : null}
              </>
            ),
          },
          m.porCategoria.length > 0 && {
            id: "categorias",
            titulo: "Por categoría",
            cuenta: m.porCategoria.length,
            contenido: (
              <Seccion titulo="Por categoría" sinRelleno>
                <Tabla>
                <table className="datos">
                  <thead>
                    <tr>
                      <th>Categoría</th>
                      <th className="num">Unidades</th>
                      <th className="num">Venta</th>
                      <th className="num">Neto liquidado</th>
                      <th className="num">Ganancia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.porCategoria.map((c) => (
                      <tr key={c.categoria}>
                        <td className="font-medium">{c.categoria}</td>
                        <td className="num cifra">{n(c.unidades)}</td>
                        <td className="num cifra">{pesos(c.importe)}</td>
                        <td className="num cifra">
                          {c.netoReal == null ? "—" : pesos(c.netoReal)}
                        </td>
                        <td
                          className="num cifra"
                          title={c.unidadesSinGanancia > 0 ? `${n(c.unidadesSinGanancia)} unidades sin costo capturado quedan fuera de esta ganancia` : undefined}
                          style={{
                            color:
                              (c.gananciaNeta ?? 0) < 0
                                ? "var(--estado-critico)"
                                : "var(--ink-1)",
                          }}
                        >
                          {c.gananciaNeta == null ? "sin costo" : pesos(c.gananciaNeta)}
                          {c.gananciaNeta != null && c.unidadesSinGanancia > 0 ? " *" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </Tabla>
                {m.porCategoria.some((c) => c.unidadesSinGanancia > 0) ? (
                  <p className="texto-2 border-t p-3 text-xs hairline">
                    * En esa categoría hay unidades de modelos sin costo capturado: su venta no entra a la ganancia. Captura el costo en Productos y costos.
                  </p>
                ) : null}
              </Seccion>
            ),
          },
          {
            id: "modelos",
            titulo: "Por modelo",
            cuenta: m.porModelo.length,
            contenido: (
              <Seccion titulo="Por modelo" sinRelleno>
                <Tabla alta>
                  <table className="datos">
                    <thead>
                      <tr>
                        <th>Modelo</th>
                        <th className="num">Hoy</th>
                        <th className="num">Periodo</th>
                        <th className="num">Previo</th>
                        <th className="num">Cambio</th>
                        <th className="num">Importe</th>
                        <th className="num">Publicidad</th>
                        <th className="num" title="Gasto de publicidad entre unidades netas del mismo reporte">
                          Ads/unidad
                        </th>
                        <th className="num" title="Publicidad como % de la venta (ACOS)">ACOS</th>
                        <th className="num">Neto real</th>
                        <th className="num">Ganancia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.porModelo.map((f) => {
                        const delta = f.unidades - f.unidadesPrev;
                        return (
                          <tr key={f.modelo}>
                            <td className="font-medium">{f.modelo}</td>
                            <td className="num cifra">{n(f.unidadesHoy)}</td>
                            <td className="num cifra font-semibold">{n(f.unidades)}</td>
                            <td className="num cifra texto-tenue">
                              {n(f.unidadesPrev)}
                            </td>
                            <td
                              className="num cifra"
                              style={{
                                color:
                                  delta > 0
                                    ? "var(--exito-texto)"
                                    : delta < 0
                                      ? "var(--estado-critico)"
                                      : "var(--ink-muted)",
                              }}
                            >
                              {delta > 0 ? `+${n(delta)}` : n(delta)}
                            </td>
                            <td className="num cifra">{pesos(f.importe)}</td>
                            <td className="num cifra">
                              {f.publicidad == null ? "—" : pesos(f.publicidad)}
                            </td>
                            <td className="num cifra">
                              {f.publicidadPorUnidad == null ? "—" : pesos(f.publicidadPorUnidad)}
                            </td>
                            <td
                              className="num cifra"
                              style={
                                (f.acosPct ?? 0) > 30 ? { color: "var(--estado-critico)" } : undefined
                              }
                            >
                              {f.acosPct == null ? "—" : `${f.acosPct.toFixed(1)}%`}
                            </td>
                            <td className="num cifra">
                              {f.netoReal == null ? "—" : pesos(f.netoReal)}
                            </td>
                            <td
                              className="num cifra"
                              title={
                                f.gananciaFuente === "economia"
                                  ? "Neto del SKU Economics − costo"
                                  : f.gananciaFuente === "liquidado"
                                    ? "Sin economía del modelo: lo liquidado − costo"
                                    : f.gananciaFuente === "estimada"
                                      ? "Sin economía ni liquidación: venta − costo (antes de tarifas)"
                                      : "Sin costo capturado"
                              }
                              style={{
                                color:
                                  (f.gananciaNeta ?? 0) < 0
                                    ? "var(--estado-critico)"
                                    : f.gananciaNeta == null
                                      ? "var(--ink-muted)"
                                      : "var(--ink-1)",
                              }}
                            >
                              {f.gananciaNeta == null
                                ? "sin costo"
                                : `${f.gananciaFuente === "estimada" ? "~" : ""}${pesos(f.gananciaNeta)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Tabla>
              </Seccion>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
