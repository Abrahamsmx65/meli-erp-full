/**
 * Las publicaciones de MELI que ofrece la pantalla de Videos (una por item,
 * con los SKUs de sus tallas para que la búsqueda también encuentre por
 * SKU), masticadas en `app_cache` (`videos:publicaciones`, 30 min). Antes
 * cada visita paginaba los ~10 mil SKUs activos bajo RLS; ahora se lee un
 * renglón y el refresco va por atrás (`servirConCacheApp`).
 */
import { traerTodo, type DB } from "../datos/repos";
import { servirConCacheApp } from "./cache-app";

const CLAVE_PUBLICACIONES_VIDEOS = "videos:publicaciones";
const EDAD_PUBLICACIONES_VIDEOS_MS = 30 * 60_000;

export interface PublicacionParaVideo {
  itemId: string;
  titulo: string;
  modelo: string;
  color: string;
  skus: string[];
}

interface FilaSku {
  sku: string | null;
  item_id: string;
  titulo: string | null;
  modelo: string | null;
  color: string | null;
}

/** Una entrada por publicación, en orden alfabético por título (puro). */
export function agruparPublicacionesParaVideos(filas: readonly FilaSku[]): PublicacionParaVideo[] {
  const porItem = new Map<string, PublicacionParaVideo>();
  for (const f of filas) {
    const id = f.item_id;
    let pub = porItem.get(id);
    if (!pub) {
      pub = { itemId: id, titulo: f.titulo || id, modelo: f.modelo ?? "", color: f.color ?? "", skus: [] };
      porItem.set(id, pub);
    }
    if (f.sku) pub.skus.push(f.sku);
  }
  // traerTodo pagina por id, así que el orden alfabético se pone aquí.
  return [...porItem.values()].sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
}

/** Lee con el cliente admin (solo la cuenta pedida): el miembro de TikTok también abre Videos. */
export async function publicacionesParaVideos(admin: DB, accountId: string): Promise<PublicacionParaVideo[]> {
  const r = await servirConCacheApp(admin, accountId, CLAVE_PUBLICACIONES_VIDEOS, EDAD_PUBLICACIONES_VIDEOS_MS, async () => {
    // Paginado con traerTodo: Supabase corta en 1000 filas por petición y un
    // .limit(5000) suelto dejaba fuera a la mayoría de los ~10 mil SKUs.
    const filas = await traerTodo<FilaSku>(admin, "skus", "sku, item_id, titulo, modelo, color", (q) =>
      q.eq("account_id", accountId).eq("activo", true).not("item_id", "is", null),
    );
    return agruparPublicacionesParaVideos(filas);
  });
  return r.datos;
}
