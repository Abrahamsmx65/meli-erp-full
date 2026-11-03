/**
 * Cómo se escribe una CATEGORÍA de Productos y costos: en MAYÚSCULAS, con un
 * solo espacio entre palabras (dueño, 19-oct-2026: «que todas las categorías
 * sean en mayúscula o minúscula»; el catálogo enseñaba «Botas lluvia» y
 * «BOTAS LLUVIA» como dos). Es lo que ya hacía el importador de Excel.
 * «Fundas» es la excepción: así la busca el ERP de YAPANIZCEL.
 */
export const CATEGORIA_FUNDAS = "Fundas";
/** El catálogo para creadores agrupa aquí lo que no tiene categoría. */
export const SIN_CATEGORIA_CATALOGO = "OTROS";

export function normalizarCategoria(c: string | null | undefined): string | null {
  const limpia = String(c ?? "").replace(/\s+/g, " ").trim();
  if (!limpia) return null;
  if (limpia.toLowerCase() === CATEGORIA_FUNDAS.toLowerCase()) return CATEGORIA_FUNDAS;
  return limpia.toLocaleUpperCase("es-MX");
}
