/**
 * Productos nuevos de TikTok: publicar en TikTok Shop lo que ya está en
 * Amazon (pedido del dueño, 30-sep-2026: «toma todos los productos que
 * tengo en Amazon de calzado —SKUs, imágenes, variantes y todo—, le pongo
 * el precio y se me publica masivamente en TikTok»).
 *
 * Dos mitades:
 *   · `listarProductosNuevos`: los productos de calzado de Amazon agrupados
 *     por modelo con sus colores y tallas, marcando lo que TikTok ya vende
 *     y lo que está en la cola. Masticado en `app_cache` (`tiktok:nuevos`,
 *     15 min) y lo tira cada escritura de la cola.
 *   · `publicarPendientes`: la COLA (`tiktok_publicaciones`) se trabaja por
 *     atrás con presupuesto de tiempo: por producto, lee la ficha de Amazon
 *     (fotos capturadas, puntos clave, descripción; el catálogo público de
 *     respaldo), sube las fotos a TikTok, copia categoría/marca/atributos
 *     de un producto PLANTILLA que la tienda ya tiene, crea el producto y
 *     da de alta sus SKUs en `tiktok_skus` para que el amarre y el kardex
 *     los conozcan desde el primer pedido. Todo deja constancia en
 *     `tiktok_sync_log` (tarea `publicar-producto`, con el cuerpo enviado
 *     y lo que contestó TikTok): el motor de TikTok no es cosa de adivinar
 *     y desde la base se ve qué rechazó y por qué.
 */
import {
  Cliente as ClienteAmazon,
  cuentasAmazon,
  type CuentaAmazon,
} from "../amazon/spapi";
import { imagenesDeAsins } from "../amazon/catalogo";
import {
  fichasCapturadasPorSku,
  type FichaCapturada,
} from "../amazon/fotos-publicacion";
import {
  conCandado,
  RecursoOcupadoError,
  traerTodo,
  upsertEnTandas,
  type DB,
} from "../datos/repos";
import {
  producto as productoTikTok,
  subirImagen,
  atributosDeCategoria,
  crearProducto,
} from "../tiktok/api";
import { ErrorTikTok, type Cliente as ClienteTikTok } from "../tiktok/client";
import {
  agruparProductosAmazon,
  armarCuerpoProducto,
  atributosDeVentaDeCategoria,
  descripcionDesdeAmazon,
  elegirImagenesPrincipales,
  indexarSkusMeli,
  interpretarRespuestaCreacion,
  plantillaDesdeProducto,
  type ColorAPublicar,
  type PlantillaTikTok,
  type ProductoAmazonParaTikTok,
} from "../tiktok/publicar";
import { pareceSkuDeCalzado } from "../tiktok/amarre";
import { guardarCacheApp, invalidarApp, leerCacheApp } from "./cache-app";
import { amarradorDeCuenta, clienteDeCuenta } from "./tiktok";

export const CLAVE_CACHE_NUEVOS = "tiktok:nuevos";
const EDAD_CACHE_NUEVOS_MS = 15 * 60_000;
export const RECURSO_PUBLICAR = "tiktok-publicar";
/** Más de esto y la cola lo deja en error para que alguien lo mire. */
export const INTENTOS_MAXIMOS = 3;
/** Fotos que se le suben a TikTok por color (la principal + extras). */
const FOTOS_POR_COLOR = 4;
const MS_POR_DESCARGA = 20_000;

export interface PublicacionEnCola {
  id: number;
  modelo: string;
  colores: string[];
  titulo: string;
  precio: number;
  borrador: boolean;
  estado: "pendiente" | "publicando" | "publicado" | "error";
  productId: string | null;
  error: string | null;
  intentos: number;
  creadoEn: string;
  publicadoEn: string | null;
  avisos: string[];
}

export interface ProductosNuevosTikTok {
  productos: ProductoAmazonParaTikTok[];
  cola: PublicacionEnCola[];
  moneda: string;
  /** Cuándo se masticó la lista de Amazon. */
  generadoEn: string;
  avisos: string[];
}

function num(x: unknown): number | null {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function cuentaAmazonDelErp(admin: any): Promise<CuentaAmazon | null> {
  const cuentas = await cuentasAmazon(admin);
  return cuentas[0] ?? null;
}

/** La cola tal cual está, más nueva primero. */
export async function leerCola(
  db: DB,
  accountId: string,
): Promise<PublicacionEnCola[]> {
  const { data, error } = await db
    .from("tiktok_publicaciones")
    .select(
      "id, modelo, colores, titulo, precio, borrador, estado, product_id, error, intentos, creado_en, publicado_en, resultado",
    )
    .eq("account_id", accountId)
    .order("creado_en", { ascending: false })
    .limit(500);
  if (error) throw new Error(`tiktok_publicaciones: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    id: Number(r.id),
    modelo: String(r.modelo),
    colores: Array.isArray(r.colores) ? r.colores.map(String) : [],
    titulo: String(r.titulo ?? ""),
    precio: num(r.precio) ?? 0,
    borrador: Boolean(r.borrador),
    estado: r.estado,
    productId: r.product_id ?? null,
    error: r.error ?? null,
    intentos: Number(r.intentos ?? 0),
    creadoEn: r.creado_en,
    publicadoEn: r.publicado_en ?? null,
    avisos: Array.isArray(r.resultado?.avisos)
      ? r.resultado.avisos.map(String)
      : [],
  }));
}

/**
 * Los productos de Amazon agrupados (masticados). La cola se lee siempre
 * fresca: es lo que cambia mientras se publica.
 */
export async function listarProductosNuevos(
  admin: any,
  accountId: string,
  opciones: { forzar?: boolean } = {},
): Promise<ProductosNuevosTikTok> {
  const avisos: string[] = [];
  let lista: {
    productos: ProductoAmazonParaTikTok[];
    generadoEn: string;
  } | null = null;
  if (!opciones.forzar) {
    const g = await leerCacheApp<{
      productos: ProductoAmazonParaTikTok[];
      generadoEn: string;
    }>(admin, accountId, CLAVE_CACHE_NUEVOS, EDAD_CACHE_NUEVOS_MS);
    if (g.estado === "encontrado") lista = g.valor;
  }
  if (!lista) {
    const t0 = Date.now();
    lista = {
      productos: await agruparDesdeLaBase(admin, accountId),
      generadoEn: new Date().toISOString(),
    };
    await guardarCacheApp(
      admin,
      accountId,
      CLAVE_CACHE_NUEVOS,
      lista,
      Date.now() - t0,
    ).catch(() => {});
  }

  const [cola, { data: tienda }] = await Promise.all([
    leerCola(admin, accountId),
    admin
      .from("tiktok_tienda")
      .select("moneda, warehouse_id, activo")
      .eq("account_id", accountId)
      .maybeSingle(),
  ]);
  if (!tienda?.activo)
    avisos.push(
      "TikTok Shop no está conectado: se puede ver la lista, pero no publicar.",
    );
  else if (!tienda?.warehouse_id)
    avisos.push(
      "La tienda de TikTok no tiene bodega configurada: TikTok no acepta variantes sin bodega.",
    );

  return {
    productos: lista.productos,
    cola,
    moneda: tienda?.moneda ?? "MXN",
    generadoEn: lista.generadoEn,
    avisos,
  };
}

async function agruparDesdeLaBase(
  admin: any,
  accountId: string,
): Promise<ProductoAmazonParaTikTok[]> {
  const amazon = await cuentaAmazonDelErp(admin);
  if (!amazon) return [];
  const [listings, padresRaw, enTikTokRaw, aliasRaw, skusMeli] =
    await Promise.all([
      traerTodo<any>(
        admin,
        "amazon_listings",
        "seller_sku, asin, titulo, estado, precio, imagen_url",
        (q) => q.eq("account_id", amazon.accountId),
      ),
      traerTodo<any>(admin, "amazon_padres", "asin, titulo, imagen_url", (q) =>
        q.eq("account_id", amazon.accountId),
      ),
      traerTodo<any>(
        admin,
        "tiktok_skus",
        "seller_sku, sku_interno, product_id, estado",
        (q) => q.eq("account_id", accountId).eq("activo", true),
      ),
      traerTodo<any>(
        admin,
        "tiktok_alias_amazon",
        "modelo, color_tiktok, color_amazon",
        (q) => q.eq("account_id", accountId),
      ),
      traerTodo<any>(admin, "skus", "sku", (q) =>
        q.eq("account_id", accountId).eq("activo", true),
      ),
    ]);
  const padres = new Map<
    string,
    { titulo: string | null; imagenUrl: string | null }
  >();
  for (const p of padresRaw ?? [])
    if (p.asin)
      padres.set(String(p.asin), {
        titulo: p.titulo ?? null,
        imagenUrl: p.imagen_url ?? null,
      });

  return agruparProductosAmazon(
    (listings ?? []).map((f: any) => ({
      sellerSku: String(f.seller_sku ?? ""),
      asin: f.asin ?? null,
      titulo: f.titulo ?? null,
      estado: f.estado ?? null,
      precio: num(f.precio),
      imagenUrl: f.imagen_url ?? null,
    })),
    {
      padres,
      enTikTok: (enTikTokRaw ?? []).map((s: any) => ({
        sellerSku: s.seller_sku ?? null,
        skuInterno: s.sku_interno ?? null,
        productId: String(s.product_id ?? ""),
        estado: s.estado ?? null,
      })),
      alias: (aliasRaw ?? []).map((a: any) => ({
        modelo: String(a.modelo),
        colorTikTok: String(a.color_tiktok),
        colorAmazon: String(a.color_amazon),
      })),
      skusMeli: indexarSkusMeli(
        (skusMeli ?? []).map((s: any) => String(s.sku ?? "")),
      ),
    },
  );
}

// ---------------------------------------------------------------------------
// Encolar
// ---------------------------------------------------------------------------

export interface PedidoDePublicacion {
  modelo: string;
  /** vacío = todos los colores que faltan en TikTok */
  colores?: string[];
  precio: number;
  titulo?: string;
}

/**
 * Deja en la cola lo que el dueño marcó. Un modelo que ya está pendiente o
 * publicándose no se duplica; los colores que TikTok ya vende se quitan.
 */
export async function encolarPublicaciones(
  admin: any,
  accountId: string,
  pedidos: PedidoDePublicacion[],
  opciones: { borrador?: boolean; creadoPor?: string | null } = {},
): Promise<{
  encolados: number;
  rechazados: { modelo: string; motivo: string }[];
}> {
  const lista = await listarProductosNuevos(admin, accountId);
  const porModelo = new Map(lista.productos.map((p) => [p.modelo, p]));
  const enCola = new Set(
    lista.cola
      .filter((c) => c.estado === "pendiente" || c.estado === "publicando")
      .map((c) => c.modelo),
  );

  const filas: Record<string, unknown>[] = [];
  const rechazados: { modelo: string; motivo: string }[] = [];
  for (const p of pedidos) {
    const modelo = String(p.modelo ?? "")
      .trim()
      .toUpperCase();
    const producto = porModelo.get(modelo);
    if (!producto) {
      rechazados.push({ modelo, motivo: "No está en el catálogo de Amazon." });
      continue;
    }
    if (enCola.has(modelo)) {
      rechazados.push({ modelo, motivo: "Ya está en la cola." });
      continue;
    }
    const precio = Number(p.precio);
    if (!(precio > 0)) {
      rechazados.push({ modelo, motivo: "Sin precio." });
      continue;
    }
    const pedidosColores = (p.colores ?? [])
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const colores = (
      pedidosColores.length ? pedidosColores : producto.coloresPorPublicar
    ).filter((c) => producto.coloresPorPublicar.includes(c));
    if (!colores.length) {
      rechazados.push({ modelo, motivo: "TikTok ya vende todos sus colores." });
      continue;
    }
    const titulo = String(p.titulo ?? "").trim() || producto.titulo;
    filas.push({
      account_id: accountId,
      modelo,
      colores,
      titulo,
      precio,
      borrador: Boolean(opciones.borrador),
      estado: "pendiente",
      creado_por: opciones.creadoPor ?? null,
    });
    enCola.add(modelo);
  }
  if (filas.length) {
    const { error } = await admin.from("tiktok_publicaciones").insert(filas);
    if (error) throw new Error(`tiktok_publicaciones: ${error.message}`);
  }
  return { encolados: filas.length, rechazados };
}

/** Un renglón en error vuelve a la cola; uno publicado o pendiente no se toca. */
export async function reintentarPublicacion(
  admin: any,
  accountId: string,
  id: number,
): Promise<boolean> {
  const { data, error } = await admin
    .from("tiktok_publicaciones")
    .update({
      estado: "pendiente",
      error: null,
      intentos: 0,
      actualizado_en: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("id", id)
    .eq("estado", "error")
    .select("id");
  if (error) throw new Error(`tiktok_publicaciones: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Quita de la cola un renglón que no se ha publicado. */
export async function quitarDeLaCola(
  admin: any,
  accountId: string,
  id: number,
): Promise<boolean> {
  const { data, error } = await admin
    .from("tiktok_publicaciones")
    .delete()
    .eq("account_id", accountId)
    .eq("id", id)
    .in("estado", ["pendiente", "error"])
    .select("id");
  if (error) throw new Error(`tiktok_publicaciones: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function hayPendientes(
  admin: any,
  accountId: string,
): Promise<boolean> {
  const { count } = await admin
    .from("tiktok_publicaciones")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("estado", "pendiente");
  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Publicar por atrás
// ---------------------------------------------------------------------------

export interface ResultadoPublicar {
  publicados: number;
  errores: number;
  /** Quedan pendientes y se acabó el tiempo. */
  faltan: number;
  ocupado: boolean;
  avisos: string[];
}

/**
 * Trabaja la cola con presupuesto de tiempo. Un producto a la vez (TikTok
 * tarda ~1 s por foto y unos segundos por creación); el que se acaba el
 * tiempo a medias se queda `pendiente` con sus fotos ya subidas en el
 * resultado para no volver a subirlas.
 */
export async function publicarPendientes(
  admin: any,
  accountId: string,
  msPresupuesto: number,
): Promise<ResultadoPublicar> {
  const limite = Date.now() + msPresupuesto;
  const avisos: string[] = [];
  try {
    return await conCandado(
      admin,
      accountId,
      RECURSO_PUBLICAR,
      Math.ceil(msPresupuesto / 1000) + 30,
      async () => {
        let publicados = 0;
        let errores = 0;

        const { data: pendientes } = await admin
          .from("tiktok_publicaciones")
          .select(
            "id, modelo, colores, titulo, precio, borrador, intentos, resultado",
          )
          .eq("account_id", accountId)
          .eq("estado", "pendiente")
          .order("creado_en", { ascending: true })
          .limit(50);
        const cola: any[] = pendientes ?? [];
        if (!cola.length)
          return { publicados, errores, faltan: 0, ocupado: false, avisos };

        const tiktok = await clienteDeCuenta(admin, accountId, msPresupuesto);
        if (!tiktok?.tienda.shopCipher) {
          avisos.push("TikTok Shop no está conectado.");
          return {
            publicados,
            errores,
            faltan: cola.length,
            ocupado: false,
            avisos,
          };
        }
        const amazonCuenta = await cuentaAmazonDelErp(admin);
        const amazon = amazonCuenta
          ? new ClienteAmazon(amazonCuenta, limite)
          : null;
        if (!amazon)
          avisos.push(
            "Amazon no está conectado: las fotos salen solo de lo guardado en el catálogo.",
          );

        const contexto = await contextoDeCuenta(admin, accountId, tiktok);
        const plantillas = new Map<string, PlantillaTikTok>();

        let i = 0;
        for (; i < cola.length; i++) {
          if (Date.now() > limite - 45_000) break;
          const fila = cola[i];
          const id = Number(fila.id);
          await admin
            .from("tiktok_publicaciones")
            .update({
              estado: "publicando",
              intentos: Number(fila.intentos ?? 0) + 1,
              actualizado_en: new Date().toISOString(),
            })
            .eq("id", id);
          const inicio = new Date().toISOString();
          try {
            const r = await publicarUno(
              admin,
              accountId,
              tiktok,
              amazon,
              contexto,
              plantillas,
              fila,
              limite,
            );
            if (r.sinTiempo) {
              await admin
                .from("tiktok_publicaciones")
                .update({
                  estado: "pendiente",
                  resultado: r.parcial,
                  actualizado_en: new Date().toISOString(),
                })
                .eq("id", id);
              break;
            }
            publicados++;
            await admin
              .from("tiktok_publicaciones")
              .update({
                estado: "publicado",
                product_id: r.productId,
                resultado: r.resultado,
                error: null,
                publicado_en: new Date().toISOString(),
                actualizado_en: new Date().toISOString(),
              })
              .eq("id", id);
            await bitacora(
              admin,
              accountId,
              "publicar-producto",
              inicio,
              "ok",
              { id, modelo: fila.modelo, ...r.resultado },
            );
          } catch (err) {
            errores++;
            const mensaje = (err as Error).message;
            const intentos = Number(fila.intentos ?? 0) + 1;
            const definitivo =
              intentos >= INTENTOS_MAXIMOS ||
              err instanceof ErrorTikTok ||
              /plantilla|título|imagen|precio|bodega|variantes|talla/i.test(
                mensaje,
              );
            // Las fotos que ya subieron se quedan anotadas: el reintento no las vuelve a subir.
            const subidas = (err as any)?.subidas;
            await admin
              .from("tiktok_publicaciones")
              .update({
                estado: definitivo ? "error" : "pendiente",
                error: mensaje,
                ...(subidas && Object.keys(subidas).length
                  ? { resultado: { ...(fila.resultado ?? {}), subidas } }
                  : {}),
                actualizado_en: new Date().toISOString(),
              })
              .eq("id", id);
            await bitacora(
              admin,
              accountId,
              "publicar-producto",
              inicio,
              "error",
              {
                id,
                modelo: fila.modelo,
                error: mensaje,
                cuerpo: (err as any)?.cuerpoEnviado ?? null,
                definitivo,
              },
            );
            if (!definitivo) break; // un fallo de red o de tiempo: mejor seguir en la próxima vuelta
          }
        }

        const faltan = cola.length - i;
        await invalidarApp(admin, accountId, "publicación en TikTok", {
          claves: [CLAVE_CACHE_NUEVOS],
        }).catch(() => {});
        return { publicados, errores, faltan, ocupado: false, avisos };
      },
    );
  } catch (err) {
    if (err instanceof RecursoOcupadoError)
      return { publicados: 0, errores: 0, faltan: 0, ocupado: true, avisos };
    throw err;
  }
}

interface ContextoCuenta {
  warehouseId: string;
  moneda: string;
  amazonAccountId: string | null;
  sellingPartnerId: string | null;
  /** seller_sku del ERP → lo publicado hoy a TikTok de ese SKU */
  publicadoPorSku: Map<string, number>;
  amarrar: (sellerSku: string | null) => {
    skuInterno: string | null;
    origen: string | null;
  };
}

async function contextoDeCuenta(
  admin: any,
  accountId: string,
  tiktok: ClienteTikTok,
): Promise<ContextoCuenta> {
  const [{ data: tienda }, inventario, amarrar, amazon] = await Promise.all([
    admin
      .from("tiktok_tienda")
      .select("moneda, warehouse_id")
      .eq("account_id", accountId)
      .maybeSingle(),
    traerTodo<any>(
      admin,
      "tiktok_inventario",
      "sku, publicado, saldo, apartado",
      (q) => q.eq("account_id", accountId),
    ),
    amarradorDeCuenta(admin, accountId),
    cuentaAmazonDelErp(admin),
  ]);
  const publicadoPorSku = new Map<string, number>();
  for (const r of inventario ?? []) {
    const publicado = num(r.publicado);
    const calculado = Math.max(0, (num(r.saldo) ?? 0) - (num(r.apartado) ?? 0));
    publicadoPorSku.set(String(r.sku).toUpperCase(), publicado ?? calculado);
  }
  return {
    warehouseId: tienda?.warehouse_id ?? tiktok.tienda.warehouseId ?? "",
    moneda: tienda?.moneda ?? "MXN",
    amazonAccountId: amazon?.accountId ?? null,
    sellingPartnerId: amazon?.sellingPartnerId ?? null,
    publicadoPorSku,
    amarrar,
  };
}

/**
 * La plantilla de un modelo: un producto ACTIVO de la tienda del mismo
 * modelo si lo hay (misma categoría seguro), si no cualquiera de calzado.
 * Si a la plantilla le falta Color o Talla, se completan con los atributos
 * de venta de su categoría.
 */
async function plantillaPara(
  admin: any,
  accountId: string,
  tiktok: ClienteTikTok,
  modelo: string,
  cache: Map<string, PlantillaTikTok>,
): Promise<PlantillaTikTok> {
  const { data: candidatos } = await admin
    .from("tiktok_skus")
    .select("product_id, sku_interno, seller_sku, actualizado_en")
    .eq("account_id", accountId)
    .eq("activo", true)
    .eq("estado", "ACTIVATE")
    .not("product_id", "is", null)
    .order("actualizado_en", { ascending: false })
    .limit(2000);
  const lista: any[] = candidatos ?? [];
  const delModelo = lista.find((s) =>
    String(s.sku_interno ?? s.seller_sku ?? "")
      .toUpperCase()
      .startsWith(`${modelo}-`),
  );
  const deCalzado =
    delModelo ??
    lista.find((s) =>
      pareceSkuDeCalzado(String(s.sku_interno ?? s.seller_sku ?? "")),
    );
  if (!deCalzado)
    throw new Error(
      "La tienda no tiene ningún producto de calzado activo que sirva de plantilla (categoría, atributos y marca).",
    );
  const productId = String(deCalzado.product_id);
  const enCache = cache.get(productId);
  if (enCache) return enCache;

  const crudo = await productoTikTok(tiktok, productId);
  if (!crudo) throw new ErrorSinTiempo();
  const plantilla = plantillaDesdeProducto(crudo);
  if (!plantilla.atributoTalla || !plantilla.atributoColor) {
    const atributos = await atributosDeCategoria(tiktok, plantilla.categoryId);
    const { color, talla } = atributosDeVentaDeCategoria(atributos);
    plantilla.atributoTalla = plantilla.atributoTalla ?? talla;
    plantilla.atributoColor = plantilla.atributoColor ?? color;
  }
  cache.set(productId, plantilla);
  return plantilla;
}

class ErrorSinTiempo extends Error {
  constructor() {
    super("Se acabó el tiempo de la función.");
  }
}

/** Baja una imagen de Amazon (JPG/PNG). Una que no sea imagen cuenta como fallida. */
async function bajarImagen(
  url: string,
): Promise<{ bytes: Uint8Array; tipo: string } | null> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(MS_POR_DESCARGA),
    });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const esJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const esPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    if (!esJpg && !esPng) return null;
    return { bytes, tipo: esPng ? "image/png" : "image/jpeg" };
  } catch {
    return null;
  }
}

interface ResultadoUno {
  sinTiempo: boolean;
  parcial?: Record<string, unknown>;
  productId?: string;
  resultado?: Record<string, unknown>;
}

async function publicarUno(
  admin: any,
  accountId: string,
  tiktok: ClienteTikTok,
  amazon: ClienteAmazon | null,
  ctx: ContextoCuenta,
  plantillas: Map<string, PlantillaTikTok>,
  fila: any,
  limite: number,
): Promise<ResultadoUno> {
  const modelo = String(fila.modelo).toUpperCase();
  const coloresPedidos: string[] = Array.isArray(fila.colores)
    ? fila.colores.map((c: any) => String(c).toUpperCase())
    : [];
  const lista = await listarProductosNuevos(admin, accountId);
  const producto = lista.productos.find((p) => p.modelo === modelo);
  if (!producto)
    throw new Error(`${modelo} ya no está en el catálogo de Amazon.`);
  const colores = producto.colores.filter(
    (c) => coloresPedidos.includes(c.color) && !c.enTikTok.length,
  );
  if (!colores.length)
    throw new Error(
      `${modelo}: TikTok ya vende los colores pedidos (${coloresPedidos.join(", ")}).`,
    );

  const plantilla = await plantillaPara(
    admin,
    accountId,
    tiktok,
    modelo,
    plantillas,
  );

  // 1. La ficha de Amazon: fotos capturadas y texto, por color (el primer SKU
  //    activo de cada color; si ninguno contesta, el catálogo público por ASIN).
  const skusPorColor = colores.map((c) =>
    [...c.tallas]
      .sort(
        (a, b) =>
          (a.estado === "Active" ? -1 : 1) - (b.estado === "Active" ? -1 : 1),
      )
      .slice(0, 3)
      .map((t) => t.sellerSku),
  );
  let fichas = new Map<string, FichaCapturada>();
  if (amazon && ctx.sellingPartnerId) {
    try {
      fichas = await fichasCapturadasPorSku(
        amazon,
        ctx.sellingPartnerId,
        skusPorColor.flat(),
      );
    } catch (err) {
      console.error("fichasCapturadasPorSku:", (err as Error).message);
    }
  }
  const fichaDeColor = (i: number): FichaCapturada | null => {
    for (const s of skusPorColor[i]) {
      const f = fichas.get(s.toUpperCase());
      if (f) return f;
    }
    return null;
  };

  // Fotos de respaldo del catálogo público, solo para los colores sin ficha.
  const sinFotos = colores
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => !fichaDeColor(i)?.fotos.length);
  const asinsRespaldo = sinFotos.flatMap(({ c }) =>
    c.tallas
      .map((t) => t.asin)
      .filter((a): a is string => Boolean(a))
      .slice(0, 2),
  );
  let catalogoPublico = new Map<string, { link: string }[]>();
  if (amazon && asinsRespaldo.length) {
    try {
      catalogoPublico = await imagenesDeAsins(amazon, asinsRespaldo);
    } catch (err) {
      console.error("imagenesDeAsins:", (err as Error).message);
    }
  }
  const fotosDeColor = (i: number): string[] => {
    const f = fichaDeColor(i);
    if (f?.fotos.length) return f.fotos;
    for (const t of colores[i].tallas) {
      const imgs = t.asin ? catalogoPublico.get(t.asin) : undefined;
      if (imgs?.length) return imgs.map((x) => x.link);
    }
    return colores[i].imagenUrl ? [colores[i].imagenUrl as string] : [];
  };

  // 2. Subir las fotos a TikTok (las ya subidas en un intento anterior se reusan).
  const subidas: Record<string, string> = {
    ...(fila.resultado?.subidas ?? {}),
  };
  const urisPorColor: string[][] = [];
  for (let i = 0; i < colores.length; i++) {
    const uris: string[] = [];
    for (const url of fotosDeColor(i).slice(0, FOTOS_POR_COLOR)) {
      if (Date.now() > limite - 30_000)
        return { sinTiempo: true, parcial: { subidas } };
      if (subidas[url]) {
        uris.push(subidas[url]);
        continue;
      }
      const img = await bajarImagen(url);
      if (!img) continue;
      const r = await subirImagen(tiktok, img.bytes, img.tipo, "MAIN_IMAGE");
      if (!r) return { sinTiempo: true, parcial: { subidas } };
      subidas[url] = r.uri;
      uris.push(r.uri);
    }
    urisPorColor.push(uris);
  }
  const imagenesUri = elegirImagenesPrincipales(urisPorColor);

  // 3. El cuerpo y la creación.
  const fichaTexto = colores
    .map((_, i) => fichaDeColor(i))
    .find((f) => f && (f.bullets.length || f.descripcion));
  const descripcionHtml = descripcionDesdeAmazon({
    bullets: fichaTexto?.bullets ?? [],
    descripcion: fichaTexto?.descripcion ?? null,
    titulo: String(fila.titulo),
  });
  const coloresAPublicar: ColorAPublicar[] = colores.map((c, i) => ({
    color: c.color,
    imagenUri: urisPorColor[i][0] ?? null,
    tallas: c.tallas.map((t) => ({
      talla: t.talla,
      sellerSku: t.skuTikTok,
      cantidad:
        ctx.publicadoPorSku.get(
          (ctx.amarrar(t.skuTikTok).skuInterno ?? t.skuTikTok).toUpperCase(),
        ) ?? 0,
    })),
  }));
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = armarCuerpoProducto(
      {
        titulo: String(fila.titulo),
        descripcionHtml,
        precio: Number(fila.precio),
        moneda: ctx.moneda,
        warehouseId: ctx.warehouseId,
        imagenesUri,
        colores: coloresAPublicar,
        borrador: Boolean(fila.borrador),
      },
      plantilla,
    );
  } catch (err) {
    (err as any).subidas = subidas;
    throw err;
  }

  let respuesta: any;
  try {
    respuesta = await crearProducto(tiktok, cuerpo);
  } catch (err) {
    (err as any).cuerpoEnviado = cuerpo;
    (err as any).subidas = subidas;
    throw err;
  }
  if (!respuesta) return { sinTiempo: true, parcial: { subidas } };
  const creado = interpretarRespuestaCreacion(respuesta);

  // 4. Los SKUs nuevos al catálogo de TikTok del ERP, ya amarrados.
  const ahora = new Date().toISOString();
  const filasSkus = creado.skus
    .filter((s) => s.skuId)
    .map((s) => {
      const a = ctx.amarrar(s.sellerSku);
      return {
        account_id: accountId,
        sku_id: s.skuId,
        product_id: creado.productId,
        seller_sku: s.sellerSku,
        titulo: cuerpo.title,
        talla: null,
        precio: Number(fila.precio),
        estado: fila.borrador ? "DRAFT" : "ACTIVATE",
        sku_interno: a.skuInterno,
        origen_amarre: a.origen,
        activo: true,
        actualizado_en: ahora,
      };
    });
  if (filasSkus.length)
    await upsertEnTandas(admin, "tiktok_skus", filasSkus, "account_id,sku_id");

  return {
    sinTiempo: false,
    productId: creado.productId,
    resultado: {
      productId: creado.productId,
      skus: creado.skus,
      avisos: creado.avisos,
      subidas,
      plantilla: plantilla.productoId,
      categoria: plantilla.categoryId,
      imagenes: imagenesUri.length,
      colores: colores.map((c) => c.color),
      cuerpo: {
        ...cuerpo,
        description: String(cuerpo.description).slice(0, 500),
      },
    },
  };
}

async function bitacora(
  admin: any,
  accountId: string,
  tarea: string,
  inicio: string,
  estado: string,
  detalle: unknown,
): Promise<void> {
  try {
    await admin
      .from("tiktok_sync_log")
      .insert({
        account_id: accountId,
        tarea,
        inicio,
        fin: new Date().toISOString(),
        estado,
        detalle,
      });
  } catch {
    /* la bitácora nunca tumba la publicación */
  }
}
