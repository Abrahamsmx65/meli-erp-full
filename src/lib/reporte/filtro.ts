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
 * El texto sobre el que busca la vista de Bodega: SKU, modelo, color, talla
 * y los números de pedido. Una sola definición para pantalla y Excel.
 */
export function textoBusquedaBodega(r: RenglonBodegaFiltrable): string {
  return `${r.sku} ${r.modelo} ${r.color} ${r.talla} ${r.pedidos.map((p) => p.pedido).join(" ")}`;
}

/**
 * EL filtro de Bodega: la pantalla y /api/inventario/excel llaman esta misma
 * función, así que el archivo trae exactamente los renglones que se ven.
 * (Antes cada lado armaba su propio texto de búsqueda; con que difirieran en
 * un espacio, «Excel de esta vista» ya mentía.)
 *
 * `textos` son los textos de búsqueda PRECALCULADOS con textoBusquedaBodega,
 * alineados por índice con `renglones`: la pantalla los arma UNA vez por
 * carga (useMemo) y teclear no reconstruye la representación de miles de
 * filas. Sin `textos` (el Excel, una sola pasada) se calculan al vuelo.
 */
export function filtrarBodega<T extends RenglonBodegaFiltrable>(
  renglones: T[],
  filtro: FiltroBodega,
  textos?: string[],
): T[] {
  const terminos = terminosDeBusqueda(filtro.q);
  const salida: T[] = [];
  for (let i = 0; i < renglones.length; i++) {
    const r = renglones[i];
    if (!filtro.conCeros && r.enBodega + r.enCamino <= 0) continue;
    if (filtro.almacen && !r.pedidos.some((p) => p.almacen === filtro.almacen)) continue;
    if (coincide(textos ? textos[i] : textoBusquedaBodega(r), terminos)) salida.push(r);
  }
  return salida;
}
