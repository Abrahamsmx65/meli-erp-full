/**
 * Recupera el FNSKU de los SKUs que el reporte de inventario NO alcanza.
 *
 * El FNSKU (el código con el que Amazon identifica el producto dentro de sus
 * bodegas, y el que va impreso en la etiqueta) llegaba de un solo lado: el
 * reporte `GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA`. Ese reporte, por
 * definición, solo trae los listings FBA VIVOS. Un SKU con el listing
 * Inactive o Incomplete — agotado en FBA, pausado, o todavía sin su primer
 * envío — no sale ahí, y su FNSKU no existía en ninguna tabla: su etiqueta de
 * Amazon no se podía armar aunque el producto estuviera perfectamente dado de
 * alta. Es justo lo que pasa con la mayor parte del catálogo de fundas.
 *
 * El API de inventario FBA sí lo contesta, filtrando por SKU y sin importar
 * si el listing está vivo. Se pregunta de 50 en 50 y lo que Amazon conteste
 * se guarda en `amazon_skus.fnsku`. Nada se deduce: si Amazon no contesta un
 * FNSKU, el SKU se queda sin él y así se dice en pantalla.
 */
import type { Cliente } from "./spapi";

/** Cuántos SKUs acepta el filtro `sellerSkus` de una llamada. Tope de Amazon. */
export const POR_LLAMADA = 50;

/**
 * Cuánto se espera antes de volver a preguntar por un SKU que Amazon no
 * contestó. Un SKU sin FNSKU casi siempre es uno que nunca entró a FBA, y
 * preguntar por él en cada corrida quemaría la cuota para siempre; pero uno
 * que se dé de alta después sí tiene que aparecer, así que tampoco es "nunca".
 */
export const DIAS_REPREGUNTA = 30;

interface ResumenSpApi {
  sellerSku?: string;
  fnSku?: string;
}

/**
 * Pregunta por el FNSKU de hasta 50 SKUs.
 *
 * Devuelve null si se acabó el plazo de la función (el cliente ya lo maneja
 * así en el resto del conector) para poder guardar lo que ya se consiguió.
 */
export async function resumenesFba(
  cliente: Cliente,
  skus: string[],
): Promise<Map<string, string> | null> {
  // Una coma partiría el filtro en dos SKUs falsos. No hay forma de escapar
  // la separación en este API, así que ese SKU simplemente no se pregunta.
  const limpios = skus.map((s) => s.trim()).filter((s) => s && !s.includes(","));
  if (!limpios.length) return new Map();

  const r = await cliente.llamar<{ payload?: { inventorySummaries?: ResumenSpApi[] } }>(
    "GET",
    "/fba/inventory/v1/summaries",
    "getInventorySummaries",
    {
      params: {
        granularityType: "Marketplace",
        granularityId: cliente.cuenta.marketplaceId,
        marketplaceIds: cliente.cuenta.marketplaceId,
        sellerSkus: limpios.slice(0, POR_LLAMADA).join(","),
      },
    },
  );
  if (!r) return null;

  const mapa = new Map<string, string>();
  for (const s of r.payload?.inventorySummaries ?? []) {
    if (s.sellerSku && s.fnSku) mapa.set(s.sellerSku, s.fnSku);
  }
  return mapa;
}

export interface ResultadoFnskus {
  estado: "cargado" | "sin_pendientes" | "sin_plazo";
  /** Cuántos SKUs se le preguntaron a Amazon. */
  preguntados: number;
  /** Cuántos contestaron con FNSKU. */
  resueltos: number;
}

/**
 * Completa el FNSKU faltante en `amazon_skus`.
 *
 * Con `skus` explícitos pregunta por esos (es lo que hace la pantalla de
 * etiquetas con lo que trae en la lista); sin ellos toma del catálogo los que
 * llevan más tiempo sin preguntarse, hasta `limite`.
 */
export async function completarFnskus(
  admin: any,
  cliente: Cliente,
  opciones: { skus?: string[]; limite?: number } = {},
): Promise<ResultadoFnskus> {
  const accountId = cliente.cuenta.accountId;
  const limite = Math.max(1, opciones.limite ?? 400);

  const faltantes = opciones.skus?.length
    ? await sinFnsku(admin, accountId, opciones.skus)
    : await pendientesDelCatalogo(admin, accountId, limite);

  if (!faltantes.length) return { estado: "sin_pendientes", preguntados: 0, resueltos: 0 };

  const ahora = new Date().toISOString();
  let preguntados = 0;
  let resueltos = 0;

  for (let i = 0; i < faltantes.length; i += POR_LLAMADA) {
    const tanda = faltantes.slice(i, i + POR_LLAMADA);
    const encontrados = await resumenesFba(cliente, tanda);
    // Se acabó el plazo: lo ya guardado queda, el resto sigue pendiente.
    if (!encontrados) return { estado: "sin_plazo", preguntados, resueltos };

    preguntados += tanda.length;

    // La fecha se anota en TODOS los preguntados, con FNSKU o sin él: es lo
    // que evita volver a gastar cuota en los que de plano no lo tienen. Va en
    // un solo viaje; solo los que sí trajeron FNSKU se escriben uno por uno,
    // porque cada uno lleva un valor distinto.
    await admin
      .from("amazon_skus")
      .update({ fnsku_consultado_en: ahora })
      .eq("account_id", accountId)
      .in("seller_sku", tanda);

    const conFnsku = tanda.filter((sku) => encontrados.get(sku));
    resueltos += conFnsku.length;
    await Promise.all(
      conFnsku.map((sku) =>
        admin
          .from("amazon_skus")
          .update({ fnsku: encontrados.get(sku), fnsku_consultado_en: ahora })
          .eq("account_id", accountId)
          .eq("seller_sku", sku),
      ),
    );
  }

  return { estado: "cargado", preguntados, resueltos };
}

/**
 * De una lista dada, los que de verdad no tienen FNSKU en ningún lado: ni en
 * el catálogo ni en el inventario FBA. Los SKUs llegan como los escribió
 * quien pidió las etiquetas, así que se amarran sin distinguir mayúsculas.
 */
async function sinFnsku(admin: any, accountId: string, skus: string[]): Promise<string[]> {
  const pedidos = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  if (!pedidos.length) return [];

  const { data: filas } = await admin
    .from("amazon_skus")
    .select("seller_sku, fnsku")
    .eq("account_id", accountId)
    .in("seller_sku", pedidos);

  // El SKU del catálogo es el que Amazon reconoce (respeta mayúsculas y
  // minúsculas); el que se escribió en la pantalla puede venir en otra caja.
  const porClave = new Map<string, { seller_sku: string; fnsku: string | null }>();
  for (const f of (filas ?? []) as { seller_sku: string; fnsku: string | null }[]) {
    porClave.set(f.seller_sku.toUpperCase(), f);
  }

  const candidatos = pedidos
    .map((s) => porClave.get(s.toUpperCase()))
    .filter((f): f is { seller_sku: string; fnsku: string | null } => Boolean(f) && !f!.fnsku)
    .map((f) => f.seller_sku);

  return quitarLosQueYaEstanEnInventario(admin, accountId, candidatos);
}

/**
 * Los pendientes del catálogo: sin FNSKU y sin preguntar (o preguntados hace
 * mucho). Se excluye lo que Amazon llama DEFAULT — esos son los que se
 * despachan desde la bodega propia y no tienen FNSKU que buscar.
 */
async function pendientesDelCatalogo(
  admin: any,
  accountId: string,
  limite: number,
): Promise<string[]> {
  const corte = new Date(Date.now() - DIAS_REPREGUNTA * 86_400_000).toISOString();

  const { data } = await admin
    .from("amazon_skus")
    .select("seller_sku")
    .eq("account_id", accountId)
    .is("fnsku", null)
    .neq("canal", "DEFAULT")
    .or(`fnsku_consultado_en.is.null,fnsku_consultado_en.lt.${corte}`)
    .order("fnsku_consultado_en", { ascending: true, nullsFirst: true })
    .limit(limite);

  return quitarLosQueYaEstanEnInventario(
    admin,
    accountId,
    ((data ?? []) as { seller_sku: string }[]).map((f) => f.seller_sku),
  );
}

/**
 * El FNSKU de los SKUs con stock en FBA ya llegó por el reporte de
 * inventario. Preguntar de nuevo por ellos sería gastar cuota en un dato que
 * el sistema ya tiene.
 */
async function quitarLosQueYaEstanEnInventario(
  admin: any,
  accountId: string,
  skus: string[],
): Promise<string[]> {
  if (!skus.length) return [];

  const yaEstan = new Set<string>();
  for (let i = 0; i < skus.length; i += 200) {
    const { data } = await admin
      .from("amazon_inventario")
      .select("seller_sku, fnsku")
      .eq("account_id", accountId)
      .in("seller_sku", skus.slice(i, i + 200));
    for (const f of (data ?? []) as { seller_sku: string; fnsku: string | null }[]) {
      if (f.fnsku) yaEstan.add(f.seller_sku);
    }
  }

  return skus.filter((s) => !yaEstan.has(s));
}
