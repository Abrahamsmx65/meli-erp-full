import type { EstadoSku } from "../engine/types";

/**
 * Etiqueta de estado en texto plano, para el Excel.
 *
 * En pantalla el estado va con color e ícono, pero en una hoja de cálculo hay
 * que poder filtrar y ordenar por él, así que aquí es puro texto.
 */
const ETIQUETAS: Record<EstadoSku, string> = {
  critico: "Crítico",
  urgente: "Urgente",
  ok: "Sano",
  sobrestock: "Sobrestock",
  sin_demanda: "Sin venta",
};

export function etiquetaEstadoTexto(estado: EstadoSku): string {
  return ETIQUETAS[estado] ?? estado;
}
