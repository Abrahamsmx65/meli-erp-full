/**
 * Fotos de producto masticadas (`app_cache` clave `fotos-producto`) para
 * enseñarlas junto a cada SKU en Contenedores y Catálogo y costos (pedido del
 * dueño, 11-oct-2026). Motor puro en `fotos/producto.ts`.
 *
 *  · Por color: la primera foto que el catálogo de Amazon contestó para el
 *    ASIN de esa talla (`catalogo-amazon:asins`, lo que ya lee el catálogo
 *    de creadores) y, si ese ASIN no se ha leído, la imagen de su padre
 *    (`amazon_padres`). Las publicaciones activas primero.
 *  · Respaldo del modelo: la primera foto del producto de TikTok
 *    (`tienda_productos`).
 *  · Se rearma al final de cada lectura del catálogo de Amazon (cron de la
 *    tienda) y la pantalla lo sirve aunque esté viejo (`servirConCacheApp`);
 *    solo sin renglón se calcula en el clic (~3 lecturas).
 */
import { traerTodo } from "../datos/repos";
import { clienteAdmin } from "../supabase/admin";
import { partirSkuAmazon, esModeloDeCalzado } from "../tiktok/publicar";
import { armarMapaFotos, type FotoDeColor, type MapaFotos } from "../fotos/producto";
import { guardarCacheApp, leerCacheAppGuardado, servirConCacheApp } from "./cache-app";

export const CLAVE_FOTOS_PRODUCTO = "fotos-producto";
const CLAVE_FICHAS = "catalogo-amazon:asins";
const EDAD_MAX_MS = 6 * 3_600_000;

const MAPA_VACIO: MapaFotos = { modelos: {}, colores: {} };

export async function calcularFotosProducto(admin: any, accountId: string): Promise<MapaFotos> {
  const [listings, padres, fichas, tienda] = await Promise.all([
    traerTodo<any>(admin, "amazon_listings", "seller_sku, asin, estado", (q) => q.order("seller_sku", { ascending: true })),
    traerTodo<any>(admin, "amazon_padres", "asin, imagen_url", (q) => q.not("imagen_url", "is", null).order("asin", { ascending: true })).catch(
      () => [] as any[],
    ),
    leerCacheAppGuardado<{ asins?: Record<string, { f?: string[] }> }>(admin, accountId, CLAVE_FICHAS).catch(() => null),
    traerTodo<any>(admin, "tienda_productos", "modelo, imagenes, activo", (q) =>
      q.eq("account_id", accountId).order("modelo", { ascending: true }),
    ).catch(() => [] as any[]),
  ]);
  const asins = fichas && fichas.estado === "encontrado" ? (fichas.valor.datos?.asins ?? {}) : {};
  const padrePorAsin = new Map<string, string>();
  for (const p of padres ?? []) if (p.asin && p.imagen_url) padrePorAsin.set(String(p.asin), String(p.imagen_url));

  const colores: FotoDeColor[] = [];
  for (const l of listings ?? []) {
    const p = partirSkuAmazon(String(l.seller_sku ?? ""));
    if (!p || !esModeloDeCalzado(p.modelo)) continue;
    const asin = l.asin ? String(l.asin) : null;
    const url = (asin ? asins[asin]?.f?.[0] : null) ?? (asin ? padrePorAsin.get(asin) : null);
    if (url) colores.push({ modelo: p.modelo, color: p.color, url, activo: String(l.estado ?? "").toLowerCase() === "active" });
  }
  const respaldo = [...(tienda ?? [])]
    .sort((a: any, b: any) => Number(Boolean(b.activo)) - Number(Boolean(a.activo)))
    .map((t: any) => ({
      modelo: String(t.modelo ?? ""),
      url: Array.isArray(t.imagenes) ? t.imagenes.find((u: unknown) => typeof u === "string" && u.startsWith("http")) : null,
    }));
  return armarMapaFotos(colores, respaldo);
}

/** Lo llama el fondo (lectura del catálogo de Amazon) para dejarlo listo. */
export async function refrescarFotosProducto(admin: any, accountId: string): Promise<void> {
  const t0 = Date.now();
  const mapa = await calcularFotosProducto(admin, accountId);
  await guardarCacheApp(admin, accountId, CLAVE_FOTOS_PRODUCTO, mapa, Date.now() - t0);
}

/** Para las pantallas: el renglón guardado; si falla, sin fotos (la pantalla no se cae por una foto). */
export async function leerFotosProducto(db: any, accountId: string): Promise<MapaFotos> {
  try {
    const r = await servirConCacheApp<MapaFotos>(db, accountId, CLAVE_FOTOS_PRODUCTO, EDAD_MAX_MS, () =>
      calcularFotosProducto(clienteAdmin(), accountId),
    );
    return r.datos ?? MAPA_VACIO;
  } catch {
    return MAPA_VACIO;
  }
}
