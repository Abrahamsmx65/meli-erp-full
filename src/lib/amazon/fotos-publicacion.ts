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
  attributes?: Record<string, any[] | undefined>;
}

/** La ficha capturada de una publicación: fotos, puntos clave y descripción. */
export interface FichaCapturada {
  fotos: string[];
  bullets: string[];
  descripcion: string | null;
  titulo: string | null;
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

/** El texto de un atributo de texto de Listings Items (`[{value, marketplace_id, language_tag}]`), el del marketplace primero. */
function textosDeAtributo(valores: any[] | undefined, marketplaceId: string): string[] {
  const lista = (valores ?? []).filter((v) => v && typeof v.value === "string");
  const del = lista.filter((v) => v.marketplace_id === marketplaceId);
  return (del.length ? del : lista).map((v) => String(v.value).trim()).filter(Boolean);
}

/**
 * Lo que la ficha capturada trae además de las fotos: `bullet_point` (los
 * puntos clave, hasta 5) y `product_description`. Sirve para publicar el
 * mismo producto en otro canal (TikTok) sin volver a redactar nada.
 */
export function fichaDeAtributos(attributes: Record<string, any[] | undefined> | undefined, marketplaceId: string): FichaCapturada {
  return {
    fotos: fotosDeAtributos(attributes as Record<string, Locator[] | undefined> | undefined, marketplaceId),
    bullets: textosDeAtributo(attributes?.bullet_point, marketplaceId),
    descripcion: textosDeAtributo(attributes?.product_description, marketplaceId)[0] ?? null,
    titulo: textosDeAtributo(attributes?.item_name, marketplaceId)[0] ?? null,
  };
}

/**
 * El SKU PADRE declarado en los atributos de una variante
 * (`child_parent_sku_relationship`). Amazon lo genera solo al crear la
 * familia desde Seller Central (`V1-KW9T-E95I` en el GT211) y ahí es donde
 * quedan las fotos cuando se suben a nivel familia: las tallas contestan su
 * ficha completa SIN ningún atributo de imagen (visto con la sonda el
 * 2-oct-2026).
 */
export function padreDeAtributos(
  attributes: Record<string, any[] | undefined> | undefined,
): string | null {
  const rel = attributes?.child_parent_sku_relationship ?? [];
  const r = rel.find((x) => x && typeof x.parent_sku === "string" && x.parent_sku.trim());
  return r ? String(r.parent_sku).trim() : null;
}

/**
 * Los atributos capturados de varios SKUs: mapa sku (mayúsculas) →
 * attributes. Un lote que Amazon rechaza se salta sin tumbar a los demás y
 * un `null` (se acabó el plazo) entrega lo ya juntado.
 */
async function atributosPorSku(
  cliente: Cliente,
  sellingPartnerId: string,
  skus: string[],
): Promise<Map<string, Record<string, any[] | undefined>>> {
  const salida = new Map<string, Record<string, any[] | undefined>>();
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
      salida.set(sku.toUpperCase(), item.attributes ?? {});
    }
  }
  return salida;
}

/**
 * Las fotos de los SKUs PADRE de las variantes que no traen foto propia:
 * mapa sku hijo (mayúsculas) → fotos del padre. Una pasada extra solo con
 * los padres que hagan falta.
 */
async function fotosDeLosPadres(
  cliente: Cliente,
  sellingPartnerId: string,
  atributos: Map<string, Record<string, any[] | undefined>>,
  sinFoto: (sku: string) => boolean,
): Promise<Map<string, string[]>> {
  const padreDe = new Map<string, string>();
  for (const [sku, attrs] of atributos) {
    if (!sinFoto(sku)) continue;
    const padre = padreDeAtributos(attrs);
    if (padre) padreDe.set(sku, padre);
  }
  const salida = new Map<string, string[]>();
  if (!padreDe.size) return salida;

  const dePadres = await atributosPorSku(cliente, sellingPartnerId, [
    ...new Set(padreDe.values()),
  ]);
  for (const [sku, padre] of padreDe) {
    const fotos = fotosDeAtributos(
      dePadres.get(padre.toUpperCase()) as Record<string, Locator[] | undefined> | undefined,
      cliente.cuenta.marketplaceId,
    );
    if (fotos.length) salida.set(sku, fotos);
  }
  return salida;
}

/**
 * La ficha capturada (fotos, puntos clave, descripción, título) de varios
 * SKUs: mapa sku (mayúsculas) → ficha. Una variante sin fotos propias
 * hereda las de su SKU padre; el texto sigue siendo el suyo.
 */
export async function fichasCapturadasPorSku(
  cliente: Cliente,
  sellingPartnerId: string,
  skus: string[],
): Promise<Map<string, FichaCapturada>> {
  const atributos = await atributosPorSku(cliente, sellingPartnerId, skus);
  const salida = new Map<string, FichaCapturada>();
  for (const [sku, attrs] of atributos) {
    salida.set(sku, fichaDeAtributos(attrs, cliente.cuenta.marketplaceId));
  }
  const heredadas = await fotosDeLosPadres(
    cliente,
    sellingPartnerId,
    atributos,
    (sku) => !salida.get(sku)?.fotos.length,
  );
  for (const [sku, fotos] of heredadas) {
    const ficha = salida.get(sku);
    if (ficha) ficha.fotos = fotos;
  }
  return salida;
}

/**
 * Las fotos capturadas de varios SKUs: mapa sku → URLs. Un SKU que Amazon no
 * contesta (o sin fotos capturadas ni en él ni en su SKU padre) no aparece
 * en el mapa.
 */
export async function fotosCapturadasPorSku(
  cliente: Cliente,
  sellingPartnerId: string,
  skus: string[],
): Promise<Map<string, string[]>> {
  const atributos = await atributosPorSku(cliente, sellingPartnerId, skus);
  const salida = new Map<string, string[]>();
  for (const [sku, attrs] of atributos) {
    const fotos = fotosDeAtributos(
      attrs as Record<string, Locator[] | undefined>,
      cliente.cuenta.marketplaceId,
    );
    if (fotos.length) salida.set(sku, fotos);
  }
  const heredadas = await fotosDeLosPadres(
    cliente,
    sellingPartnerId,
    atributos,
    (sku) => !salida.has(sku),
  );
  for (const [sku, fotos] of heredadas) salida.set(sku, fotos);

  return salida;
}
