/**
 * Esqueleto de carga global: aparece EN EL INSTANTE del clic, mientras el
 * servidor arma la página. Sin esto, la navegación se sentía congelada — el
 * clic no pintaba nada hasta que el servidor terminaba todo el cálculo.
 */
export default function Cargando() {
  const hueso = { background: "var(--grid)" };
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-label="Cargando">
      <div>
        <div className="h-7 w-64 rounded-md" style={hueso} />
        <div className="mt-2 h-4 w-96 max-w-full rounded-md" style={{ ...hueso, opacity: 0.6 }} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="tarjeta h-24 p-4">
            <div className="h-3 w-24 rounded" style={hueso} />
            <div className="mt-3 h-7 w-20 rounded" style={hueso} />
          </div>
        ))}
      </div>

      <div className="tarjeta overflow-hidden">
        <div className="border-b p-4 hairline">
          <div className="h-4 w-48 rounded" style={hueso} />
        </div>
        <div className="flex flex-col gap-3 p-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 rounded" style={{ ...hueso, opacity: 0.6, width: `${95 - i * 7}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
