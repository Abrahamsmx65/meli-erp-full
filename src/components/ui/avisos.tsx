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

const COLOR: Record<TipoAviso, { borde: string; icono: string }> = {
  exito: { borde: "var(--estado-bien)", icono: "✓" },
  error: { borde: "var(--estado-critico)", icono: "✕" },
  info: { borde: "var(--acento)", icono: "ℹ" },
};

export function Avisos() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  useEffect(() => {
    const escuchar = (e: Event) => {
      const aviso = (e as CustomEvent<Aviso>).detail;
      setAvisos((prev) => [...prev.slice(-3), aviso]);
      const vida = aviso.tipo === "error" ? 9000 : 4500;
      window.setTimeout(() => setAvisos((prev) => prev.filter((a) => a.id !== aviso.id)), vida);
    };
    window.addEventListener(EVENTO, escuchar);
    return () => window.removeEventListener(EVENTO, escuchar);
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
          className="tarjeta flex items-start gap-2.5 border-l-4 p-3 text-sm shadow-lg"
          style={{ borderLeftColor: COLOR[a.tipo].borde }}
        >
          <span aria-hidden="true" style={{ color: COLOR[a.tipo].borde }}>
            {COLOR[a.tipo].icono}
          </span>
          <span className="min-w-0 flex-1 break-words">{a.texto}</span>
          <button
            onClick={() => setAvisos((prev) => prev.filter((x) => x.id !== a.id))}
            aria-label="Cerrar aviso"
            className="shrink-0 text-xs"
            style={{ color: "var(--ink-muted)" }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
