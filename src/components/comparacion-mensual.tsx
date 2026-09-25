import { Ficha } from "@/components/tiles";
import type { Comparada, ComparacionMensual } from "@/lib/servicios/consolidado-comparar";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}
function cambioTexto(c: Comparada): string {
  if (c.cambio == null) return c.actual === 0 ? "sin cambio" : "nuevo";
  const flecha = c.cambio > 0.0005 ? "▲" : c.cambio < -0.0005 ? "▼" : "=";
  return `${flecha} ${(Math.abs(c.cambio) * 100).toFixed(1)}%`;
}
function colorCambio(c: Comparada): string {
  if (c.cambio == null || Math.abs(c.cambio) < 0.0005) return "var(--ink-muted)";
  return c.cambio > 0 ? "var(--exito-texto)" : "var(--estado-critico)";
}
function tono(c: Comparada): "bien" | "critico" | "neutro" {
  if (c.cambio == null || Math.abs(c.cambio) < 0.0005) return "neutro";
  return c.cambio > 0 ? "bien" : "critico";
}

function Celda({ c, formato }: { c: Comparada; formato: (x: number) => string }) {
  return (
    <>
      <td className="num cifra">{formato(c.actual)}</td>
      <td className="num cifra" style={{ color: "var(--ink-muted)" }}>{formato(c.anterior)}</td>
      <td className="num cifra font-semibold" style={{ color: colorCambio(c) }}>{cambioTexto(c)}</td>
    </>
  );
}

/**
 * El mes contra el anterior en unidades y ganancia (pedido del dueño,
 * 25-sep-2026). Con el mes en curso, el total se compara contra un mes
 * completo y por eso va también el ritmo por día.
 */
export function ComparacionMensualVista({ comp, nombreActual, nombreAnterior }: { comp: ComparacionMensual; nombreActual: string; nombreAnterior: string }) {
  const total = comp.renglones.find((r) => r.canal === "total")!;
  const columnaAnterior = comp.base === "mismos-dias" ? `${nombreAnterior} 1–${comp.hastaAnterior}` : nombreAnterior;
  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-4 hairline">
        <h2 className="text-base font-semibold">
          Contra {nombreAnterior}
          {comp.base === "mismos-dias" ? ` · del 1 al ${comp.hastaAnterior}` : ""}
        </h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          {comp.base === "mismos-dias"
            ? `${nombreActual} va en curso: se compara contra los mismos días de ${nombreAnterior} (del 1 al ${comp.hastaAnterior}), no contra el mes completo. Hoy va a medias.`
            : comp.enCurso
              ? `${nombreActual} va en curso y los mismos días de ${nombreAnterior} todavía se están calculando por atrás (unos minutos): mientras, la comparación justa es el ritmo por día.`
              : `Mes completo contra mes completo.`}{" "}
          La ganancia por canal es antes de gastos empresariales; la utilidad neta final ya los descuenta.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        {comp.ritmo ? (
          <>
            <Ficha titulo="Unidades por día" valor={n(comp.ritmo.unidades.actual)} nota={`${cambioTexto(comp.ritmo.unidades)} · antes ${n(comp.ritmo.unidades.anterior)} al día`} tono={tono(comp.ritmo.unidades)} />
            <Ficha titulo="Utilidad neta por día" valor={pesos(comp.ritmo.utilidadNeta.actual)} nota={`${cambioTexto(comp.ritmo.utilidadNeta)} · antes ${pesos(comp.ritmo.utilidadNeta.anterior)} al día`} tono={tono(comp.ritmo.utilidadNeta)} />
          </>
        ) : null}
        <Ficha titulo={comp.ritmo ? "Unidades en el mes (hasta hoy)" : "Unidades"} valor={n(total.unidades.actual)} nota={`${cambioTexto(total.unidades)} · ${n(total.unidades.diferencia)} vs ${n(total.unidades.anterior)}`} tono={comp.ritmo ? "neutro" : tono(total.unidades)} />
        <Ficha titulo={comp.ritmo ? "Utilidad neta (hasta hoy)" : "Utilidad neta final"} valor={pesos(comp.utilidadNeta.actual)} nota={`${cambioTexto(comp.utilidadNeta)} · antes ${pesos(comp.utilidadNeta.anterior)}`} tono={comp.ritmo ? "neutro" : tono(comp.utilidadNeta)} />
      </div>
      <div className="overflow-x-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Canal</th>
              <th className="num">Unidades</th>
              <th className="num">{columnaAnterior}</th>
              <th className="num">Cambio</th>
              <th className="num">Ganancia</th>
              <th className="num">{columnaAnterior}</th>
              <th className="num">Cambio</th>
            </tr>
          </thead>
          <tbody>
            {comp.renglones.map((r) => (
              <tr key={r.canal} style={r.canal === "total" ? { background: "var(--surface-2)" } : undefined}>
                <td className={r.canal === "total" ? "font-semibold" : ""}>{r.nombre}</td>
                <Celda c={r.unidades} formato={n} />
                <Celda c={r.utilidad} formato={pesos} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
