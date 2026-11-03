/**
 * Búsqueda de la tabla de Bodega fundas (puro, sin base: lo usa el
 * navegador). Un renglón entra al filtro si el texto aparece en su SKU, su
 * título, sus SKUs de bodega, su diseño o su tipo; pero un diseño solo se
 * ABRE solo si algún SKU suyo coincide por lo SUYO (SKU, título o bodega).
 * Antes cualquier búsqueda abría TODOS los diseños: buscar «462» o «Fundas»
 * pintaba miles de renglones de un jalón.
 */
export interface RenglonBuscable {
  skuMeli: string;
  titulo?: string | null;
  diseno: string;
  tipo?: string | null;
  skusBodega: string[];
}

export function normalizarBusqueda(q: string): string {
  return q.trim().toUpperCase();
}

/** ¿El renglón pasa el filtro? (`q` ya normalizada; vacía = todo pasa) */
export function coincideRenglon(r: RenglonBuscable, q: string): boolean {
  return !q || `${r.skuMeli} ${r.titulo ?? ""} ${r.diseno} ${r.tipo ?? ""} ${r.skusBodega.join(" ")}`.toUpperCase().includes(q);
}

/** ¿Coincide por lo suyo (no solo por el nombre de su diseño o tipo)? */
export function coincideEnSku(r: RenglonBuscable, q: string): boolean {
  return Boolean(q) && `${r.skuMeli} ${r.titulo ?? ""} ${r.skusBodega.join(" ")}`.toUpperCase().includes(q);
}
