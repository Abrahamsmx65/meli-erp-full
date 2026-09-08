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

/** Lo mínimo que un renglón de Bodega necesita para poderse filtrar. */
export interface RenglonBodegaFiltrable {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  enBodega: number;
  enCamino: number;
  pedidos: { pedido: string; almacen: string }[];
}

/** Los filtros de la vista de Bodega, tal como viajan en la URL del Excel. */
export interface FiltroBodega {
  q?: string | null;
  almacen?: string | null;
  /** true = incluir también los SKUs sin existencia (el ?conCeros=1). */
  conCeros?: boolean;
}

/**
 * EL filtro de Bodega: la pantalla y /api/inventario/excel llaman esta misma
 * función, así que el archivo trae exactamente los renglones que se ven.
 * (Antes cada lado armaba su propio texto de búsqueda; con que difirieran en
 * un espacio, «Excel de esta vista» ya mentía.)
 */
export function filtrarBodega<T extends RenglonBodegaFiltrable>(
  renglones: T[],
  filtro: FiltroBodega,
): T[] {
  const terminos = terminosDeBusqueda(filtro.q);
  return renglones.filter((r) => {
    if (!filtro.conCeros && r.enBodega + r.enCamino <= 0) return false;
    if (filtro.almacen && !r.pedidos.some((p) => p.almacen === filtro.almacen)) return false;
    return coincide(
      `${r.sku} ${r.modelo} ${r.color} ${r.talla} ${r.pedidos.map((p) => p.pedido).join(" ")}`,
      terminos,
    );
  });
}
