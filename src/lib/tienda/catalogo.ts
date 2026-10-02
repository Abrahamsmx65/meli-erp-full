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
import { precioDeSku } from "../tiktok/api";
import { claveAplastada, claveComparacion } from "../importar/sku";

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
    const precio = precioDeSku(s.price);
    const lista = numero(s.list_price?.amount ?? s.price?.original_price ?? s.price?.amount);
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

// ---------------------------------------------------------------------------
// Las fotos de Amazon (decisión del dueño, 1-oct-2026: «principalmente las
// mismas imágenes»). Cada color de TikTok se empareja con SUS publicaciones
// de Amazon por el SKU del kardex, con los amarres del ERP: canónico →
// pedazos ordenados (Amazon a veces pone la talla antes del color,
// GT128-23-BLK-MX) → aplastado.
// ---------------------------------------------------------------------------

const ordenada = (s: string) => claveComparacion(s).split("-").sort().join("-");

/**
 * Cuántas publicaciones de Amazon se prueban por color. Las ACTIVAS primero:
 * una talla inactiva a veces trae en el catálogo las fotos de OTRO color
 * (GT135, 2-oct-2026: café oscuro, café tostado y olivo salían con las del
 * beige), así que hace falta más de una para escoger.
 */
export const CANDIDATOS_POR_COLOR = 4;

/**
 * Por producto y color de TikTok, los SKUs de Amazon de ese mismo color
 * (cualquier talla sirve: las fotos son del color). Devuelve
 * productId → color → [sku de Amazon, …].
 */
export function emparejarAmazon(
  variantes: { productId: string; color: string | null; skuInterno: string | null }[],
  skusAmazon: string[],
  activos: Set<string> = new Set(),
): Map<string, Map<string, string[]>> {
  const porCanonica = new Map<string, string>();
  const porOrdenada = new Map<string, string>();
  const porAplastada = new Map<string, string>();
  for (const a of skusAmazon) {
    if (!a) continue;
    if (!porCanonica.has(claveComparacion(a))) porCanonica.set(claveComparacion(a), a);
    if (!porOrdenada.has(ordenada(a))) porOrdenada.set(ordenada(a), a);
    if (!porAplastada.has(claveAplastada(a))) porAplastada.set(claveAplastada(a), a);
  }
  const salida = new Map<string, Map<string, string[]>>();
  for (const v of variantes) {
    if (!v.skuInterno) continue;
    const color = (v.color ?? "").trim() || "Único";
    const sku =
      porCanonica.get(claveComparacion(v.skuInterno)) ??
      porOrdenada.get(ordenada(v.skuInterno)) ??
      porAplastada.get(claveAplastada(v.skuInterno));
    if (!sku) continue;
    const colores = salida.get(v.productId) ?? new Map<string, string[]>();
    const lista = colores.get(color) ?? [];
    if (!lista.includes(sku)) lista.push(sku);
    colores.set(color, lista);
    salida.set(v.productId, colores);
  }
  // Las activas primero (orden estable dentro de cada grupo) y solo las primeras.
  for (const colores of salida.values()) {
    for (const [color, lista] of colores) {
      const orden = lista
        .map((sku, i) => ({ sku, i, activo: activos.has(sku.toUpperCase()) }))
        .sort((a, b) => Number(b.activo) - Number(a.activo) || a.i - b.i)
        .map((x) => x.sku);
      colores.set(color, orden.slice(0, CANDIDATOS_POR_COLOR));
    }
  }
  return salida;
}

/**
 * Las fotos de cada color de un producto, escogidas entre los candidatos de
 * ese color (en su orden de preferencia). Una foto principal que aparece
 * entre los candidatos de DOS o más colores es de otro color mal cargado en
 * Amazon: se evita mientras el color tenga otro candidato con foto propia.
 * Sin ninguno propio, se queda el primero (mejor una foto que ninguna).
 */
export function elegirFotosPorColor(candidatos: Map<string, string[][]>): Record<string, string[]> {
  const coloresDe = new Map<string, Set<string>>();
  for (const [color, opciones] of candidatos) {
    for (const fotos of opciones) {
      if (!fotos.length) continue;
      const c = coloresDe.get(fotos[0]) ?? new Set<string>();
      c.add(color);
      coloresDe.set(fotos[0], c);
    }
  }
  const salida: Record<string, string[]> = {};
  for (const [color, opciones] of candidatos) {
    const conFotos = opciones.filter((f) => f.length);
    const propia = conFotos.find((f) => (coloresDe.get(f[0])?.size ?? 0) <= 1);
    const elegida = propia ?? conFotos[0];
    if (elegida) salida[color] = elegida;
  }
  return salida;
}
