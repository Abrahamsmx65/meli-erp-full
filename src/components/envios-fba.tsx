import type { RenglonAmazon } from "@/lib/servicios/amazon";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/** Días de venta que el stock en FBA debe cubrir. */
const OBJETIVO_DIAS = 30;

/** Con menos de esto de cobertura, el envío ya es urgente. */
const URGENTE_DIAS = 14;

interface Sugerencia {
  sku: string;
  titulo: string | null;
  ventaDiaria: number;
  disponible: number;
  enTransferencia: number;
  cobertura: number | null;
  sugerido: number;
}

/**
 * Qué mandar a FBA.
 *
 * La misma lógica que los envíos a Full, en su versión simple: al ritmo de
 * venta del periodo, ¿cuántos pares hacen falta para cubrir el objetivo de
 * días? Lo que ya está en FBA y lo que va en camino cuenta a favor; lo que
 * falte es lo que hay que mandar. Se calcula con los datos que la página ya
 * trae — no cuesta ninguna consulta extra.
 */
export function EnviosFba({ renglones, dias }: { renglones: RenglonAmazon[]; dias: number }) {
  const sugerencias: Sugerencia[] = renglones
    .filter((r) => r.unidades > 0)
    .map((r) => {
      const ventaDiaria = r.unidades / dias;
      const posicion = r.disponible + r.enTransferencia;
      const sugerido = Math.max(0, Math.ceil(ventaDiaria * OBJETIVO_DIAS - posicion));
      return {
        sku: r.sku,
        titulo: r.titulo,
        ventaDiaria,
        disponible: r.disponible,
        enTransferencia: r.enTransferencia,
        cobertura: r.cobertura,
        sugerido,
      };
    })
    .filter((s) => s.sugerido > 0)
    .sort((a, b) => (a.cobertura ?? 0) - (b.cobertura ?? 0));

  const totalPares = sugerencias.reduce((a, s) => a + s.sugerido, 0);
  const urgentes = sugerencias.filter(
    (s) => (s.cobertura ?? 0) < URGENTE_DIAS,
  ).length;
  const visibles = sugerencias.slice(0, 100);

  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-4 hairline">
        <h2 className="text-base font-semibold">Envíos a FBA</h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Qué mandar a Amazon para cubrir {OBJETIVO_DIAS} días al ritmo de venta de los
          últimos {dias === 365 ? 365 : dias} días. Lo que ya está en FBA y lo que va en
          camino cuenta a favor.
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="cifra">{n(sugerencias.length)}</strong> SKUs por reponer ·{" "}
          <span className="cifra">{n(totalPares)}</span> pares sugeridos
          {urgentes > 0 ? (
            <>
              {" "}·{" "}
              <span style={{ color: "var(--estado-critico)" }}>
                {n(urgentes)} con menos de {URGENTE_DIAS} días de stock
              </span>
            </>
          ) : null}
          {sugerencias.length > visibles.length
            ? ` · mostrando los ${n(visibles.length)} más urgentes`
            : null}
        </p>
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
                        s.cobertura !== null && s.cobertura < URGENTE_DIAS
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
