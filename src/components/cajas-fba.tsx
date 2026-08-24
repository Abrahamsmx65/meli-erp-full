import type { CajaPlaneada } from "@/lib/servicios/plan";
import type { PlanFbaCajas } from "@/lib/servicios/fba-plan";
import type { DesgloseOpcionales } from "@/lib/reporte/opcionales";
import { textoDeMas } from "@/lib/reporte/opcionales";
import { Ficha } from "@/components/tiles";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Las CAJAS REALES de bodega que el motor eligió para FBA — el mismo
 * optimizador, el mismo rescate de tallas y las mismas opcionales que el
 * plan de envíos a Full. Lo opcional va marcado en rojo con su sobrante.
 */
export function CajasFba({
  plan,
  desglose,
  dias,
}: {
  plan: PlanFbaCajas;
  desglose: DesgloseOpcionales;
  dias: number;
}) {
  const sinCaja = plan.sinCajaEnBodega.reduce((a, f) => a + f.pares, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha
          titulo="Cajas a mandar"
          valor={desglose.cajasObligatorias}
          nota={`${n(desglose.paresObligatorios)} pares`}
        />
        <Ficha
          titulo="Cajas opcionales"
          valor={desglose.cajasOpcionales}
          nota={
            desglose.cajasOpcionales > 0
              ? `${n(desglose.paresOpcionales)} pares extra si las subes todas`
              : "El plan no necesitó rescates"
          }
          tono={desglose.cajasOpcionales > 0 ? "alerta" : "neutro"}
        />
        <Ficha
          titulo="Pares sugeridos"
          valor={n(plan.paresSugeridos)}
          nota={`Faltante de ${n(plan.skusConFaltante)} SKUs para 30 días`}
        />
        <Ficha
          titulo="Sin caja en bodega"
          valor={n(sinCaja)}
          nota="Pares que faltan y ninguna caja disponible trae"
          tono={sinCaja > 0 ? "alerta" : "bien"}
        />
      </div>

      {desglose.totalDeMas > 0 ? (
        <p className="tarjeta p-3 text-sm" style={{ color: "var(--ink-2)" }}>
          Al cerrar cajas completas van{" "}
          <strong className="cifra">{n(desglose.totalDeMas)}</strong> pares por encima de
          lo sugerido — <span className="cifra">{n(desglose.deMasEnOpcionales)}</span> de
          esos en las opcionales. Por talla:{" "}
          <span className="cifra">{textoDeMas(desglose.deMasPorTalla)}</span>
        </p>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4 hairline">
          <div>
            <h2 className="font-semibold">Cajas de bodega para FBA</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              El mismo motor que los envíos a Full, sobre las mismas cajas físicas: lo
              que registres en un envío se aparta y desaparece para los dos canales.
            </p>
          </div>
          {plan.cajas.length > 0 ? (
            <a
              href={`/api/amazon/envio-excel?dias=${dias}`}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
              style={{ background: "var(--acento)" }}
            >
              Excel de este envío
            </a>
          ) : null}
        </header>

        {plan.cajas.length === 0 ? (
          <p className="p-6 text-sm" style={{ color: "var(--ink-2)" }}>
            {plan.paresSugeridos === 0
              ? "Nada que mandar: el calzado que vende tiene cobertura suficiente en FBA."
              : "Hay faltantes, pero ninguna caja disponible en bodega los trae."}
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Caja</th>
                  <th>Almacén</th>
                  <th>Tipo</th>
                  <th className="num">Mandar</th>
                  <th className="num">Pares</th>
                  <th>Contenido por talla</th>
                </tr>
              </thead>
              <tbody>
                {plan.cajas.map((c: CajaPlaneada) => {
                  const opcionales = Math.min(c.cantidad, c.cantidadOpcional ?? 0);
                  const deMas = textoDeMas(desglose.deMasPorCaja.get(c.codigo) ?? []);
                  return (
                    <tr key={c.codigo}>
                      <td>
                        <div
                          className="font-medium"
                          style={opcionales > 0 ? { color: "var(--estado-critico)" } : undefined}
                        >
                          {c.skuCaja}
                        </div>
                        <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          {c.modelo} · {c.color}
                        </div>
                        {opcionales > 0 ? (
                          <div className="text-[11px]" style={{ color: "var(--estado-critico)" }}>
                            {opcionales === c.cantidad
                              ? "OPCIONAL"
                              : `${opcionales} de ${c.cantidad} opcionales`}
                            {deMas ? ` · sobra ${deMas}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="text-sm">{c.almacen}</td>
                      <td className="text-sm">{c.esCorrida ? "Corrida" : `Talla ${c.talla}`}</td>
                      <td
                        className="num cifra font-semibold"
                        style={opcionales > 0 ? { color: "var(--estado-critico)" } : undefined}
                      >
                        {c.cantidad}
                        <span className="text-xs font-normal" style={{ color: "var(--ink-muted)" }}>
                          {" "}
                          / {c.cajasDisponibles}
                        </span>
                      </td>
                      <td className="num cifra">{n(c.paresTotales)}</td>
                      <td className="text-xs" style={{ color: "var(--ink-2)" }}>
                        {c.aporta.map((a) => `${a.talla}:${a.paresTotales}`).join("  ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {plan.sinAmarre.length > 0 ? (
        <section
          className="tarjeta p-4 text-sm"
          style={{ borderColor: "var(--estado-alerta)" }}
        >
          <strong>{plan.sinAmarre.length} SKUs de Amazon no amarran con el catálogo de MELI</strong>{" "}
          <span style={{ color: "var(--ink-2)" }}>
            — su faltante no entra al plan de cajas. Los primeros:{" "}
            {plan.sinAmarre
              .slice(0, 8)
              .map((s) => s.sku)
              .join(", ")}
            {plan.sinAmarre.length > 8 ? "…" : ""}
          </span>
        </section>
      ) : null}
    </div>
  );
}
