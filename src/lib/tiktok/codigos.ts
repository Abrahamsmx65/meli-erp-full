/**
 * Todos los códigos de barras que valen para un mismo producto.
 *
 * En la caja del zapato puede venir pegada la etiqueta de Amazon (FNSKU) o
 * la de Mercado Envíos Full (el "código Full", que es el `inventory_id` de
 * la variante) de CUALQUIERA de las dos cuentas de MELI: la de calzado y la
 * de fundas. Son etiquetas distintas del MISMO par, así que la estación de
 * preparar tiene que aceptar las tres: lo que importa es que el código
 * corresponda exactamente a ese SKU.
 *
 * Puro: recibe las filas ya leídas (sku + inventory_id) y arma el índice
 * con los mismos amarres que el resto del ERP (canónico, con los pedazos
 * ordenados y aplastado).
 */
import { claveAplastada, claveComparacion } from "../importar/sku";
import { claveOrdenada } from "../etiquetas/resolver";

export interface FilaCodigoMeli {
  sku: string;
  /** el código Full de MELI: lo que va en el código de barras de su etiqueta */
  inventoryId: string | null;
}

/** clave de SKU → códigos Full que le corresponden (normalmente uno por cuenta). */
export type IndiceCodigosMeli = Map<string, string[]>;

function normalizar(codigo: string): string {
  return String(codigo ?? "").trim().toUpperCase();
}

export function indexarCodigosMeli(filas: FilaCodigoMeli[]): IndiceCodigosMeli {
  const ix: IndiceCodigosMeli = new Map();
  const anotar = (clave: string, codigo: string) => {
    if (!clave) return;
    const l = ix.get(clave) ?? [];
    if (!l.includes(codigo)) l.push(codigo);
    ix.set(clave, l);
  };
  for (const f of filas ?? []) {
    const codigo = normalizar(f?.inventoryId ?? "");
    if (!codigo || !f?.sku) continue;
    anotar(claveComparacion(f.sku), codigo);
    anotar(claveOrdenada(f.sku), codigo);
    anotar(claveAplastada(f.sku), codigo);
  }
  return ix;
}

/** Los códigos Full de un SKU (de TikTok, de bodega o de MELI), con los tres amarres. */
export function codigosMeliDeSku(ix: IndiceCodigosMeli, sku: string): string[] {
  if (!ix.size || !sku) return [];
  return ix.get(claveComparacion(sku)) ?? ix.get(claveOrdenada(sku)) ?? ix.get(claveAplastada(sku)) ?? [];
}

/**
 * Todos los códigos con los que se puede dar por bueno un par: el FNSKU de
 * Amazon primero (es el que se imprime en la guía) y luego los códigos Full
 * de MELI. Sin repetidos y en mayúsculas, como los deja el escáner.
 */
export function codigosDeProducto(par: { fnsku?: string | null; codigos?: string[] | null }): string[] {
  const salida: string[] = [];
  for (const c of [par?.fnsku ?? "", ...(par?.codigos ?? [])]) {
    const limpio = normalizar(c);
    if (limpio && !salida.includes(limpio)) salida.push(limpio);
  }
  return salida;
}
