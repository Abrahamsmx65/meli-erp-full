import { claveComparacion } from "../importar/sku";

/**
 * Clave para amarrar el SKU de MELI con el de Amazon. No basta la clave
 * canónica: en Amazon algunos SKUs traen las mismas piezas en OTRO orden
 * ("GT125-25-BLK-MX" con la talla antes del color). Ordenar los pedazos
 * alfabéticamente hace que los dos órdenes caigan en la misma clave, y como
 * modelo, color y talla tienen que coincidir de todas formas, el riesgo de
 * un falso positivo es mínimo.
 */
export function claveOrdenada(s: string): string {
  return claveComparacion(s).split("-").sort().join("-");
}
