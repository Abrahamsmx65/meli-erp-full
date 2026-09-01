/**
 * Catálogo de Amazon (Catalog Items 2022-04-01).
 *
 * De aquí salen dos cosas que ningún reporte entrega: TODAS las fotos de una
 * publicación (el reporte de listados solo trae la principal) y el ASIN PADRE
 * de cada hijo, que es lo que permite hablar de productos en vez de tallas
 * sueltas. Se consulta por ASIN, hasta 20 por llamada, pidiendo solo el pedazo
 * que se va a usar.
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

export interface PadreCatalogo {
  parentAsin: string | null;
  titulo: string | null;
}

/** Tope duro de Amazon: 20 identificadores por llamada. */
const POR_LLAMADA = 20;

/** Las muestritas de color son de 40 px: no sirven para trabajar contenido. */
const MUESTRA = "SWCH";

interface ItemCatalogo {
  asin?: string;
  images?: {
    marketplaceId?: string;
    images?: { variant?: string; link?: string; height?: number; width?: number }[];
  }[];
  relationships?: {
    marketplaceId?: string;
    relationships?: { type?: string; parentAsins?: string[] }[];
  }[];
  summaries?: { marketplaceId?: string; itemName?: string }[];
}

/**
 * Recorre los ASINs de 20 en 20 y entrega los items que Amazon devuelva.
 *
 * Un lote que Amazon rechaza (un ASIN que ya no reconoce) se salta: no puede
 * costar el resto. Un `null` es que se acabó el plazo de la función, y ahí sí
 * se corta y se entrega lo ya juntado.
 */
async function porLotes(
  cliente: Cliente,
  asins: string[],
  includedData: string,
): Promise<ItemCatalogo[]> {
  const salida: ItemCatalogo[] = [];
  const limpios = [...new Set(asins.filter(Boolean))];

  for (let i = 0; i < limpios.length; i += POR_LLAMADA) {
    const lote = limpios.slice(i, i + POR_LLAMADA);

    let r: { items?: ItemCatalogo[] } | null;
    try {
      r = await cliente.llamar<{ items?: ItemCatalogo[] }>(
        "GET",
        "/catalog/2022-04-01/items",
        "searchCatalogItems",
        {
          params: {
            identifiers: lote.join(","),
            identifiersType: "ASIN",
            marketplaceIds: cliente.cuenta.marketplaceId,
            includedData,
          },
        },
      );
    } catch (err) {
      if (err instanceof ErrorAmazon && err.status < 500) continue;
      throw err;
    }
    if (r === null) break;

    salida.push(...(r.items ?? []));
  }

  return salida;
}

/** El bloque del marketplace de la cuenta; si no viene, el primero. */
function delMarketplace<T extends { marketplaceId?: string }>(
  bloques: T[] | undefined,
  marketplaceId: string,
): T | undefined {
  return (bloques ?? []).find((b) => b.marketplaceId === marketplaceId) ?? (bloques ?? [])[0];
}

/**
 * Las imágenes de varios ASINs, una por variante: la de mayor resolución.
 *
 * Los ASINs que Amazon no conteste simplemente no aparecen en el mapa y quien
 * llama usa el respaldo.
 */
export async function imagenesDeAsins(
  cliente: Cliente,
  asins: string[],
  opciones: { incluirMuestras?: boolean } = {},
): Promise<Map<string, ImagenCatalogo[]>> {
  const salida = new Map<string, ImagenCatalogo[]>();

  for (const item of await porLotes(cliente, asins, "images")) {
    const asin = item.asin;
    if (!asin) continue;

    const bloque = delMarketplace(item.images, cliente.cuenta.marketplaceId);

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

  return salida;
}

/**
 * El ASIN PADRE de cada hijo, con el título del padre.
 *
 * Dos pasadas: la primera pregunta por los hijos (`relationships`) y la
 * segunda por los padres distintos que salieron, solo para su nombre — el
 * título del hijo trae el color y la talla pegados y no sirve para encabezar
 * un producto.
 *
 * Un hijo que Amazon devuelva sin padre entra igual al mapa con
 * `parentAsin: null`: así queda anotado que ya se preguntó y no se vuelve a
 * gastar cuota en él en cada corrida.
 */
export async function resolverPadres(
  cliente: Cliente,
  asins: string[],
): Promise<Map<string, PadreCatalogo>> {
  const salida = new Map<string, PadreCatalogo>();

  for (const item of await porLotes(cliente, asins, "relationships")) {
    const asin = item.asin;
    if (!asin) continue;
    const bloque = delMarketplace(item.relationships, cliente.cuenta.marketplaceId);
    const padre =
      (bloque?.relationships ?? [])
        .filter((r) => (r.type ?? "").toUpperCase() === "VARIATION")
        .flatMap((r) => r.parentAsins ?? [])
        .find(Boolean) ?? null;
    salida.set(asin, { parentAsin: padre, titulo: null });
  }

  const padres = [...new Set([...salida.values()].map((p) => p.parentAsin).filter(Boolean))] as string[];
  if (!padres.length) return salida;

  const titulos = new Map<string, string>();
  for (const item of await porLotes(cliente, padres, "summaries")) {
    const nombre = delMarketplace(item.summaries, cliente.cuenta.marketplaceId)?.itemName;
    if (item.asin && nombre) titulos.set(item.asin, nombre);
  }

  for (const [asin, p] of salida) {
    if (p.parentAsin) salida.set(asin, { ...p, titulo: titulos.get(p.parentAsin) ?? null });
  }

  return salida;
}
