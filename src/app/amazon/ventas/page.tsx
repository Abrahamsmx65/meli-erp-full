import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { cargarMonitorAmazon } from "@/lib/servicios/amazon-monitor";
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
        <h1 className="text-lg font-semibold">Amazon no está conectado</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          No hay ninguna cuenta de Amazon asociada a este usuario.
        </p>
      </div>
    );
  }

  const cuentaMeli = await cuentaActiva(supabase);
  const m = await cargarMonitorAmazon(supabase, cuenta.id, cuentaMeli?.id ?? null, rango);
  const etiquetaRango = `${rango.desde} → ${rango.hasta}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Ventas Amazon</h1>
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
        <Ficha
          titulo={m.gananciaReal != null ? "Ganancia real" : "Ganancia estimada"}
          valor={
            m.gananciaReal != null
              ? pesos(m.gananciaReal)
              : m.coberturaCosto > 0
                ? pesos(m.ganancia)
                : "—"
          }
          nota={
            m.gananciaReal != null
              ? `Neto depositado ${pesos(m.netoReal ?? 0)} − costo de ${n(m.unidadesLiquidadas)} pares liquidados (comisiones, envío e impuestos ya descontados)`
              : m.coberturaCosto > 0
                ? `Venta − costo, ANTES de comisiones de Amazon · ${Math.round(m.coberturaCosto * 100)}% con costo`
                : "Captura costos en Productos y costos"
          }
          tono={
            (m.gananciaReal ?? m.ganancia) < 0 && (m.gananciaReal != null || m.coberturaCosto > 0)
              ? "critico"
              : "neutro"
          }
        />
      </div>

      {/* ---- El desglose del dinero real del periodo ---------------------- */}
      {m.netoReal != null ? (
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
              mismos productos que en MELI). "Neto real" es lo que Amazon depositó
              según su reporte de pagos (comisiones, envío e impuestos ya
              descontados) y la ganancia sale de ahí; cuando aún no hay pagos
              liquidados del periodo, la ganancia con ~ es venta − costo.
            </p>
          </header>
          <table className="datos">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Unidades</th>
                <th className="num">Venta</th>
                <th className="num">Neto real</th>
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
                    style={{
                      color:
                        (c.gananciaReal ?? c.ganancia ?? 0) < 0
                          ? "var(--estado-critico)"
                          : "var(--ink-1)",
                    }}
                  >
                    {c.gananciaReal != null
                      ? pesos(c.gananciaReal)
                      : c.ganancia == null
                        ? "—"
                        : `~${pesos(c.ganancia)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por modelo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Todas las tallas y colores de cada modelo, juntos, en el periodo elegido.
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
                      {f.netoReal == null ? "—" : pesos(f.netoReal)}
                    </td>
                    <td
                      className="num cifra"
                      style={{
                        color:
                          (f.gananciaReal ?? f.ganancia ?? 0) < 0
                            ? "var(--estado-critico)"
                            : "var(--ink-1)",
                      }}
                    >
                      {f.gananciaReal != null
                        ? pesos(f.gananciaReal)
                        : f.ganancia == null
                          ? "—"
                          : `~${pesos(f.ganancia)}`}
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
