import type { EstadoSku } from "@/lib/engine/types";

/**
 * Un estado nunca se comunica solo con color: siempre lleva ícono y texto.
 * Así funciona igual para quien no distingue rojo de verde, en impresión
 * en blanco y negro, y en modo de alto contraste.
 */
const ESTILOS: Record<
  EstadoSku,
  { etiqueta: string; icono: string; color: string; fondo: string }
> = {
  critico: {
    etiqueta: "Crítico",
    icono: "▲",
    color: "var(--estado-critico)",
    fondo: "color-mix(in oklab, var(--estado-critico) 12%, transparent)",
  },
  urgente: {
    etiqueta: "Urgente",
    icono: "◆",
    color: "var(--estado-serio)",
    fondo: "color-mix(in oklab, var(--estado-serio) 14%, transparent)",
  },
  ok: {
    etiqueta: "Sano",
    icono: "●",
    color: "var(--estado-bien)",
    fondo: "color-mix(in oklab, var(--estado-bien) 12%, transparent)",
  },
  sobrestock: {
    etiqueta: "Sobrestock",
    icono: "■",
    color: "var(--estado-alerta)",
    fondo: "color-mix(in oklab, var(--estado-alerta) 18%, transparent)",
  },
  sin_demanda: {
    etiqueta: "Sin venta",
    icono: "○",
    color: "var(--ink-muted)",
    fondo: "color-mix(in oklab, var(--ink-muted) 12%, transparent)",
  },
};

export function Estado({ estado }: { estado: EstadoSku }) {
  const e = ESTILOS[estado];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ color: e.color, background: e.fondo }}
    >
      <span aria-hidden="true">{e.icono}</span>
      {e.etiqueta}
    </span>
  );
}

export function colorEstado(estado: EstadoSku): string {
  return ESTILOS[estado].color;
}

export function etiquetaEstado(estado: EstadoSku): string {
  return ESTILOS[estado].etiqueta;
}
