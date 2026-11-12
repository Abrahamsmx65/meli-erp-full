/**
 * SONDA de solo lectura: guarda en `amazon_sync_log` (tarea
 * `sonda-publicacion`) cómo está dada de alta una publicación REAL de
 * calzado en Amazon —hijo, su padre y lo que exige su tipo de producto—
 * para calcar el formato al crear productos nuevos desde el ERP (dueño,
 * 12-nov-2026: «revisa lo de Amazon para que podamos crear también en
 * Amazon»). El API de Amazon solo contesta desde producción, así que la
 * sonda corre una vez en el cron de pantallas y se lee desde la base.
 * No escribe nada en Amazon. Se quita cuando la sección esté hecha.
 */
import type { Cliente } from "@/lib/amazon/spapi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const DATOS = "summaries,attributes,relationships,issues,offers,fulfillmentAvailability,productTypes";
/** Lo que más importa del esquema: se guarda su definición completa. */
const CLAVES_DE_VARIANTE = [
  "footwear_size",
  "color",
  "size",
  "variation_theme",
  "parentage_level",
  "child_parent_sku_relationship",
  "externally_assigned_product_identifier",
  "supplier_declared_has_product_identifier_exemption",
  "merchant_suggested_asin",
  "fulfillment_availability",
  "purchasable_offer",
  "main_product_image_locator",
  "item_name",
];

async function leerItem(cliente: Cliente, vendedor: string, sku: string): Promise<Json> {
  try {
    return await cliente.llamar("GET", `/listings/2021-08-01/items/${encodeURIComponent(vendedor)}/${encodeURIComponent(sku)}`, "getListingsItem", {
      params: { marketplaceIds: cliente.cuenta.marketplaceId, includedData: DATOS, issueLocale: "es_MX" },
    });
  } catch (err) {
    return { error: (err as Error).message.slice(0, 600) };
  }
}

function padresDe(item: Json): string[] {
  const salida = new Set<string>();
  for (const r of item?.relationships ?? []) {
    for (const x of r?.relationships ?? []) {
      for (const p of x?.parentSkus ?? []) salida.add(String(p));
    }
  }
  return [...salida];
}

async function requisitos(cliente: Cliente, tipo: string): Promise<Json> {
  try {
    const def = await cliente.llamar<Json>("GET", `/definitions/2020-09-01/productTypes/${encodeURIComponent(tipo)}`, "getDefinitionsProductType", {
      params: { marketplaceIds: cliente.cuenta.marketplaceId, requirements: "LISTING", requirementsEnforced: "ENFORCED", locale: "es_MX" },
    });
    const enlace = def?.schema?.link?.resource as string | undefined;
    if (!enlace) return { sinEsquema: true, def };
    const r = await fetch(enlace);
    const esquema = (await r.json()) as Json;
    const propiedades = esquema?.properties ?? {};
    return {
      tipo,
      requeridos: esquema?.required ?? [],
      // Las condiciones (allOf/if/then) dicen qué se exige al hijo y al padre.
      condiciones: JSON.stringify(esquema?.allOf ?? []).slice(0, 12_000),
      todas: Object.keys(propiedades),
      variante: Object.fromEntries(CLAVES_DE_VARIANTE.filter((k) => propiedades[k]).map((k) => [k, JSON.stringify(propiedades[k]).slice(0, 6_000)])),
    };
  } catch (err) {
    return { tipo, error: (err as Error).message.slice(0, 600) };
  }
}

export async function sondaPublicacionAmazon(admin: DB, cliente: Cliente): Promise<object> {
  const cuentaId = cliente.cuenta.accountId;
  const vendedor = cliente.cuenta.sellingPartnerId;
  if (!vendedor) return { error: "sin selling_partner_id" };

  // El modelo más nuevo, una sandalia y una bota: tres tipos de producto.
  const { data: nuevos } = await admin
    .from("amazon_listings")
    .select("seller_sku")
    .eq("account_id", cuentaId)
    .like("seller_sku", "GT33%-MX")
    .order("seller_sku", { ascending: false })
    .limit(1);
  const skus = [...new Set([nuevos?.[0]?.seller_sku, "GT330-BLK-23-MX", "GT312-BROWN-29-MX", "GT303-BLK-23-MX"].filter(Boolean))] as string[];

  const hijos: Record<string, Json> = {};
  const padres: Record<string, Json> = {};
  const tipos = new Set<string>();
  for (const sku of skus) {
    const item = await leerItem(cliente, vendedor, sku);
    hijos[sku] = item;
    for (const s of item?.summaries ?? []) if (s?.productType) tipos.add(String(s.productType));
    for (const p of padresDe(item).slice(0, 1)) {
      if (!padres[p]) padres[p] = await leerItem(cliente, vendedor, p);
    }
  }
  const definiciones: Record<string, Json> = {};
  for (const t of [...tipos].slice(0, 4)) definiciones[t] = await requisitos(cliente, t);

  return { skus, hijos, padres, definiciones };
}
