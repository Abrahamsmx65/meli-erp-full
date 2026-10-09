/**
 * Pantalla de carga global: aparece EN EL INSTANTE del clic, mientras el
 * servidor arma la página. Tiene la misma forma que toda pantalla (ceja,
 * título, cifras y una sección) para que al llegar los datos nada brinque.
 */
export default function Cargando() {
  const hueso = { background: "var(--grid)" };
  return (
    <div className="pagina" aria-busy="true" aria-live="polite" aria-label="Cargando">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="h-2.5 w-24 rounded" style={hueso} />
          <div className="mt-2.5 h-6 w-56 rounded" style={hueso} />
          <div className="mt-2.5 h-3.5 w-96 max-w-full rounded" style={{ ...hueso, opacity: 0.7 }} />
        </div>
        <span className="girando text-[20px]" aria-hidden="true" />
      </div>

      <div className="cifras animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="tarjeta h-[104px] p-4">
            <div className="h-3 w-24 rounded" style={hueso} />
            <div className="mt-3 h-7 w-28 rounded" style={hueso} />
          </div>
        ))}
      </div>

      <div className="tarjeta animate-pulse overflow-hidden">
        <div className="seccion-cabeza">
          <div className="h-4 w-40 rounded" style={hueso} />
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
