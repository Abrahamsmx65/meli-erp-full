import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { obtenerMonitorAmazon } from "@/lib/servicios/amazon-monitor";
import { diasDeRango, fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { Ficha } from "@/components/tiles";
import { FiltroFechas } from "@/components/filtro-fechas";

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
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Amazon no está conectado</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          No hay ninguna cuenta de Amazon asociada a este usuario.
        </p>
      </div>
    );
  }

  const cuentaMeli = await cuentaActiva(supabase);
  const m = await obtenerMonitorAmazon(supabase, cuenta.id, cuentaMeli?.id ?? null, rango);
  const etiquetaRango = `${rango.desde} → ${rango.hasta}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Ventas Amazon</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Ventas de {cuenta.nombre ?? "tu cuenta"} en Amazon {cuenta.pais}, sobre el
          periodo elegido y comparadas contra el periodo anterior del mismo largo.
        </p>
      </div>

      <FiltroFechas base="/amazon/ventas" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx(0)} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
            m.economia?.gananciaFinal != null
              ? pesos(m.economia.gananciaFinal)
              : m.gananciaReal != null
                ? pesos(m.gananciaReal)
                : m.coberturaCosto > 0
                  ? pesos(m.ganancia)
                  : "—"
          }
          nota={
            m.economia?.gananciaFinal != null
              ? `Neto Amazon (ventas − tarifas − publicidad) − costo · ${Math.round(m.economia.coberturaCosto * 100)}% con costo`
              : m.gananciaReal != null
                ? `Sin economía por producto en el rango: es lo LIQUIDADO (${pesos(m.netoReal ?? 0)}) − costo de ${n(m.unidadesLiquidadas)} pares`
                : m.coberturaCosto > 0
                  ? `Sin economía ni liquidaciones: venta − costo, ANTES de tarifas de Amazon · ${Math.round(m.coberturaCosto * 100)}% con costo`
                  : "Captura costos en Productos y costos"
          }
          tono={
            (m.economia?.gananciaFinal ?? m.gananciaReal ?? m.ganancia) < 0 &&
            (m.economia?.gananciaFinal != null || m.gananciaReal != null || m.coberturaCosto > 0)
              ? "critico"
              : "neutro"
          }
        />
      </div>

      {/* ---- Economía POR PRODUCTO (SKU Economics vía Data Kiosk) ---------- */}
      {m.economia ? (
        <section className="tarjeta p-4">
          <h2 className="text-sm font-semibold">A dónde se fue el dinero (por producto)</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
            La misma fuente que el "SKU Economics" de Seller Central: ventas, tarifas y
            publicidad por producto y por día
            {m.economia.hasta ? ` · datos hasta ${m.economia.hasta}` : ""}.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
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
              nota="Neto Amazon − costo de producto"
              tono={
                m.economia.gananciaFinal == null
                  ? "neutro"
                  : m.economia.gananciaFinal < 0
                    ? "critico"
                    : "bien"
              }
            />
          </div>
        </section>
      ) : null}

      {/* ---- El desglose del dinero real del periodo ---------------------- */}
      {!m.economia && m.netoReal == null && m.pagosHasta ? (
        <section
          className="tarjeta p-4 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 8%, var(--surface-1))" }}
        >
          <h2 className="text-sm font-semibold">El dinero real de este periodo aún no llega</h2>
          <p className="mt-1" style={{ color: "var(--ink-2)" }}>
            Amazon liquida cada ~2 semanas y sus pagos llegan hasta el{" "}
            <strong className="cifra">{m.pagosHasta}</strong>. El rango que estás viendo es más
            reciente, así que todavía no hay depósitos que desglosar.
          </p>
          <a
            href={`/amazon/ventas?desde=${new Date(Date.parse(m.pagosHasta) - 13 * 86_400_000)
              .toISOString()
              .slice(0, 10)}&hasta=${m.pagosHasta}`}
            className="mt-2 inline-block rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--acento)" }}
          >
            Ver las últimas 2 semanas liquidadas
          </a>
        </section>
      ) : null}

      {!m.economia && m.netoReal != null ? (
        <section className="tarjeta p-4">
          <h2 className="text-sm font-semibold">A dónde se fue el dinero (liquidado en el periodo)</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
            Sale del reporte de pagos de Amazon: es lo que de verdad se depositó, con
            comisiones, envíos e impuestos ya descontados por producto, y los gastos de
            cuenta aparte.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
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
          </div>
        </section>
      ) : null}

      {m.porCategoria.length ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Por categoría</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Las categorías y costos se capturan en Productos y costos (son los
              mismos productos que en MELI). La ganancia es UNA sola cuenta, la del
              corte general: neto del SKU Economics (ventas − tarifas − publicidad,
              por fecha de venta) − costo, sumada modelo por modelo. Las unidades de
              modelos sin costo capturado quedan FUERA y se declaran.
            </p>
          </header>
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
          {m.porCategoria.some((c) => c.unidadesSinGanancia > 0) ? (
            <p className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-2)" }}>
              * En esa categoría hay unidades de modelos sin costo capturado: su venta no entra a la ganancia. Captura el costo en Productos y costos.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por modelo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Todas las tallas y colores de cada modelo, juntos, en el periodo elegido. La
            publicidad viene del reporte de economía por SKU (confiable desde el 9 de
            agosto de 2026; antes está incompleto). Un modelo con publicidad en “—” o $0
            no tiene gasto atribuido a sus SKUs en ese reporte. La ganancia es la misma
            cuenta que arriba (neto económico − costo); con ~ es venta − costo porque a
            ese modelo aún no le llega economía ni liquidación.
          </p>
        </header>
        <div className="max-h-[36rem] overflow-auto">
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
                    <td className="num cifra" style={{ color: "var(--ink-muted)" }}>
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
        </div>
      </section>
    </div>
  );
}
