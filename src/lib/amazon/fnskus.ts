/**
 * El FNSKU de cada publicación de Amazon, preguntado al API de publicaciones.
 *
 * El FNSKU es el código de barras de la etiqueta de FBA. Hasta ahora solo se
 * sacaba del reporte de inventario FBA (`amazon_inventario`), que trae nada
 * más lo que Amazon tiene o tuvo hace poco en sus bodegas. Una publicación
 * de FBA sin inventario —agotada y ya "Inactive", o nueva sin su primer
 * envío— se cae de ese reporte aunque en Seller Central siga con su FNSKU,
 * y entonces /etiquetas decía que el producto no estaba en Amazon
 * (MY2304-PURPLE-23-MX, que no existe en MELI y sí en Amazon).
 *
 * Listings Items (`searchListingsItems`, `includedData=summaries`) lo
 * devuelve haya o no inventario. Se pregunta de 20 en 20 SKUs, solo por lo
 * que falta, y se guarda en `amazon_listings.fnsku`. Necesita el Seller ID
 * de la cuenta (`amazon_accounts.selling_partner_id`), que no sale de
 * ningún reporte: se captura una vez.
 */
import { Cliente, ErrorAmazon } from "./spapi";

/** SKUs por llamada: el tope del API. */
const POR_LLAMADA = 20;

/**
 * SKUs por corrida. La cuota es de 5 llamadas por segundo: 600 son 30
 * llamadas, unos 6-8 s del presupuesto de 45 que tiene el latido completo.
 */
const POR_CORRIDA = 600;

/** Cada cuánto se vuelve a preguntar por lo que Amazon contestó sin FNSKU. */
const REINTENTO_MS = 7 * 24 * 3_600_000;

export interface ResultadoFnskus {
  estado: "al_dia" | "consultados" | "sin_seller_id" | "sin_tabla";
  consultados?: number;
  encontrados?: number;
}

interface ItemListado {
  sku?: string;
  summaries?: { marketplaceId?: string; fnSku?: string; itemName?: string }[];
}

/**
 * Del cuerpo de `searchListingsItems`, el FNSKU de cada SKU que Amazon
 * devolvió (null cuando la publicación no tiene: envío propio). Un SKU que
 * no viene en la respuesta no aparece en el mapa.
 */
export function fnskusDeRespuesta(
  cuerpo: { items?: ItemListado[] } | null,
  marketplaceId: string,
): Map<string, string | null> {
  const salida = new Map<string, string | null>();
  for (const item of cuerpo?.items ?? []) {
    const sku = String(item.sku ?? "").trim();
    if (!sku) continue;
    const bloques = item.summaries ?? [];
    const bloque = bloques.find((b) => b.marketplaceId === marketplaceId) ?? bloques[0];
    const fnsku = String(bloque?.fnSku ?? "").trim();
    salida.set(sku, fnsku || null);
  }
  return salida;
}

/**
 * Los SKUs que van en `identifiers`, separados por coma: uno que trae coma
 * no se puede pedir así y se deja fuera (se marca como consultado para no
 * volver a intentarlo cada hora).
 */
export function partirEnLotes(skus: string[]): { lotes: string[][]; imposibles: string[] } {
  const validos: string[] = [];
  const imposibles: string[] = [];
  for (const s of [...new Set(skus.map((x) => x.trim()).filter(Boolean))]) {
    (s.includes(",") ? imposibles : validos).push(s);
  }
  const lotes: string[][] = [];
  for (let i = 0; i < validos.length; i += POR_LLAMADA) {
    lotes.push(validos.slice(i, i + POR_LLAMADA));
  }
  return { lotes, imposibles };
}

export async function sincronizarFnskus(admin: any, cliente: Cliente): Promise<ResultadoFnskus> {
  const { accountId, marketplaceId, sellingPartnerId } = cliente.cuenta;
  if (!sellingPartnerId) return { estado: "sin_seller_id" };

  // Lo que nunca se ha preguntado va primero; lo que Amazon contestó sin
  // FNSKU se vuelve a preguntar pasada una semana (pudo entrar a FBA).
  const { data, error } = await admin
    .from("amazon_listings")
    .select("seller_sku")
    .eq("account_id", accountId)
    .is("fnsku", null)
    .or(
      `fnsku_consultado_en.is.null,fnsku_consultado_en.lt.${new Date(Date.now() - REINTENTO_MS).toISOString()}`,
    )
    .order("fnsku_consultado_en", { ascending: true, nullsFirst: true })
    .order("seller_sku", { ascending: true })
    .limit(POR_CORRIDA);
  // Sin las columnas (falta la migración 0047) no se pregunta nada.
  if (error) return { estado: "sin_tabla" };

  const pendientes = ((data ?? []) as { seller_sku: string }[]).map((f) => f.seller_sku);
  if (!pendientes.length) return { estado: "al_dia" };

  const { lotes, imposibles } = partirEnLotes(pendientes);
  const ahora = new Date().toISOString();
  const filas: { account_id: string; seller_sku: string; fnsku: string | null; fnsku_consultado_en: string }[] =
    imposibles.map((sku) => ({ account_id: accountId, seller_sku: sku, fnsku: null, fnsku_consultado_en: ahora }));

  let encontrados = 0;
  for (const lote of lotes) {
    let r: { items?: ItemListado[] } | null;
    try {
      r = await cliente.llamar<{ items?: ItemListado[] }>(
        "GET",
        `/listings/2021-08-01/items/${encodeURIComponent(sellingPartnerId)}`,
        "searchListingsItems",
        {
          params: {
            marketplaceIds: marketplaceId,
            identifiers: lote.join(","),
            identifiersType: "SKU",
            pageSize: POR_LLAMADA,
            includedData: "summaries",
          },
        },
      );
    } catch (err) {
      // Un lote que Amazon rechaza (un SKU raro) se da por consultado sin
      // FNSKU para que no bloquee a los demás; un 5xx sí es error real.
      if (err instanceof ErrorAmazon && err.status < 500) {
        for (const sku of lote) {
          filas.push({ account_id: accountId, seller_sku: sku, fnsku: null, fnsku_consultado_en: ahora });
        }
        continue;
      }
      throw err;
    }
    // Se acabó el plazo: se guarda lo conseguido y se sigue en la siguiente.
    if (r === null) break;

    const contestados = fnskusDeRespuesta(r, marketplaceId);
    for (const sku of lote) {
      // Amazon a veces devuelve el SKU con otras mayúsculas; se busca laxo.
      const fnsku =
        contestados.get(sku) ??
        [...contestados.entries()].find(([k]) => k.toUpperCase() === sku.toUpperCase())?.[1] ??
        null;
      if (fnsku) encontrados++;
      filas.push({ account_id: accountId, seller_sku: sku, fnsku, fnsku_consultado_en: ahora });
    }
  }

  if (filas.length) {
    // Solo estas dos columnas: el resto del renglón lo escribe el reporte
    // del catálogo y no se toca.
    const { error: e } = await admin
      .from("amazon_listings")
      .upsert(filas, { onConflict: "account_id,seller_sku" });
    if (e) throw new Error(`amazon_listings: ${e.message}`);
  }

  return { estado: "consultados", consultados: filas.length, encontrados };
}
