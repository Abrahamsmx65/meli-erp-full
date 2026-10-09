/**
 * Cuánto tardó (o lleva) la preparación de un corte de TikTok, para el
 * renglón del corte en Despacho (dueño, 9-oct-2026: «el tiempo que tomó
 * preparar cada despacho»). Puro, sin reloj.
 */

/** Duración legible: «< 1 min», «N min», «H h M min». */
export function formatoDuracion(ms: number): string {
  const minutos = Math.floor(Math.max(0, ms) / 60_000);
  if (minutos < 1) return "< 1 min";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/**
 * El texto del tiempo de preparación: «Preparado en …» si el corte ya está
 * completo, «En preparación · …» si empezó y falta; null si nadie ha
 * preparado nada. Se mide de la primera a la última constancia.
 */
export function textoTiempoPreparacion(
  primera: string | null | undefined,
  ultima: string | null | undefined,
  completo: boolean,
): string | null {
  if (!primera || !ultima) return null;
  const ms = new Date(ultima).getTime() - new Date(primera).getTime();
  if (!Number.isFinite(ms)) return null;
  const duracion = formatoDuracion(ms);
  return completo ? `Preparado en ${duracion}` : `En preparación · ${duracion}`;
}
