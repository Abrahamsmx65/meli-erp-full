/**
 * El color de cada canal de venta, UNA sola fuente para todo el sistema
 * (rediseño, oct-2026): gráficas, Inicio, Estado de resultados. Son los
 * tonos tierra validados para gráficas (caramelo, mezclilla, verde y
 * mostaza) con la misma asignación que ya usaban la gráfica por día y por
 * hora, el monitor de hoy, el PDF del corte general y los correos. El color
 * sigue al canal, nunca a su lugar en una lista.
 *
 * Puro: lo importan componentes del navegador y del servidor.
 */

export type CanalVenta = "meli_calzado" | "meli_fundas" | "amazon" | "tiktok";

export const COLOR_CANAL: Record<CanalVenta, string> = {
  meli_calzado: "#a35f1c", // caramelo
  amazon: "#3a72b8", // mezclilla
  meli_fundas: "#2f9c63", // verde
  tiktok: "#d3a52e", // mostaza
};

/** Orden fijo de los canales en leyendas y tablas. */
export const ORDEN_CANALES: CanalVenta[] = ["meli_calzado", "amazon", "meli_fundas", "tiktok"];

export function colorDeCanal(canal: string): string | null {
  return (COLOR_CANAL as Record<string, string>)[canal] ?? null;
}
