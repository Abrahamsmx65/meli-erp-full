/**
 * Vendedores EXTERNOS de la tienda de TikTok: lo que se lee y escribe en la
 * base. Las reglas viven en `tiktok/externos.ts`.
 *
 *   · `skusExternos` es lo que consultan todos los demás servicios para
 *     saber qué SKUs del kardex no son del dueño (Industher, estante,
 *     alarma, 3PL, cortes, ventas, compras, reabasto…).
 *   · `ligarPublicacion` amarra una publicación de TikTok a un vendedor: a
 *     sus SKUs sin amarre al ERP se les pone como nombre del kardex su
 *     propio `seller_sku` (el catálogo de TikTok es memoria para el
 *     amarre, así el nombre se queda).
 *   · `guardarStockExterno` es el conteo del vendedor: un `ajuste` por SKU
 *     con el número que él captura, y la publicación a TikTok pasando por
 *     `sincronizarTikTok` con `soloPedidos` (regla de oro).
 */
import { traerTodo, type DB } from "../datos/repos";
import { nombreDeVendedor, normalizarVendedor, type MapaExternos } from "../tiktok/externos";
import { registrarMovimientos, sincronizarTikTok, type MovimientoManual } from "./tiktok";

/** Caché corta en memoria: `skusExternos` se pregunta desde muchos lados en la misma corrida. */
const cache = new Map<string, { en: number; mapa: MapaExternos }>();
const VIDA_CACHE_MS = 20_000;

export function limpiarCacheExternos(accountId?: string): void {
  if (accountId) cache.delete(accountId);
  else cache.clear();
}

/** Las publicaciones ligadas: product_id → vendedor. */
export async function productosExternos(db: DB, accountId: string): Promise<Map<string, string>> {
  const filas = await traerTodo<{ product_id: string; vendedor: string }>(db, "tiktok_productos_externos", "product_id, vendedor", (q) =>
    q.eq("account_id", accountId),
  ).catch(() => []);
  return new Map((filas ?? []).map((f) => [String(f.product_id), String(f.vendedor)]));
}

/**
 * sku del ERP (nombre del kardex) → vendedor externo. Vacío si no hay nada
 * ligado, que es lo normal: entonces nadie cambia de comportamiento.
 */
export async function skusExternos(db: DB, accountId: string): Promise<MapaExternos> {
  const guardado = cache.get(accountId);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_MS) return guardado.mapa;
  const productos = await productosExternos(db, accountId);
  const mapa: MapaExternos = new Map();
  if (productos.size) {
    const skus = await traerTodo<{ product_id: string; sku_interno: string | null; seller_sku: string | null }>(
      db,
      "tiktok_skus",
      "product_id, sku_interno, seller_sku",
      (q) => q.eq("account_id", accountId).in("product_id", [...productos.keys()]),
    ).catch(() => []);
    for (const s of skus ?? []) {
      const vendedor = productos.get(String(s.product_id));
      if (!vendedor) continue;
      const sku = s.sku_interno ?? s.seller_sku;
      if (sku) mapa.set(String(sku), vendedor);
    }
  }
  cache.set(accountId, { en: Date.now(), mapa });
  return mapa;
}

/** Las publicaciones de la tienda tal como las conoce el ERP, para la pantalla de ligar. */
export async function publicacionesParaLigar(db: DB, accountId: string) {
  const [skus, ligadas] = await Promise.all([
    traerTodo<any>(db, "tiktok_skus", "product_id, seller_sku, titulo, estado", (q) => q.eq("account_id", accountId).eq("activo", true)),
    productosExternos(db, accountId),
  ]);
  return {
    skus: (skus ?? []).map((s: any) => ({
      productId: String(s.product_id ?? ""),
      sellerSku: s.seller_sku ?? null,
      titulo: s.titulo ?? null,
      estado: s.estado ?? null,
    })),
    ligadas,
  };
}

/**
 * Liga una publicación a un vendedor externo. Sus SKUs que el ERP no había
 * amarrado a nada (`sku_interno` null) toman su `seller_sku` como nombre del
 * kardex: así el pedido entra con SKU, el kardex lo descuenta y TikTok
 * recibe el disponible por el mismo camino que todo lo demás.
 */
export async function ligarPublicacion(
  admin: any,
  accountId: string,
  productId: string,
  vendedorCrudo: string,
  usuario: string | null,
): Promise<{ productId: string; vendedor: string; skus: number; bautizados: number }> {
  const vendedor = normalizarVendedor(vendedorCrudo);
  if (!vendedor) throw new Error("Vendedor desconocido.");
  const id = String(productId ?? "").trim();
  if (!id) throw new Error("Falta la publicación.");
  const skus = await traerTodo<any>(admin, "tiktok_skus", "sku_id, seller_sku, sku_interno, titulo", (q) =>
    q.eq("account_id", accountId).eq("product_id", id),
  );
  if (!skus?.length) throw new Error("Esa publicación no está en el catálogo de TikTok del ERP (espera a la siguiente sincronización).");
  const { error } = await admin.from("tiktok_productos_externos").upsert(
    { account_id: accountId, product_id: id, vendedor, titulo: skus[0]?.titulo ?? null, ligado_en: new Date().toISOString(), ligado_por: usuario },
    { onConflict: "account_id,product_id" },
  );
  if (error) throw new Error(`No se pudo ligar: ${error.message}`);
  let bautizados = 0;
  for (const s of skus) {
    if (s.sku_interno || !s.seller_sku) continue;
    const { error: e2 } = await admin
      .from("tiktok_skus")
      .update({ sku_interno: String(s.seller_sku).trim(), origen_amarre: "externo" })
      .eq("account_id", accountId)
      .eq("sku_id", s.sku_id);
    if (!e2) bautizados++;
  }
  limpiarCacheExternos(accountId);
  return { productId: id, vendedor, skus: skus.length, bautizados };
}

/** Quita la liga: la publicación vuelve a ser del dueño. Los movimientos del kardex se quedan. */
export async function desligarPublicacion(admin: any, accountId: string, productId: string): Promise<void> {
  const { error } = await admin.from("tiktok_productos_externos").delete().eq("account_id", accountId).eq("product_id", String(productId ?? "").trim());
  if (error) throw new Error(`No se pudo quitar la liga: ${error.message}`);
  limpiarCacheExternos(accountId);
}

export interface RenglonStockExterno {
  sku: string;
  titulo: string | null;
  /** con qué nombre lo vende TikTok */
  sellerSku: string | null;
  productId: string | null;
  estado: string | null;
  saldo: number;
  apartado: number;
  disponible: number;
  /** lo último que el ERP le escribió a TikTok; null = nunca */
  publicado: number | null;
  /** lo que TikTok dice tener hoy */
  enTikTok: number | null;
  /** true si alguna vez se capturó su stock (si no, TikTok se queda con su número) */
  contado: boolean;
}

/** El stock de un vendedor externo, SKU por SKU, para su pantalla. */
export async function stockExterno(db: DB, accountId: string, vendedorCrudo: string): Promise<RenglonStockExterno[]> {
  const vendedor = normalizarVendedor(vendedorCrudo);
  if (!vendedor) return [];
  const productos = await productosExternos(db, accountId);
  const suyos = [...productos].filter(([, v]) => v === vendedor).map(([id]) => id);
  if (!suyos.length) return [];
  const skus = await traerTodo<any>(db, "tiktok_skus", "product_id, seller_sku, sku_interno, titulo, talla, estado, cantidad_tiktok", (q) =>
    q.eq("account_id", accountId).in("product_id", suyos),
  );
  const nombres = [...new Set((skus ?? []).map((s: any) => String(s.sku_interno ?? s.seller_sku ?? "")).filter(Boolean))];
  const [inv, contadosRaw] = nombres.length
    ? await Promise.all([
        traerTodo<any>(db, "tiktok_inventario", "sku, saldo, apartado, apartado_web, publicado", (q) => q.eq("account_id", accountId).in("sku", nombres)),
        traerTodo<any>(db, "tiktok_movimientos", "sku", (q) => q.eq("account_id", accountId).in("sku", nombres).in("tipo", ["entrada", "ajuste"])),
      ])
    : [[], []];
  const porSku = new Map<string, any>((inv ?? []).map((r: any) => [String(r.sku), r]));
  const contados = new Set((contadosRaw ?? []).map((m: any) => String(m.sku)));
  const salida = new Map<string, RenglonStockExterno>();
  for (const s of skus ?? []) {
    const sku = String(s.sku_interno ?? s.seller_sku ?? "");
    if (!sku) continue;
    const r = porSku.get(sku);
    const saldo = Number(r?.saldo ?? 0);
    const apartado = Number(r?.apartado ?? 0) + Number(r?.apartado_web ?? 0);
    const previo = salida.get(sku);
    const enTikTok = s.cantidad_tiktok != null ? Number(s.cantidad_tiktok) : null;
    if (previo) {
      if (enTikTok != null) previo.enTikTok = previo.enTikTok == null ? enTikTok : Math.min(previo.enTikTok, enTikTok);
      continue;
    }
    salida.set(sku, {
      sku,
      titulo: s.titulo ? `${s.titulo}${s.talla ? ` · ${s.talla}` : ""}` : null,
      sellerSku: s.seller_sku ?? null,
      productId: s.product_id ?? null,
      estado: s.estado ?? null,
      saldo,
      apartado,
      disponible: Math.max(0, saldo - apartado),
      publicado: r?.publicado != null ? Number(r.publicado) : null,
      enTikTok,
      contado: contados.has(sku),
    });
  }
  return [...salida.values()].sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true }));
}

export interface ResultadoStockExterno {
  fecha: string;
  ajustes: number;
  publicacion: { publicados: number; avisos: string[] } | { error: string } | null;
}

/**
 * Guarda el stock que capturó el vendedor: por SKU, un `ajuste` al kardex con
 * ese número (el ajuste PISA el saldo, igual que un conteo) y en el mismo
 * clic se publica a TikTok pasando por `sincronizarTikTok` con `soloPedidos`,
 * que antes lee los pedidos recientes. Solo se aceptan SKUs del vendedor.
 */
export async function guardarStockExterno(
  admin: any,
  accountId: string,
  vendedorCrudo: string,
  renglones: { sku: string; pares: number }[],
  usuario: string | null,
): Promise<ResultadoStockExterno> {
  const vendedor = normalizarVendedor(vendedorCrudo);
  if (!vendedor) throw new Error("Vendedor desconocido.");
  const suyos = new Map((await stockExterno(admin, accountId, vendedor)).map((r) => [r.sku, r]));
  const limpios = renglones
    .map((r) => ({ sku: String(r.sku ?? "").trim(), pares: Math.max(0, Math.round(Number(r.pares) || 0)) }))
    .filter((r) => r.sku);
  const ajenos = limpios.filter((r) => !suyos.has(r.sku)).map((r) => r.sku);
  if (ajenos.length) throw new Error(`Estos SKU no son de ${nombreDeVendedor(vendedor)}: ${ajenos.slice(0, 8).join(", ")}.`);
  const fecha = new Date().toISOString();
  const movs: MovimientoManual[] = limpios
    // Un SKU nunca contado se captura aunque sea con cero: así queda «contado» y TikTok recibe el número.
    .filter((r) => (suyos.get(r.sku) as RenglonStockExterno).saldo !== r.pares || !(suyos.get(r.sku) as RenglonStockExterno).contado)
    .map((r) => ({
      sku: r.sku,
      tipo: "ajuste" as const,
      cantidad: r.pares,
      motivo: `Stock capturado por ${nombreDeVendedor(vendedor)} (bodega propia)`,
      referencia: `externo:${vendedor}:${fecha}`,
      fecha,
    }));
  const registro = movs.length ? await registrarMovimientos(admin, accountId, movs, usuario) : { registrados: 0, skus: [] };
  let publicacion: ResultadoStockExterno["publicacion"] = null;
  if (registro.registrados > 0) {
    try {
      const r = await sincronizarTikTok(admin, accountId, { soloPedidos: true });
      publicacion = { publicados: r.publicados, avisos: r.avisos };
    } catch (err) {
      publicacion = { error: (err as Error).message };
    }
  }
  return { fecha, ajustes: registro.registrados, publicacion };
}
