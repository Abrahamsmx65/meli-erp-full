import type { FinanzasPeriodo } from "@/lib/servicios/finanzas/tipos";

/** Centavos → "$1,234". Es lo único que este componente "calcula". */
function pesosDeCentavos(c: number): string {
  const signo = c < 0 ? "−" : "";
  return `${signo}$${Math.round(Math.abs(c) / 100).toLocaleString("es-MX")}`;
}

function porcentaje(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * La cascada del dinero, de la venta bruta al neto, renglón por renglón,
 * con lo que Mercado Pago dice de cada cargo. Solo presenta: los números
 * llegan del motor de finanzas ya masticados.
 */
export function CascadaDinero({ finanzas }: { finanzas: FinanzasPeriodo }) {
  const { cascada, cobertura, reventa, totales } = finanzas;
  const sinLeer = cobertura.ordenes - cobertura.conCargos;
  const parteSinIdentificar = totales.bruto > 0 ? totales.sinIdentificar / totales.bruto : 0;

  return (
    <div>
      <table className="datos">
        <tbody>
          {cascada.map((p) => (
            <tr
              key={p.clave}
              style={p.esResultado ? { background: "var(--surface-2)" } : undefined}
            >
              <td className={p.esResultado ? "font-semibold" : "font-medium"}>{p.titulo}</td>
              <td className="text-xs" style={{ color: "var(--ink-2)", whiteSpace: "normal" }}>
                {p.nota}
              </td>
              <td
                className={`num cifra ${p.esResultado ? "font-semibold" : ""}`}
                style={{
                  color:
                    p.clave === "sinIdentificar" && p.monto !== 0
                      ? "var(--estado-alerta)"
                      : p.esResultado
                        ? "var(--ink-1)"
                        : "var(--ink-2)",
                }}
              >
                {pesosDeCentavos(p.monto)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Qué tan completo está el dato. Se declara SIEMPRE. */}
      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t p-3 text-xs hairline" style={{ color: "var(--ink-muted)" }}>
        <span>
          Órdenes del periodo: <strong className="cifra">{cobertura.ordenes.toLocaleString("es-MX")}</strong>
        </span>
        <span>
          Con el pago leído y desglosado:{" "}
          <strong className="cifra">{porcentaje(cobertura.parteCargos)}</strong>
          {sinLeer > 0 ? ` (faltan ${sinLeer.toLocaleString("es-MX")})` : ""}
        </span>
        {cobertura.conCargos > 0 && cobertura.conPagoReal < cobertura.conCargos ? (
          <span style={{ color: "var(--estado-alerta)" }}>
            Con el pago real de Mercado Pago (retenciones y envío exactos):{" "}
            <strong className="cifra">{cobertura.conPagoReal.toLocaleString("es-MX")}</strong> de{" "}
            {cobertura.conCargos.toLocaleString("es-MX")}; el resto se recarga en segundo plano
          </span>
        ) : null}
        {cobertura.completas < cobertura.conCargos ? (
          <span>
            Comisión aún incompleta (órdenes recientes que se releen):{" "}
            <strong className="cifra">{(cobertura.conCargos - cobertura.completas).toLocaleString("es-MX")}</strong>
          </span>
        ) : null}
        {reventa.ordenes > 0 ? (
          <span>
            En reventa (MELI compra y revende):{" "}
            <strong className="cifra">{reventa.ordenes.toLocaleString("es-MX")}</strong> órdenes; MELI pagó{" "}
            <strong className="cifra">{pesosDeCentavos(reventa.importe)}</strong>
            {reventa.reconstruidas > 0
              ? <>
                  , reconstruidas al precio público:{" "}
                  <strong className="cifra">{pesosDeCentavos(reventa.totalComprador)}</strong>
                  {reventa.reconstruidas < reventa.ordenes
                    ? ` (${(reventa.ordenes - reventa.reconstruidas).toLocaleString("es-MX")} sin reconstruir)`
                    : ""}
                </>
              : ", ya netas (sin reconstruir todavía)"}
          </span>
        ) : null}
        {totales.sinIdentificar !== 0 ? (
          <span style={{ color: "var(--estado-alerta)" }}>
            Sin identificar: {porcentaje(parteSinIdentificar)} de la venta bruta
          </span>
        ) : null}
      </footer>
    </div>
  );
}
