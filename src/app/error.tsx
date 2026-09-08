"use client";

import { useEffect } from "react";

/**
 * Pantalla de error de toda la app (antes no existía NINGÚN error.tsx: un
 * fallo de una consulta tumbaba a la página de error genérica de Next, sin
 * botón de reintentar). El error técnico va a la consola para diagnóstico;
 * al usuario se le dice qué pasó y qué puede hacer.
 */
export default function ErrorApp({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error de página:", error);
  }, [error]);

  return (
    <div className="tarjeta mx-auto mt-10 max-w-lg p-8 text-center">
      <h1 className="titulo-seccion">Algo falló al cargar esta pantalla</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
        Los datos no se perdieron: fue un error al leerlos o al pintarlos. Casi
        siempre se arregla reintentando; si sigue fallando, avisa qué pantalla
        era y a qué hora pasó.
      </p>
      {error?.message ? (
        <p
          className="mx-auto mt-3 max-w-md overflow-x-auto rounded-lg p-2 text-left font-mono text-xs"
          style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
        >
          {error.message}
        </p>
      ) : null}
      <div className="mt-4 flex justify-center gap-2">
        <button onClick={reset} className="boton boton-primario">
          Reintentar
        </button>
        <a href="/" className="boton boton-fantasma">
          Ir al inicio
        </a>
      </div>
    </div>
  );
}
