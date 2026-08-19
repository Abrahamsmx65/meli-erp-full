import type { RenglonAmazon } from "@/lib/servicios/amazon";
import {
  OBJETIVO_DIAS_FBA,
  URGENTE_DIAS_FBA,
  sugerirEnvioFba,
} from "@/lib/servicios/fba";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Qué mandar a FBA. El cálculo vive en servicios/fba.ts — es el mismo que
 * usa el Excel, para que la pantalla y el archivo nunca digan cosas
 * distintas.
 */
export function EnviosFba({ renglones, dias }: { renglones: RenglonAmazon[]; dias: number }) {
  const sugerencias = sugerirEnvioFba(renglones, dias);

  const totalPares = sugerencias.reduce((a, s) => a + s.sugerido, 0);
  const urgentes = sugerencias.filter(
    (s) => (s.cobertura ?? 0) < URGENTE_DIAS_FBA,
  ).length;
  const visibles = sugerencias.slice(0, 100);

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4 hairline">
        <div>
          <h2 className="text-base font-semibold">Envíos a FBA</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Qué mandar a Amazon para cubrir {OBJETIVO_DIAS_FBA} días al ritmo de venta de
            los últimos {dias === 365 ? 365 : dias} días. Lo que ya está en FBA y lo que
            va en camino cuenta a favor.
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
            <strong className="cifra">{n(sugerencias.length)}</strong> SKUs por reponer ·{" "}
            <span className="cifra">{n(totalPares)}</span> pares sugeridos
            {urgentes > 0 ? (
              <>
                {" "}·{" "}
                <span style={{ color: "var(--estado-critico)" }}>
                  {n(urgentes)} con menos de {URGENTE_DIAS_FBA} días de stock
                </span>
              </>
            ) : null}
            {sugerencias.length > visibles.length
              ? ` · mostrando los ${n(visibles.length)} más urgentes`
              : null}
          </p>
        </div>

        {sugerencias.length > 0 ? (
          <a
            href={`/api/amazon/envio-excel?dias=${dias}`}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--acento)" }}
          >
            Excel de este envío
          </a>
        ) : null}
      </header>

      {visibles.length === 0 ? (
        <p className="p-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
          Nada que mandar: todo lo que vende tiene cobertura de sobra.
        </p>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th className="num">Venta diaria</th>
                <th className="num">En FBA</th>
                <th className="num">En camino</th>
                <th className="num">Cobertura</th>
                <th className="num">Mandar</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((s) => (
                <tr key={s.sku}>
                  <td className="cifra whitespace-nowrap">{s.sku}</td>
                  <td
                    className="max-w-[24rem] truncate"
                    style={{ color: "var(--ink-2)" }}
                    title={s.titulo ?? undefined}
                  >
                    {s.titulo ?? "—"}
                  </td>
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
                  <td className="num cifra font-semibold">{n(s.sugerido)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
