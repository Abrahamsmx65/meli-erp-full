/**
 * Catálogo de la tienda en línea de GETAC, copiado de TikTok Shop.
 *
 * Decisión del dueño (1-oct-2026): «de ahí tomamos listados, imágenes y
 * precios, todo igual». La tienda no tiene catálogo propio: cada producto
 * ACTIVO de TikTok se lee completo (`GET /product/202309/products/{id}`) y
 * aquí se traduce a lo que la página enseña. Motor puro: sin base ni red.
 *
 * Una variante solo se vende si TikTok la tiene amarrada a un SKU del
 * kardex (`tiktok_skus.sku_interno`): sin amarre no hay de dónde apartar,
 * y adivinarlo descontaría del par equivocado.
 */
import { partirSku } from "../tiktok/despacho";

export interface VarianteTienda {
  skuId: string;
  skuInterno: string | null;
  sellerSku: string | null;
  color: string | null;
  talla: string | null;
  precio: number | null;
  precioLista: number | null;
  imagen: string | null;
}

export interface ProductoTienda {
  productId: string;
  modelo: string | null;
  titulo: string;
  descripcion: string | null;
  imagenes: string[];
  estadoTikTok: string | null;
  variantes: VarianteTienda[];
}

/** El estado de TikTok de un producto que se puede comprar. */
export const ESTADO_ACTIVO = "ACTIVATE";

const NOMBRES_COLOR = /(color|colour)/i;
const NOMBRES_TALLA = /(talla|size|tama[ñn]o|n[uú]mero)/i;

function primeraUrl(img: any): string | null {
  const urls = img?.urls ?? img?.thumb_urls ?? [];
  const u = Array.isArray(urls) ? urls.find((x: unknown) => typeof x === "string" && x) : null;
  return u ? String(u) : null;
}

function numero(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Color y talla de una variante desde sus atributos de venta. Primero por
 * el NOMBRE del atributo (Color / Talla, en español o inglés); lo que no se
 * reconozca por nombre: un valor numérico es talla y lo demás color.
 */
export function colorYTalla(atributos: any[]): { color: string | null; talla: string | null; imagen: string | null } {
  let color: string | null = null;
  let talla: string | null = null;
  let imagen: string | null = null;
  const sueltos: any[] = [];
  for (const a of atributos ?? []) {
    const valor = a?.value_name != null ? String(a.value_name).trim() : "";
    if (!valor) continue;
    const nombre = String(a?.name ?? "");
    if (NOMBRES_COLOR.test(nombre) && color == null) {
      color = valor;
      imagen = imagen ?? primeraUrl(a?.sku_img);
    } else if (NOMBRES_TALLA.test(nombre) && talla == null) talla = valor;
    else sueltos.push(a);
  }
  for (const a of sueltos) {
    const valor = String(a.value_name).trim();
    if (talla == null && /^\d+([.,]\d+)?$/.test(valor)) talla = valor;
    else if (color == null) {
      color = valor;
      imagen = imagen ?? primeraUrl(a?.sku_img);
    }
  }
  if (!imagen) {
    for (const a of atributos ?? []) {
      const u = primeraUrl(a?.sku_img);
      if (u) {
        imagen = u;
        break;
      }
    }
  }
  return { color, talla, imagen };
}

/**
 * La descripción de TikTok viene en HTML. La tienda la enseña como texto
 * en párrafos: así no se cuela ningún script ni estilo ajeno a la página.
 */
export function descripcionEnTexto(html: string | null | undefined): string | null {
  if (!html) return null;
  const texto = String(html)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return texto || null;
}

/**
 * Traduce el producto de TikTok a la tienda. `amarres` es seller_sku →
 * sku_interno, de `tiktok_skus` (el amarre que ya usa el kardex), y
 * también sku_id → sku_interno por si TikTok no trae el seller_sku.
 */
export function interpretarProducto(
  p: any,
  amarres: { porSkuId: Map<string, string>; porSellerSku: Map<string, string> },
): ProductoTienda | null {
  if (!p?.id) return null;
  const productId = String(p.id);

  const imagenes: string[] = [];
  for (const img of p.main_images ?? []) {
    const u = primeraUrl(img);
    if (u && !imagenes.includes(u)) imagenes.push(u);
  }

  const variantes: VarianteTienda[] = [];
  for (const s of p.skus ?? []) {
    if (!s?.id) continue;
    const skuId = String(s.id);
    const sellerSku = s.seller_sku ? String(s.seller_sku).trim() : null;
    const skuInterno = amarres.porSkuId.get(skuId) ?? (sellerSku ? amarres.porSellerSku.get(sellerSku) : undefined) ?? null;
    const { color, talla, imagen } = colorYTalla(s.sales_attributes ?? []);
    const precio = numero(s.price?.sale_price ?? s.price?.tax_exclusive_price);
    const lista = numero(s.list_price?.amount ?? s.price?.original_price);
    variantes.push({
      skuId,
      skuInterno,
      sellerSku,
      color,
      talla,
      precio,
      precioLista: lista != null && precio != null && lista > precio ? lista : null,
      imagen,
    });
  }

  const modelo =
    variantes.map((v) => v.skuInterno ?? v.sellerSku).filter(Boolean).map((s) => partirSku(s as string).modelo).find(Boolean) ??
    null;

  return {
    productId,
    modelo: modelo ? modelo.toUpperCase() : null,
    titulo: String(p.title ?? "").trim() || productId,
    descripcion: descripcionEnTexto(p.description),
    imagenes,
    estadoTikTok: p.status ? String(p.status) : null,
    variantes,
  };
}

/** Un producto entra a la tienda si está activo en TikTok y tiene alguna variante vendible. */
export function seVende(p: ProductoTienda): boolean {
  if (p.estadoTikTok && p.estadoTikTok !== ESTADO_ACTIVO) return false;
  return p.variantes.some((v) => v.skuInterno && v.precio != null && v.precio > 0);
}

/** Orden natural de tallas: 22.5 antes de 23, 9 antes de 24; lo no numérico al final en orden alfabético. */
export function compararTallas(a: string | null, b: string | null): number {
  const x = Number(String(a ?? "").replace(",", "."));
  const y = Number(String(b ?? "").replace(",", "."));
  const nx = Number.isFinite(x) && a != null && a !== "";
  const ny = Number.isFinite(y) && b != null && b !== "";
  if (nx && ny) return x - y;
  if (nx) return -1;
  if (ny) return 1;
  return String(a ?? "").localeCompare(String(b ?? ""), "es");
}
