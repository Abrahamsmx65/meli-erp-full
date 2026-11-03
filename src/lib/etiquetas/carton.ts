/**
 * Etiquetas del CARTÓN (10 × 5 cm, código de barras) del paquete de
 * etiquetas de un pedido. Su texto es el SKU de MELI de la caja con guiones
 * (`barcodeDeSku` en `servicios/bodega-contenedor.ts`), el mismo barcode que
 * recibe la bodega; aquí queda el orden de las tallas.
 */

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

