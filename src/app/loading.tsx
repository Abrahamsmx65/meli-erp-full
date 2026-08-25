/**
 * Esqueleto de carga global: aparece EN EL INSTANTE del clic, mientras el
 * servidor arma la página. Sin esto, la navegación se sentía congelada — el
 * clic no pintaba nada hasta que el servidor terminaba todo el cálculo.
 */
export default function Cargando() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-label="Cargando">
      <div>
        <div className="h-6 w-64 rounded" style={{ background: "var(--borde)" }} />
        <div className="mt-2 h-4 w-96 max-w-full rounded" style={{ background: "var(--borde)", opacity: 0.6 }} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="tarjeta h-24 p-4">
            <div className="h-3 w-20 rounded" style={{ background: "var(--borde)" }} />
            <div className="mt-3 h-6 w-16 rounded" style={{ background: "var(--borde)" }} />
          </div>
        ))}
      </div>

      <div className="tarjeta p-4">
        <div className="h-4 w-48 rounded" style={{ background: "var(--borde)" }} />
        <div className="mt-4 flex flex-col gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-4 rounded"
              style={{ background: "var(--borde)", opacity: 0.5, width: `${95 - i * 7}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
