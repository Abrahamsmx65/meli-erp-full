/**
 * Amarrar el SKU de TikTok con el SKU interno del ERP.
 *
 * Es el mismo problema de siempre —el mismo par escrito distinto en cada
 * lado— y se resuelve con la misma escalera que Mercado Libre y Amazon, en
 * este orden y sin brincos:
 *
 *   1. mapeo manual   (lo que se amarró a mano gana sobre todo)
 *   2. exacto         (mismo texto, ignorando mayúsculas)
 *   3. canónico       (sin acentos, sin espacios raros, sin sufijo -MX)
 *   4. aplastado      (sin ningún separador)
 *   5. ordenado       (los pedazos alfabetizados: TikTok, como Amazon, a
 *                      veces trae la talla antes del color)
 *
 * Lo que no cae en ninguno se queda SIN amarrar a propósito. Un SKU adivinado
 * descontaría del par equivocado y dejaría dos publicaciones mal a la vez.
 */
import { claveOrdenada, type IndiceCatalogo } from "../etiquetas/resolver";
import { claveAplastada, claveComparacion } from "../importar/sku";

export type OrigenAmarreTikTok = "manual" | "exacto" | "canonico" | "aplastado" | "ordenado";

export interface AmarreTikTok {
  skuInterno: string | null;
  origen: OrigenAmarreTikTok | null;
}

export function amarrarSkuTikTok(
  sellerSku: string | null | undefined,
  indice: IndiceCatalogo,
  manual: Map<string, string>,
): AmarreTikTok {
  const crudo = String(sellerSku ?? "").trim();
  if (!crudo) return { skuInterno: null, origen: null };

  const aMano = manual.get(crudo.toUpperCase());
  if (aMano) return { skuInterno: aMano, origen: "manual" };

  const exacto = indice.exacto.get(crudo.toUpperCase());
  if (exacto) return { skuInterno: exacto.sku, origen: "exacto" };

  const canonico = indice.canonico.get(claveComparacion(crudo));
  if (canonico) return { skuInterno: canonico.sku, origen: "canonico" };

  const aplastado = indice.aplastado.get(claveAplastada(crudo));
  if (aplastado) return { skuInterno: aplastado.sku, origen: "aplastado" };

  const ordenado = indice.ordenado.get(claveOrdenada(crudo));
  if (ordenado) return { skuInterno: ordenado.sku, origen: "ordenado" };

  return { skuInterno: null, origen: null };
}
