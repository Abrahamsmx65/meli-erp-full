import "server-only";
import { unstable_cache } from "next/cache";
import { config } from "./config";
import { db } from "./db";
import { armarProducto, type Producto, type ProductoVista, type Variante } from "./tienda";

async function leerCatalogo(): Promise<{ productos: Producto[]; variantes: (Variante & { product_id: string })[] }> {
  const cuenta = config.cuenta();
  const [{ data: productos, error: e1 }, { data: variantes, error: e2 }] = await Promise.all([
    db()
      .from("tienda_productos")
      .select("product_id, modelo, titulo, descripcion, imagenes, fotos_amazon, bullets, categoria")
      .eq("account_id", cuenta)
      .eq("activo", true)
      .order("modelo", { ascending: true })
      .order("product_id", { ascending: true }),
    db()
      .from("tienda_variantes")
      .select("sku_id, product_id, sku_interno, color, talla, precio, precio_lista, imagen")
      .eq("account_id", cuenta)
      .eq("activo", true)
      .order("sku_id", { ascending: true })
      .limit(5000),
  ]);
  if (e1 || e2) throw new Error(`Catálogo: ${(e1 ?? e2)!.message}`);
  return {
    productos: (productos ?? []).map((p: any) => ({
      ...p,
      imagenes: Array.isArray(p.imagenes) ? p.imagenes : [],
      fotos_amazon: p.fotos_amazon && typeof p.fotos_amazon === "object" ? p.fotos_amazon : {},
      bullets: Array.isArray(p.bullets) ? p.bullets : [],
    })),
    variantes: (variantes ?? []) as any,
  };
}

/** Fotos, títulos y precios cambian poco: un minuto de caché. La existencia NO se guarda aquí. */
const catalogoGuardado = unstable_cache(leerCatalogo, ["catalogo-tienda"], { revalidate: 60 });

/** Existencia viva por SKU del kardex (la misma regla con la que se publica a TikTok). */
export async function disponibles(skus?: string[]): Promise<Map<string, number>> {
  const { data, error } = await db().rpc("tienda_disponibles", {
    p_account: config.cuenta(),
    p_skus: skus && skus.length ? skus : null,
  });
  if (error) throw new Error(`Existencia: ${error.message}`);
  return new Map(((data ?? []) as { sku: string; disponible: number }[]).map((r) => [r.sku, Number(r.disponible)]));
}

export async function listarProductos(): Promise<ProductoVista[]> {
  const [{ productos, variantes }, existencia] = await Promise.all([catalogoGuardado(), disponibles()]);
  const porProducto = new Map<string, Variante[]>();
  for (const v of variantes) {
    const l = porProducto.get(v.product_id) ?? [];
    l.push(v);
    porProducto.set(v.product_id, l);
  }
  return productos
    .map((p) => armarProducto(p, porProducto.get(p.product_id) ?? [], existencia))
    .filter((p) => p.colores.length > 0)
    .sort((a, b) => Number(b.disponible > 0) - Number(a.disponible > 0));
}

export async function unProducto(productId: string): Promise<ProductoVista | null> {
  const { productos, variantes } = await catalogoGuardado();
  const p = productos.find((x) => x.product_id === productId);
  if (!p) return null;
  const suyas = variantes.filter((v) => v.product_id === productId);
  const existencia = await disponibles(suyas.map((v) => v.sku_interno).filter(Boolean) as string[]);
  const vista = armarProducto(p, suyas, existencia);
  return vista.colores.length ? vista : null;
}

export interface RenglonVivo {
  skuId: string;
  productId: string;
  titulo: string;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  precio: number;
  imagen: string | null;
  disponible: number;
}

/** Lo que el carrito necesita saber de cada variante, con existencia viva. */
export async function variantesVivas(skuIds: string[]): Promise<Map<string, RenglonVivo>> {
  const { productos, variantes } = await catalogoGuardado();
  const suyas = variantes.filter((v) => skuIds.includes(v.sku_id) && v.sku_interno && v.precio);
  const existencia = await disponibles(suyas.map((v) => v.sku_interno!) );
  const porId = new Map(productos.map((p) => [p.product_id, p]));
  const salida = new Map<string, RenglonVivo>();
  for (const v of suyas) {
    const p = porId.get(v.product_id);
    if (!p) continue;
    salida.set(v.sku_id, {
      skuId: v.sku_id,
      productId: v.product_id,
      titulo: p.titulo,
      modelo: p.modelo,
      color: v.color,
      talla: v.talla,
      precio: Number(v.precio),
      imagen: p.fotos_amazon?.[(v.color ?? "").trim() || "Único"]?.[0] ?? v.imagen ?? p.imagenes[0] ?? null,
      disponible: Math.max(0, existencia.get(v.sku_interno!) ?? 0),
    });
  }
  return salida;
}

interface PaginaAmazon {
  url: string;
  titulo: string | null;
  imagenes: { url: string; ancho: number | null }[];
}

/**
 * Banners copiados de la tienda de marca de GETAC en Amazon (el ERP los lee
 * una vez al día, `servicios/tienda-banners.ts`, y los deja en app_cache
 * clave `tienda:amazon-store`). Las imágenes anchas de la página principal
 * primero; luego las de cada sección.
 */
async function leerBannersAmazon(): Promise<string[]> {
  const { data } = await db()
    .from("app_cache")
    .select("datos")
    .eq("account_id", config.cuenta())
    .eq("clave", "tienda:amazon-store")
    .maybeSingle();
  const paginas = ((data as any)?.datos?.paginas ?? []) as PaginaAmazon[];
  const urls: string[] = [];
  for (const p of paginas) {
    for (const i of p.imagenes ?? []) {
      // Banner = ancho; las miniaturas de producto se quedan fuera.
      if (i.ancho != null && i.ancho < 1000) continue;
      if (!urls.includes(i.url)) urls.push(i.url);
    }
  }
  return urls.slice(0, 12);
}

export const bannersAmazon = unstable_cache(leerBannersAmazon, ["banners-amazon"], { revalidate: 600 });
