/**
 * Las fotos CAPTURADAS en la publicación, por SKU.
 *
 * El catálogo público (Catalog Items) le presta a un color sin fotos propias
 * las de la FAMILIA — las del color publicado —, así que de ahí no se puede
 * distinguir lo suyo. Pero lo que el vendedor SUBIÓ vive en los ATRIBUTOS de
 * la publicación (`main_product_image_locator`,
 * `other_product_image_locator_1…8`), y Listings Items los devuelve aunque
 * la publicación esté Inactive: por eso es la fuente PRINCIPAL del ZIP de
 * contenido, para todos los colores («en la API sí está» y «¿por qué no
 * tomamos todo de la API?», dueño, 25-sep-2026, GT125).
 *
 * Mismo camino que los FNSKU (`fnskus.ts`): de 20 SKUs por llamada, con el
 * Seller ID capturado en `amazon_accounts.selling_partner_id`.
 */
import { ErrorAmazon, type Cliente } from "./spapi";
import { partirEnLotes } from "./fnskus";

/** Un locator de imagen en los atributos: la URL viene en media_location. */
interface Locator {
  marketplace_id?: string;
  media_location?: string;
}

interface ItemConAtributos {
  sku?: string;
  attributes?: Record<string, Locator[] | undefined>;
}

/** main primero y luego other_1…other_8, en su orden. */
const ATRIBUTOS_DE_FOTO = [
  "main_product_image_locator",
  ...Array.from({ length: 8 }, (_, i) => `other_product_image_locator_${i + 1}`),
];

/**
 * Las URLs de las fotos capturadas en los atributos de UNA publicación, en
 * el orden de la ficha (principal primero). Sin fotos capturadas, vacío.
 */
export function fotosDeAtributos(
  attributes: Record<string, Locator[] | undefined> | undefined,
  marketplaceId: string,
): string[] {
  if (!attributes) return [];
  const salida: string[] = [];
  for (const nombre of ATRIBUTOS_DE_FOTO) {
    const locators = attributes[nombre] ?? [];
    const l = locators.find((x) => x.marketplace_id === marketplaceId) ?? locators[0];
    const url = (l?.media_location ?? "").trim();
    if (url && !salida.includes(url)) salida.push(url);
  }
  return salida;
}

/**
 * Las fotos capturadas de varios SKUs: mapa sku → URLs. Un SKU que Amazon no
 * contesta (o sin fotos capturadas) no aparece en el mapa; un lote que
 * Amazon rechaza se salta sin tumbar a los demás, y un `null` (se acabó el
 * plazo) entrega lo ya juntado.
 */
export async function fotosCapturadasPorSku(
  cliente: Cliente,
  sellingPartnerId: string,
  skus: string[],
): Promise<Map<string, string[]>> {
  const salida = new Map<string, string[]>();
  const { lotes } = partirEnLotes(skus);

  for (const lote of lotes) {
    let r: { items?: ItemConAtributos[] } | null;
    try {
      r = await cliente.llamar<{ items?: ItemConAtributos[] }>(
        "GET",
        `/listings/2021-08-01/items/${encodeURIComponent(sellingPartnerId)}`,
        "searchListingsItems",
        {
          params: {
            marketplaceIds: cliente.cuenta.marketplaceId,
            identifiers: lote.join(","),
            identifiersType: "SKU",
            pageSize: lote.length,
            includedData: "attributes",
          },
        },
      );
    } catch (err) {
      if (err instanceof ErrorAmazon && err.status < 500) continue;
      throw err;
    }
    if (r === null) break;

    for (const item of r.items ?? []) {
      const sku = String(item.sku ?? "").trim();
      if (!sku) continue;
      const fotos = fotosDeAtributos(item.attributes, cliente.cuenta.marketplaceId);
      if (fotos.length) salida.set(sku.toUpperCase(), fotos);
    }
  }

  return salida;
}
