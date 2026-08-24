import type { SugerenciaFba } from "@/lib/servicios/fba";
import { OBJETIVO_DIAS_FBA, URGENTE_DIAS_FBA } from "@/lib/servicios/fba";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Qué mandar a FBA, en cajas completas por modelo + color. El cálculo vive
 * en servicios/fba.ts — es el mismo que usa el Excel, para que la pantalla
 * y el archivo nunca digan cosas distintas.
 */
export function EnviosFba({ sugerencias, dias }: { sugerencias: SugerenciaFba[]; dias: number }) {
  const totalCajas = sugerencias.reduce((a, s) => a + s.cajas, 0);
  const totalPares = sugerencias.reduce((a, s) => a + s.pares, 0);
  const sinCorrida = sugerencias.filter((s) => !s.tieneCorrida).length;
  const urgentes = sugerencias.filter((s) => (s.cobertura ?? 0) < URGENTE_DIAS_FBA).length;
  const visibles = sugerencias.slice(0, 100);

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4 hairline">
        <div>
          <h2 className="text-base font-semibold">Cobertura y faltantes por producto</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            La referencia del cálculo: faltante por talla para cubrir {OBJETIVO_DIAS_FBA}{" "}
            días al ritmo de los últimos {dias === 365 ? 365 : dias} días. Solo calzado;
            lo que ya está en FBA y lo que va en camino cuenta a favor. Las cajas
            reales a mandar son las de arriba.
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
            <strong className="cifra">{n(sugerencias.length)}</strong> productos ·{" "}
            <span className="cifra">{n(totalCajas)}</span> cajas ·{" "}
            <span className="cifra">{n(totalPares)}</span> pares
            {urgentes > 0 ? (
              <>
                {" "}·{" "}
                <span style={{ color: "var(--estado-critico)" }}>
                  {n(urgentes)} con menos de {URGENTE_DIAS_FBA} días de stock
                </span>
              </>
            ) : null}
            {sinCorrida > 0 ? (
              <>
                {" "}·{" "}
                <span style={{ color: "var(--estado-alerta)" }}>
                  {n(sinCorrida)} sin corrida cargada (solo pares)
                </span>
              </>
            ) : null}
          </p>
        </div>

      </header>

      {visibles.length === 0 ? (
        <p className="p-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
          Nada que mandar: todo el calzado que vende tiene cobertura de sobra.
        </p>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Tallas</th>
                <th className="num">Venta diaria</th>
                <th className="num">En FBA</th>
                <th className="num">En camino</th>
                <th className="num">Cobertura</th>
                <th className="num">Cajas</th>
                <th className="num">Pares</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((s) => (
                <tr key={s.producto}>
                  <td>
                    <span className="font-medium">{s.producto}</span>
                    {!s.tieneCorrida ? (
                      <div className="text-[11px]" style={{ color: "var(--estado-alerta)" }}>
                        sin corrida: no sé cuántas cajas son
                      </div>
                    ) : null}
                  </td>
                  <td className="num cifra">{s.tallas}</td>
                  <td className="num cifra">{s.ventaDiaria.toFixed(1)}</td>
                  <td className="num cifra">{n(s.disponible)}</td>
                  <td className="num cifra">{n(s.enTransferencia)}</td>
                  <td
                    className="num cifra"
                    style={{
                      color:
                        s.cobertura !== null && s.cobertura < URGENTE_DIAS_FBA
                          ? "var(--estado-critico)"
                          : "var(--ink-1)",
                    }}
                  >
                    {s.cobertura === null ? "—" : `${Math.round(s.cobertura)} d`}
                  </td>
                  <td className="num cifra font-semibold">
                    {s.tieneCorrida ? n(s.cajas) : "?"}
                  </td>
                  <td className="num cifra">{n(s.pares)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
