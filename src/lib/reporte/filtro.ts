/**
 * Búsqueda de texto compartida entre la pantalla y el Excel.
 *
 * Vive aquí y no duplicada en cada lado porque si las dos difieren aunque sea
 * un poco, el archivo descargado no coincide con lo que se ve en pantalla —
 * y eso es peor que no tener buscador: te hace mandar cajas equivocadas.
 */

/** Parte lo que el usuario escribió en términos independientes. */
export function terminosDeBusqueda(q: string | null | undefined): string[] {
  return (q ?? "").trim().toUpperCase().split(/\s+/).filter(Boolean);
}

/**
 * Coincide si TODAS las palabras aparecen en el texto, en cualquier orden.
 * Así "gt110 navy" y "navy gt110" filtran igual, y "gt110" solo trae ese modelo.
 */
export function coincide(texto: string, terminos: string[]): boolean {
  if (!terminos.length) return true;
  const t = texto.toUpperCase();
  return terminos.every((p) => t.includes(p));
}
