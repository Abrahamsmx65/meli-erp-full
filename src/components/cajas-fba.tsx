import type { CajaPlaneada } from "@/lib/servicios/plan";
import type { PlanFbaCajas } from "@/lib/servicios/fba-plan";
import type { EnvioSeparado } from "@/lib/servicios/envios";
import type { DesgloseOpcionales } from "@/lib/reporte/opcionales";
import { partirPorOpcionales, textoDeMas } from "@/lib/reporte/opcionales";
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
  envios = [],
}: {
  plan: PlanFbaCajas;
  desglose: DesgloseOpcionales;
  dias: number;
  /** cajas del plan partidas por bodega/grupo de envío, como en MELI */
  envios?: EnvioSeparado[];
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
              ? `${n(desglose.paresOpcionales)} pares extra si las subes: rescates y la media caja de la regla de la mitad`
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
          <div className="flex items-center gap-2">
            {plan.cajas.length > 0 ? (
              <a
                href={`/api/amazon/envio-excel?dias=${dias}`}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                style={{ background: "var(--acento)" }}
              >
                Excel de este envío
              </a>
            ) : null}
            <a
              href={`/api/amazon/excel-simple?dias=${dias}`}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
              title="Un renglón por SKU: ventas, stock FBA, en camino y faltante a cubrir"
            >
              Excel simple
            </a>
          </div>
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
                {(envios.length
                  ? envios.flatMap((e) => {
                      // Un envío sale de UNA dirección, igual que en Full — y
                      // dentro de cada uno el bloque OPCIONAL va separado del
                      // envío normal.
                      const { normales, opcionales } = partirPorOpcionales(
                        e.cajas as CajaPlaneada[],
                      );
                      const cajasNorm = normales.reduce((a, c) => a + c.cantidad, 0);
                      const paresNorm = normales.reduce((a, c) => a + c.paresTotales, 0);
                      const cajasOpc = opcionales.reduce((a, c) => a + c.cantidad, 0);
                      const paresOpc = opcionales.reduce((a, c) => a + c.paresTotales, 0);
                      return [
                        { tipo: "grupo" as const, envio: e, cajasNorm, paresNorm },
                        ...normales.map((c) => ({ tipo: "caja" as const, caja: c })),
                        ...(opcionales.length
                          ? [{ tipo: "opcionales" as const, envio: e, cajasOpc, paresOpc }]
                          : []),
                        ...opcionales.map((c) => ({ tipo: "caja" as const, caja: c })),
                      ];
                    })
                  : plan.cajas.map((c) => ({ tipo: "caja" as const, caja: c }))
                ).map((fila, i) => {
                  if (fila.tipo === "grupo") {
                    const e = fila.envio;
                    return (
                      <tr key={`g-${e.grupo}`} style={{ background: "var(--surface-2)" }}>
                        <td colSpan={6} className="font-semibold">
                          Envío {e.nombre}
                          <span className="font-normal text-xs" style={{ color: "var(--ink-2)" }}>
                            {" "}
                            · {e.almacenes.join(" + ")} · {fila.cajasNorm} cajas ·{" "}
                            {n(fila.paresNorm)} pares
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  if (fila.tipo === "opcionales") {
                    return (
                      <tr
                        key={`op-${fila.envio.grupo}`}
                        style={{
                          background:
                            "color-mix(in oklab, var(--estado-alerta) 12%, transparent)",
                        }}
                      >
                        <td colSpan={6} className="text-sm font-semibold">
                          OPCIONALES de {fila.envio.nombre} — {fila.cajasOpc} cajas ·{" "}
                          {n(fila.paresOpc)} pares. Tú decides si van.
                        </td>
                      </tr>
                    );
                  }
                  const c = fila.caja;
                  return <FilaCaja key={`${c.codigo}-${i}`} c={c} desglose={desglose} />;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {plan.sinCajaEnBodega.length > 0 ? (
        <section className="tarjeta overflow-hidden" style={{ borderColor: "var(--estado-alerta)" }}>
          <header className="border-b p-4 hairline">
            <h2 className="font-semibold">
              Faltantes SIN caja en bodega ({plan.sinCajaEnBodega.length} SKUs ·{" "}
              {n(sinCaja)} pares)
            </h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Estos SKUs necesitan pares y NO vienen en ninguna caja disponible: o la
              bodega de verdad no tiene, o algo no está ligando. Si un SKU de esta
              lista SÍ tiene caja física en bodega, es un problema de amarre: avísame
              cuál. (Los faltantes chicos de SKUs que sí van en el plan ya no salen
              aquí — están en su propia tabla abajo.)
            </p>
          </header>
          <div className="max-h-[24rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU (MELI)</th>
                  <th className="num">Pares que faltan</th>
                </tr>
              </thead>
              <tbody>
                {plan.sinCajaEnBodega.map((f) => (
                  <tr key={f.sku}>
                    <td className="font-medium">{f.sku}</td>
                    <td className="num cifra">{n(f.pares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {plan.faltanteConCaja.length > 0 ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="font-semibold">
              Faltantes chicos con caja disponible ({plan.faltanteConCaja.length} SKUs ·{" "}
              {n(plan.faltanteConCaja.reduce((a, f) => a + f.pares, 0))} pares)
            </h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Estos SKUs SÍ tienen caja en bodega y el plan ya manda lo que se
              justifica; el pico que queda no vale otra caja completa y se cubre en el
              siguiente envío. No es un problema de amarre.
            </p>
          </header>
          <div className="max-h-[20rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU (MELI)</th>
                  <th className="num">Van en el plan</th>
                  <th className="num">Pico que queda</th>
                </tr>
              </thead>
              <tbody>
                {plan.faltanteConCaja.map((f) => (
                  <tr key={f.sku}>
                    <td className="font-medium">{f.sku}</td>
                    <td className="num cifra">{n(f.enPlan)}</td>
                    <td className="num cifra">{n(f.pares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {plan.sinAmarre.length > 0 ? (
        <section className="tarjeta overflow-hidden" style={{ borderColor: "var(--estado-alerta)" }}>
          <header className="border-b p-4 hairline">
            <h2 className="font-semibold">
              SKUs de Amazon que NO amarran con MELI ({plan.sinAmarre.length})
            </h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Su venta y su faltante no entran al plan de cajas porque el SKU no se
              encontró en el catálogo de MELI con ninguno de los cuatro amarres.
            </p>
          </header>
          <div className="max-h-[20rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU (Amazon)</th>
                  <th className="num">Ventas del periodo</th>
                  <th className="num">Faltante calculado</th>
                </tr>
              </thead>
              <tbody>
                {plan.sinAmarre.map((s) => (
                  <tr key={s.sku}>
                    <td className="font-medium">{s.sku}</td>
                    <td className="num cifra">{n(s.unidades)}</td>
                    <td className="num cifra">{n(s.faltante)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FilaCaja({ c, desglose }: { c: CajaPlaneada; desglose: DesgloseOpcionales }) {
  const opcionales = Math.min(c.cantidad, c.cantidadOpcional ?? 0);
  const deMas = textoDeMas(desglose.deMasPorCaja.get(c.codigo) ?? []);
  return (
    <tr>
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
}
