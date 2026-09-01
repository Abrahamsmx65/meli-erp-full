/**
 * Catálogo de Amazon (Catalog Items 2022-04-01): las imágenes de un producto.
 *
 * Es la única forma de conseguir TODAS las fotos de una publicación — el
 * reporte de listados solo trae la principal. Se consulta por ASIN, hasta 20
 * por llamada, y se pide únicamente `images` para no arrastrar media pantalla
 * de atributos que no se usan.
 */
import { ErrorAmazon, type Cliente } from "./spapi";

export interface ImagenCatalogo {
  asin: string;
  /** MAIN, PT01…PT08, SWCH… */
  variante: string;
  link: string;
  ancho: number;
  alto: number;
}

/** Tope duro de Amazon: 20 identificadores por llamada. */
const POR_LLAMADA = 20;

/** Las muestritas de color son de 40 px: no sirven para trabajar contenido. */
const MUESTRA = "SWCH";

interface RespuestaCatalogo {
  items?: {
    asin?: string;
    images?: {
      marketplaceId?: string;
      images?: { variant?: string; link?: string; height?: number; width?: number }[];
    }[];
  }[];
}

/**
 * Las imágenes de varios ASINs, una por variante: la de mayor resolución.
 *
 * Si Amazon no contesta (se acabó el plazo, o rechaza el lote), esos ASINs
 * simplemente no aparecen en el mapa y quien llama usa el respaldo: un lote
 * malo no puede tumbar la descarga entera.
 */
export async function imagenesDeAsins(
  cliente: Cliente,
  asins: string[],
  opciones: { incluirMuestras?: boolean } = {},
): Promise<Map<string, ImagenCatalogo[]>> {
  const salida = new Map<string, ImagenCatalogo[]>();
  const limpios = [...new Set(asins.filter(Boolean))];

  for (let i = 0; i < limpios.length; i += POR_LLAMADA) {
    const lote = limpios.slice(i, i + POR_LLAMADA);

    let r: RespuestaCatalogo | null;
    try {
      r = await cliente.llamar<RespuestaCatalogo>("GET", "/catalog/2022-04-01/items", "searchCatalogItems", {
        params: {
          identifiers: lote.join(","),
          identifiersType: "ASIN",
          marketplaceIds: cliente.cuenta.marketplaceId,
          includedData: "images",
        },
      });
    } catch (err) {
      // Un 400 por un ASIN que Amazon ya no reconoce no puede costar el resto.
      if (err instanceof ErrorAmazon && err.status < 500) continue;
      throw err;
    }
    // null: se acabó el plazo de la función. Se entrega lo ya juntado.
    if (r === null) break;

    for (const item of r.items ?? []) {
      const asin = item.asin;
      if (!asin) continue;

      const bloques = item.images ?? [];
      const bloque =
        bloques.find((b) => b.marketplaceId === cliente.cuenta.marketplaceId) ?? bloques[0];

      // De cada variante, la más grande.
      const mejores = new Map<string, ImagenCatalogo>();
      for (const img of bloque?.images ?? []) {
        const variante = (img.variant ?? "").toUpperCase();
        if (!img.link || !variante) continue;
        if (variante === MUESTRA && !opciones.incluirMuestras) continue;
        const cand: ImagenCatalogo = {
          asin,
          variante,
          link: img.link,
          ancho: img.width ?? 0,
          alto: img.height ?? 0,
        };
        const previa = mejores.get(variante);
        if (!previa || cand.ancho * cand.alto > previa.ancho * previa.alto) {
          mejores.set(variante, cand);
        }
      }

      // MAIN primero; lo demás en su orden natural (PT01, PT02…).
      const lista = [...mejores.values()].sort((a, b) => {
        if (a.variante === "MAIN") return -1;
        if (b.variante === "MAIN") return 1;
        return a.variante.localeCompare(b.variante);
      });
      if (lista.length) salida.set(asin, lista);
    }
  }

  return salida;
}
