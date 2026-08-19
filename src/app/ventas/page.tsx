import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarMonitor, type Movimiento } from "@/lib/servicios/ventas-monitor";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

/**
 * Monitor de ventas de Mercado Libre.
 *
 * "Hoy" se mueve solo: los avisos de MELI actualizan las ventas al momento y
 * la página se refresca cuando hay plan nuevo. La comparación de la semana es
 * a nivel producto (modelo + color), con la razón del movimiento al lado.
 */
export default async function Ventas() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Las ventas salen de tu cuenta de Mercado Libre; primero hay que conectarla en
          Ajustes.
        </p>
      </div>
    );
  }

  const m = await cargarMonitor(supabase, cuenta.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Ventas</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          En vivo: los avisos de Mercado Libre actualizan estos números solos. La
          comparación es esta semana contra la anterior, producto por producto.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha
          titulo="Hoy"
          valor={n(m.hoy.unidades)}
          nota={`${pesos(m.hoy.importe)} · ${n(m.hoy.ordenes)} órdenes`}
          tono="bien"
        />
        <Ficha
          titulo="Ayer"
          valor={n(m.ayer.unidades)}
          nota={pesos(m.ayer.importe)}
        />
        <Ficha
          titulo="Últimos 7 días"
          valor={n(m.semana.unidades)}
          nota={pesos(m.semana.importe)}
        />
        <Ficha
          titulo="Ritmo diario"
          valor={n(m.semana.unidades / 7)}
          nota="Promedio de la semana"
        />
        <Ficha
          titulo="Ganancia 7 días"
          valor={m.coberturaCosto > 0 ? pesos(m.ganancia7) : "—"}
          nota={
            m.coberturaCosto > 0
              ? `Neto de MELI − costo · ${Math.round(m.coberturaCosto * 100)}% de la venta con costo`
              : "Captura costos en Productos y costos"
          }
          tono={m.coberturaCosto > 0 && m.ganancia7 < 0 ? "critico" : "neutro"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Movimientos titulo="Suben esta semana" lista={m.subiendo} positivo />
        <Movimientos titulo="Bajan esta semana" lista={m.bajando} />
      </div>

      {m.porCategoria.length > 1 || m.porCategoria[0]?.categoria !== "Sin categoría" ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Por categoría</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Las categorías se capturan en Productos y costos. Neto = lo que MELI
              deposita (ya sin su comisión); ganancia = neto − costo.
            </p>
          </header>
          <table className="datos">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Unidades 7d</th>
                <th className="num">Venta 7d</th>
                <th className="num">Neto 7d</th>
                <th className="num">Ganancia 7d</th>
              </tr>
            </thead>
            <tbody>
              {m.porCategoria.map((c) => (
                <tr key={c.categoria}>
                  <td className="font-medium">{c.categoria}</td>
                  <td className="num cifra">{n(c.unidades7)}</td>
                  <td className="num cifra">{pesos(c.importe7)}</td>
                  <td className="num cifra">{pesos(c.neto7)}</td>
                  <td
                    className="num cifra"
                    style={{
                      color:
                        c.ganancia7 != null && c.ganancia7 < 0
                          ? "var(--estado-critico)"
                          : "var(--ink-1)",
                    }}
                  >
                    {c.ganancia7 == null ? "—" : pesos(c.ganancia7)}
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
            Todas las tallas y colores de cada modelo, juntos. Esta semana contra la
            anterior.
          </p>
        </header>
        <div className="max-h-[36rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th className="num">Colores</th>
                <th className="num">Hoy</th>
                <th className="num">7 días</th>
                <th className="num">7 previos</th>
                <th className="num">Cambio</th>
                <th className="num">Importe 7d</th>
                <th className="num">Ganancia 7d</th>
              </tr>
            </thead>
            <tbody>
              {m.porModelo.map((f) => {
                const delta = f.unidades7 - f.unidades7Prev;
                return (
                  <tr key={f.modelo}>
                    <td className="font-medium">{f.modelo}</td>
                    <td className="num cifra">{f.colores}</td>
                    <td className="num cifra">{n(f.unidadesHoy)}</td>
                    <td className="num cifra font-semibold">{n(f.unidades7)}</td>
                    <td className="num cifra" style={{ color: "var(--ink-muted)" }}>
                      {n(f.unidades7Prev)}
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
                    <td className="num cifra">{pesos(f.importe7)}</td>
                    <td
                      className="num cifra"
                      style={{
                        color:
                          f.ganancia7 != null && f.ganancia7 < 0
                            ? "var(--estado-critico)"
                            : "var(--ink-1)",
                      }}
                    >
                      {f.ganancia7 == null ? "—" : pesos(f.ganancia7)}
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

function Movimientos({
  titulo,
  lista,
  positivo,
}: {
  titulo: string;
  lista: Movimiento[];
  positivo?: boolean;
}) {
  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-3 hairline">
        <h2 className="text-sm font-semibold">{titulo}</h2>
      </header>
      {lista.length === 0 ? (
        <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
          Sin movimientos grandes esta semana.
        </p>
      ) : (
        <ul>
          {lista.map((mv) => (
            <li
              key={mv.producto}
              className="flex items-start gap-3 border-b px-4 py-2.5 last:border-b-0 hairline"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{mv.producto}</div>
                <div className="text-xs" style={{ color: "var(--ink-2)" }}>
                  {mv.razon}
                </div>
              </div>
              <div className="text-right">
                <div
                  className="cifra text-sm font-semibold"
                  style={{
                    color: positivo ? "var(--exito-texto)" : "var(--estado-critico)",
                  }}
                >
                  {mv.delta > 0 ? `+${n(mv.delta)}` : n(mv.delta)}
                </div>
                <div className="cifra text-xs" style={{ color: "var(--ink-muted)" }}>
                  {n(mv.antes)} → {n(mv.ahora)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
