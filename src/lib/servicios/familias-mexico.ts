/**
 * Total en México por familia (Bodega). Puro y sin dependencias del servidor:
 * lo usan `inventario.ts` y el componente `TotalMexico`, que lo arma en el
 * navegador con los mismos renglones de la tabla de Bodega.
 */

/** Lo mínimo de un renglón de inventario que necesita el total por familia. */
export interface RenglonFamilia {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  enBodega: number;
}

/** Una talla suelta dentro de una familia. */
export interface TotalMexicoSku {
  sku: string;
  color: string;
  talla: string;
  /** pares en cajas cerradas, sumando TODAS las bodegas de México */
  pares: number;
}

/** Una familia entera (GT114, GT128…) con todo lo que hay de ella en México. */
export interface FamiliaMexico {
  modelo: string;
  /** cajas en bodega, contadas una sola vez */
  cajas: number;
  /** pares en cajas cerradas, todas las bodegas juntas */
  pares: number;
  /** cuántos colores distintos hay con existencia */
  colores: number;
  /** el desglose por talla y color, para abrir el renglón */
  detalle: TotalMexicoSku[];
}

/**
 * Lo que ya está aterrizado en México, junto por familia: GT114 va todo
 * junto, GT128 va todo junto, sin importar talla ni color. Todas las bodegas
 * suman en un solo número y lo que viene de China no entra: todavía no se
 * puede mandar a ningún lado.
 *
 * Las cajas se cuentan una sola vez porque una caja de corrida, aunque traiga
 * varias tallas, es siempre de un solo modelo. Ese es justo el número que a
 * nivel talla no se puede dar.
 */
export function familiasMexico(
  renglones: RenglonFamilia[],
  cajasPorModelo: Record<string, number>,
): FamiliaMexico[] {
  const familias = new Map<string, FamiliaMexico>();

  for (const r of renglones) {
    if (r.enBodega <= 0) continue;
    const modelo = r.modelo || "(sin modelo)";
    const f =
      familias.get(modelo) ??
      { modelo, cajas: cajasPorModelo[modelo] ?? 0, pares: 0, colores: 0, detalle: [] };
    f.pares += r.enBodega;
    f.detalle.push({ sku: r.sku, color: r.color, talla: r.talla, pares: r.enBodega });
    familias.set(modelo, f);
  }

  for (const f of familias.values()) {
    f.colores = new Set(f.detalle.map((d) => d.color)).size;
    // Dentro de la familia se lee por color y luego por talla, como está el
    // producto en el rack: no por cantidad.
    f.detalle.sort(
      (a, b) =>
        a.color.localeCompare(b.color, "es") ||
        (Number(a.talla) || 0) - (Number(b.talla) || 0) ||
        a.talla.localeCompare(b.talla, "es"),
    );
  }

  return [...familias.values()].sort((a, b) => b.pares - a.pares);
}
