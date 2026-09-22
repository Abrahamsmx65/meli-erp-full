/**
 * Etiquetas del CARTÓN (10 × 5 cm, código de barras) del paquete de
 * etiquetas de un pedido: qué texto lleva cada una.
 */

/** Sin espacios y en mayúsculas: "blk/brown " → "BLK/BROWN". */
function pegado(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

/**
 * Los textos de las etiquetas del cartón de un modelo: PEDIDO-MODELO-COLOR
 * para las cajas de corrida y PEDIDO-MODELO-COLOR-TALLA por cada caja de
 * una sola talla, en el orden de los colores y con las tallas naturales.
 */
export function textosDeCarton(
  pedido: string,
  modelo: string,
  cartones: { color: string; tallas: Iterable<string>; corrida: boolean }[],
): string[] {
  const textos: string[] = [];
  for (const c of cartones) {
    const base = `${pedido}-${modelo}-${c.color}`;
    if (c.corrida) textos.push(base);
    for (const t of ordenarTallas([...c.tallas])) textos.push(`${base}-${pegado(t)}`);
  }
  return textos;
}

/** Tallas en orden natural: 21, 21.5, 22 … y lo no numérico al final. */
export function ordenarTallas(tallas: string[]): string[] {
  return [...tallas].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    if (Number.isFinite(na)) return -1;
    if (Number.isFinite(nb)) return 1;
    return a.localeCompare(b);
  });
}

