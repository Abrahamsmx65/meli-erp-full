"use client";

/**
 * Avisos (toasts) del sistema: éxito y error tras una acción, sin alert().
 *
 * Sin contexto ni proveedor que enhebrar: `avisar()` dispara un CustomEvent
 * y el <Avisos/> montado en el armazón lo pinta. Cualquier componente
 * cliente puede avisar con una línea. Los errores no se auto-cierran tan
 * rápido: hay que poder leerlos.
 */
import { useEffect, useState } from "react";

export type TipoAviso = "exito" | "error" | "info";

interface Aviso {
  id: number;
  tipo: TipoAviso;
  texto: string;
}

const EVENTO = "erp:aviso";
let siguienteId = 1;

export function avisar(tipo: TipoAviso, texto: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { id: siguienteId++, tipo, texto } }));
}

/** Cuánto dura la salida (globals.css, `.toast[data-saliendo]`). */
const SALIDA_MS = 150;

const COLOR: Record<TipoAviso, string> = {
  exito: "var(--estado-bien)",
  error: "var(--estado-critico)",
  info: "var(--acento)",
};

/** Ícono de estado: círculo del tono con el trazo en blanco. */
function Icono({ tipo }: { tipo: TipoAviso }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0">
      <circle cx="8" cy="8" r="8" fill={COLOR[tipo]} />
      {tipo === "exito" ? (
        <path d="M4.75 8.25 7 10.5l4.25-4.75" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      ) : tipo === "error" ? (
        <path d="M5.5 5.5l5 5m0-5-5 5" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" />
      ) : (
        <path d="M8 7.25v4M8 4.75v.01" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function Avisos() {
  const [avisos, setAvisos] = useState<(Aviso & { saliendo?: boolean })[]>([]);

  // Primero se marca «saliendo» (se desvanece) y luego se quita.
  const quitar = (id: number) => {
    setAvisos((prev) => prev.map((a) => (a.id === id ? { ...a, saliendo: true } : a)));
    window.setTimeout(() => setAvisos((prev) => prev.filter((a) => a.id !== id)), SALIDA_MS);
  };

  useEffect(() => {
    const escuchar = (e: Event) => {
      const aviso = (e as CustomEvent<Aviso>).detail;
      setAvisos((prev) => [...prev.slice(-3), aviso]);
      const vida = aviso.tipo === "error" ? 9000 : 4500;
      window.setTimeout(() => quitar(aviso.id), vida);
    };
    window.addEventListener(EVENTO, escuchar);
    return () => window.removeEventListener(EVENTO, escuchar);
    // `quitar` solo usa el setter, que no cambia
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!avisos.length) return null;
  return (
    <div
      className="no-imprimir fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      role="region"
      aria-live="polite"
      aria-label="Avisos"
    >
      {avisos.map((a) => (
        <div
          key={a.id}
          className="toast tarjeta flex items-start gap-2.5 p-3 text-sm shadow-lg"
          data-saliendo={a.saliendo ? "true" : undefined}
        >
          <Icono tipo={a.tipo} />
          <span className="min-w-0 flex-1 break-words">{a.texto}</span>
          <button
            onClick={() => quitar(a.id)}
            aria-label="Cerrar aviso"
            className="texto-tenue -m-1 shrink-0 p-1 text-xs"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
