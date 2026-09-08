/**
 * Piezas de esqueleto para los loading.tsx por ruta: cada pantalla pone su
 * silueta real (mismas rejillas y alturas), no la genérica de 4 fichas que
 * hacía brincar la página al llegar el contenido.
 */

export function Hueso({ ancho = "100%", alto = "1rem", className = "" }: { ancho?: string; alto?: string; className?: string }) {
  return <div className={`rounded ${className}`} style={{ background: "var(--grid)", width: ancho, height: alto }} aria-hidden="true" />;
}

// Tailwind no compila clases armadas al vuelo: las rejillas van en un mapa.
const REJILLA: Record<number, string> = {
  4: "grid grid-cols-2 gap-3 md:grid-cols-4",
  6: "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6",
};

export function EsqueletoFichas({ cuantas, columnas = 6 }: { cuantas: number; columnas?: 4 | 6 }) {
  return (
    <div className={REJILLA[columnas] ?? REJILLA[6]}>
      {Array.from({ length: cuantas }, (_, i) => (
        <div key={i} className="tarjeta p-4">
          <Hueso ancho="6rem" alto="0.75rem" />
          <Hueso ancho="4.5rem" alto="1.6rem" className="mt-3" />
        </div>
      ))}
    </div>
  );
}

export function EsqueletoTabla({ filas = 6, titulo = true }: { filas?: number; titulo?: boolean }) {
  return (
    <div className="tarjeta overflow-hidden">
      {titulo ? (
        <div className="border-b p-4 hairline">
          <Hueso ancho="14rem" alto="1rem" />
        </div>
      ) : null}
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: filas }, (_, i) => (
          <Hueso key={i} alto="1rem" ancho={`${96 - i * 6}%`} className="opacity-70" />
        ))}
      </div>
    </div>
  );
}

export function EncabezadoEsqueleto() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Hueso ancho="11rem" alto="1.6rem" />
        <Hueso ancho="22rem" alto="0.8rem" className="mt-2" />
      </div>
      <Hueso ancho="9rem" alto="2.2rem" />
    </div>
  );
}
