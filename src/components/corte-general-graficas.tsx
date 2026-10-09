/**
 * Gráficas del corte general (pantalla): la cascada de la venta a la
 * utilidad y a dónde se fue cada peso por canal. Barras en HTML, sin
 * librería; los datos los arma `consolidado-informe.ts` (los mismos del PDF).
 */
import type { PasoCascada, RepartoPeso } from "@/lib/servicios/consolidado-informe";

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}

export const DESTINOS = [
  { clave: "plataforma", nombre: "Plataforma", color: "var(--graf-plataforma)" },
  { clave: "costo", nombre: "Producto", color: "var(--graf-producto)" },
  { clave: "publicidad", nombre: "Publicidad", color: "var(--graf-publicidad)" },
  { clave: "gastos", nombre: "Gastos de plataforma", color: "var(--graf-gastos)" },
  { clave: "utilidad", nombre: "Utilidad", color: "var(--graf-utilidad)" },
] as const;

/** De la venta bruta a la utilidad neta: cada resta flota donde quedó la anterior. */
export function CascadaVista({ pasos }: { pasos: PasoCascada[] }) {
  const base = Math.max(...pasos.map((p) => Math.abs(p.monto)), 1);
  let acumulado = 0;
  const filas = pasos.map((paso) => {
    let desde: number;
    let largo = Math.abs(paso.monto);
    if (paso.tipo === "resta") {
      const fin = acumulado + paso.monto;
      desde = Math.min(acumulado, fin);
      acumulado = fin;
    } else {
      acumulado = paso.monto;
      desde = Math.min(0, paso.monto);
      largo = Math.abs(paso.monto);
    }
    const color =
      paso.tipo === "resta"
        ? paso.monto > 0
          ? "var(--estado-bien)"
          : "var(--estado-critico)"
        : paso.tipo === "inicio"
          ? "var(--marca)"
          : paso.tipo === "subtotal"
            ? "var(--acento)"
            : paso.monto < 0
              ? "var(--estado-critico)"
              : "var(--estado-bien)";
    return { paso, izquierda: (Math.max(0, desde) / base) * 100, ancho: Math.max(0.3, (largo / base) * 100), color };
  });
  return (
    <div className="flex flex-col gap-1.5">
      {filas.map(({ paso, izquierda, ancho, color }) => {
        const fuerte = paso.tipo !== "resta";
        return (
          <div key={paso.concepto} className="grid items-center gap-3 text-[13px]" style={{ gridTemplateColumns: "minmax(9rem, 14rem) 1fr 7.5rem" }}>
            <div className="min-w-0">
              <div className={`truncate ${fuerte ? "font-semibold" : ""}`}>{paso.concepto}</div>
              <div className="texto-tenue truncate text-[11px]">{paso.nota}</div>
            </div>
            <div className="relative h-4 rounded" style={{ background: "var(--surface-2)" }}>
              <div className="absolute inset-y-0 rounded" style={{ left: `${izquierda}%`, width: `${ancho}%`, background: color }} />
            </div>
            <div className={`num cifra text-right ${fuerte ? "font-semibold" : ""}`} style={paso.monto < 0 ? { color: "var(--critico-texto)" } : undefined}>
              {pesos(paso.monto)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Por canal, de cada $100 de venta: plataforma, producto, publicidad, gastos y utilidad. */
export function RepartoPesoVista({ filas }: { filas: RepartoPeso[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs texto-2">
        {DESTINOS.map((d) => (
          <span key={d.clave} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
            {d.nombre}
          </span>
        ))}
      </div>
      {filas.map((r) => (
        <div key={r.canal} className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(7rem, 10rem) 1fr" }}>
          <div className="min-w-0">
            <div className={`truncate text-[13px] ${r.canal === "total" ? "font-semibold" : "font-medium"}`}>{r.nombre}</div>
            <div className="texto-tenue text-[11px]">{pesos(r.venta)} de venta</div>
          </div>
          <div>
            <div className="flex h-6 w-full overflow-hidden rounded" role="img" aria-label={`${r.nombre}: ${DESTINOS.map((d) => `${d.nombre} ${Math.round(r[d.clave] * 100)}`).join(", ")} de cada 100 pesos`}>
              {DESTINOS.map((d) => {
                const frac = r[d.clave];
                if (frac <= 0) return null;
                return (
                  <div
                    key={d.clave}
                    className="flex items-center justify-center text-[11px] font-semibold"
                    style={{ width: `${frac * 100}%`, background: d.color, color: d.clave === "plataforma" || d.clave === "publicidad" ? "var(--ink-1)" : "#fff" }}
                    title={`${d.nombre}: $${(frac * 100).toFixed(1)} de cada $100`}
                  >
                    {frac >= 0.05 ? Math.round(frac * 100) : ""}
                  </div>
                );
              })}
            </div>
            {r.utilidad < 0 ? <div className="mt-0.5 text-[11px]" style={{ color: "var(--critico-texto)" }}>Pérdida de ${Math.round(-r.utilidad * 100)} por cada $100</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
