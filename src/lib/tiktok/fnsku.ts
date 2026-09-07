/**
 * El FNSKU de un SKU de TikTok, con la equivalencia de color por modelo.
 *
 * La caja del zapato lleva SIEMPRE la etiqueta de Amazon (FNSKU), y ese es
 * el código que se escanea. Cuando TikTok llama al color de otra forma que
 * Amazon (MY2304 CAMEL en TikTok = MY2304 BROWN en Amazon), la equivalencia
 * capturada por el dueño (`tiktok_alias_amazon`) traduce el color antes de
 * buscar. Puro: recibe el mapa de Amazon y los alias ya cargados.
 */
import { buscarAmazon, type DatoAmazon } from "../etiquetas/resolver";
import { canonizar } from "../importar/sku";
import { partirSku } from "./despacho";

export interface AliasColorAmazon {
  modelo: string;
  colorTikTok: string;
  colorAmazon: string;
}

/** "MODELO|COLOR canónico" → color de Amazon */
export function indexarAlias(alias: AliasColorAmazon[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of alias) {
    m.set(`${canonizar(a.modelo)}|${canonizar(a.colorTikTok)}`, a.colorAmazon.trim());
  }
  return m;
}

export function resolverFnsku(
  amazon: Map<string, DatoAmazon>,
  alias: Map<string, string>,
  sku: string,
): string | null {
  const directo = buscarAmazon(amazon, sku)?.fnsku;
  if (directo) return directo;
  if (!alias.size) return null;

  const { modelo, color, talla } = partirSku(sku);
  if (!modelo || !color || !talla) return null;
  const colorAmazon = alias.get(`${canonizar(modelo)}|${canonizar(color)}`);
  if (!colorAmazon) return null;

  // Con y sin sufijo de sitio: el resolver ya compara por clave canónica,
  // pero el SKU de Amazon puede traer el -MX y el de TikTok no, o al revés.
  for (const candidato of [`${modelo}-${colorAmazon}-${talla}-MX`, `${modelo}-${colorAmazon}-${talla}`]) {
    const f = buscarAmazon(amazon, candidato)?.fnsku;
    if (f) return f;
  }
  return null;
}
