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
  editarProductoParcial,
} from "../tiktok/api";
import { ErrorTikTok, type Cliente as ClienteTikTok } from "../tiktok/client";
import {
  agruparProductosAmazon,
  agruparPublicacionesMeli,
  agruparVariantesMeli,
  armarCuerpoProducto,
  atributosDeVentaDeCategoria,
  descripcionDesdeAmazon,
  elegirImagenesPrincipales,
  indexarSkusMeli,
  interpretarRespuestaCreacion,
  nombreColorEspanol,
  plantillaDesdeProducto,
  type ColorAPublicar,
  type PlantillaTikTok,
  type ProductoAmazonParaTikTok,
  type PublicacionMeliParaTikTok,
  type VarianteMeli,
} from "../tiktok/publicar";
import { clienteDeCuenta as clienteMeliDeCuenta } from "./webhooks";
import { pareceSkuDeCalzado } from "../tiktok/amarre";
import { guiaDeTallas, textoGuiaTallas } from "../tiktok/guia-tallas";
import { dibujarGuiaTallas } from "../tiktok/guia-tallas-imagen";
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
  /** de dónde sale: un modelo de Amazon o una publicación de MELI completa */
  fuente: "amazon" | "meli";
  /** la publicación de MELI (fuente `meli`); `modelo` la repite y `colores` lleva sus modelos */
  itemId: string | null;
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
  /** publicaciones de MELI que juntan varios modelos: se publican como UN producto */
  publicacionesMeli: PublicacionMeliParaTikTok[];
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
      "id, fuente, item_id, modelo, colores, titulo, precio, borrador, estado, product_id, error, intentos, creado_en, publicado_en, resultado",
    )
    .eq("account_id", accountId)
    .order("creado_en", { ascending: false })
    .limit(500);
  if (error) throw new Error(`tiktok_publicaciones: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    id: Number(r.id),
    fuente: r.fuente === "meli" ? "meli" : "amazon",
    itemId: r.item_id ?? null,
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
    publicacionesMeli: PublicacionMeliParaTikTok[];
    generadoEn: string;
  } | null = null;
  if (!opciones.forzar) {
    const g = await leerCacheApp<{
      productos: ProductoAmazonParaTikTok[];
      publicacionesMeli?: PublicacionMeliParaTikTok[];
      generadoEn: string;
    }>(admin, accountId, CLAVE_CACHE_NUEVOS, EDAD_CACHE_NUEVOS_MS);
    // Un renglón de antes del 2-oct-2026 no trae las publicaciones de MELI: se rehace.
    if (g.estado === "encontrado" && Array.isArray(g.valor.publicacionesMeli))
      lista = { ...g.valor, publicacionesMeli: g.valor.publicacionesMeli };
  }
  if (!lista) {
    const t0 = Date.now();
    const [productos, publicacionesMeli] = await Promise.all([
      agruparDesdeLaBase(admin, accountId),
      agruparMeliDesdeLaBase(admin, accountId),
    ]);
    lista = {
      productos,
      publicacionesMeli,
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
    publicacionesMeli: lista.publicacionesMeli,
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

/** Las variantes activas de MELI de la cuenta, como las ve el motor puro. */
async function variantesMeliDeLaBase(
  admin: any,
  accountId: string,
  itemId?: string,
): Promise<VarianteMeli[]> {
  const filas = await traerTodo<any>(
    admin,
    "skus",
    "sku, item_id, variation_id, modelo, color, talla, titulo, precio, activo",
    (q) => {
      let r = q.eq("account_id", accountId).eq("activo", true);
      if (itemId) r = r.eq("item_id", itemId);
      return r;
    },
  );
  return (filas ?? []).map((f: any) => ({
    sku: String(f.sku ?? ""),
    itemId: String(f.item_id ?? ""),
    variationId: f.variation_id != null ? String(f.variation_id) : null,
    modelo: f.modelo ?? null,
    color: f.color ?? null,
    talla: f.talla != null ? String(f.talla) : null,
    titulo: f.titulo ?? null,
    precio: num(f.precio),
    activo: Boolean(f.activo),
  }));
}

async function skusEnTikTok(admin: any, accountId: string) {
  const filas = await traerTodo<any>(
    admin,
    "tiktok_skus",
    "seller_sku, sku_interno, product_id, estado",
    (q) => q.eq("account_id", accountId).eq("activo", true),
  );
  return (filas ?? []).map((s: any) => ({
    sellerSku: s.seller_sku ?? null,
    skuInterno: s.sku_interno ?? null,
    productId: String(s.product_id ?? ""),
    estado: s.estado ?? null,
  }));
}

/**
 * Las publicaciones de MELI que juntan VARIOS modelos (GT117…GT122 en
 * MLM2745026941): el publicador por modelo de Amazon no sabe armarlas como
 * un solo producto, así que se enseñan aparte y se publican completas.
 */
async function agruparMeliDesdeLaBase(
  admin: any,
  accountId: string,
): Promise<PublicacionMeliParaTikTok[]> {
  const [variantes, enTikTok] = await Promise.all([
    variantesMeliDeLaBase(admin, accountId),
    skusEnTikTok(admin, accountId),
  ]);
  return agruparPublicacionesMeli(variantes, enTikTok);
}

// ---------------------------------------------------------------------------
// Encolar
// ---------------------------------------------------------------------------

export interface PedidoDePublicacionMeli {
  itemId: string;
  precio: number;
  titulo?: string;
}

/**
 * Deja en la cola una publicación de MELI completa (sus modelos como
 * variantes de UN producto de TikTok). Una que ya está pendiente no se
 * duplica; una cuyas variantes TikTok ya vende todas, tampoco.
 */
export async function encolarPublicacionesMeli(
  admin: any,
  accountId: string,
  pedidos: PedidoDePublicacionMeli[],
  opciones: { borrador?: boolean; creadoPor?: string | null } = {},
): Promise<{
  encolados: number;
  rechazados: { modelo: string; motivo: string }[];
}> {
  const lista = await listarProductosNuevos(admin, accountId);
  const porItem = new Map(lista.publicacionesMeli.map((p) => [p.itemId, p]));
  const enCola = new Set(
    lista.cola
      .filter((c) => (c.estado === "pendiente" || c.estado === "publicando") && c.itemId)
      .map((c) => String(c.itemId)),
  );
  const filas: Record<string, unknown>[] = [];
  const rechazados: { modelo: string; motivo: string }[] = [];
  for (const p of pedidos) {
    const itemId = String(p.itemId ?? "").trim().toUpperCase();
    const pub = porItem.get(itemId);
    if (!pub) {
      rechazados.push({ modelo: itemId, motivo: "No es una publicación de MELI con varios modelos." });
      continue;
    }
    if (enCola.has(itemId)) {
      rechazados.push({ modelo: itemId, motivo: "Ya está en la cola." });
      continue;
    }
    const precio = Number(p.precio);
    if (!(precio > 0)) {
      rechazados.push({ modelo: itemId, motivo: "Sin precio." });
      continue;
    }
    if (pub.enTikTok.length >= pub.variantes) {
      rechazados.push({ modelo: itemId, motivo: "TikTok ya vende todas sus variantes." });
      continue;
    }
    filas.push({
      account_id: accountId,
      fuente: "meli",
      item_id: itemId,
      modelo: itemId,
      colores: pub.modelos,
      titulo: String(p.titulo ?? "").trim() || pub.titulo,
      precio,
      borrador: Boolean(opciones.borrador),
      estado: "pendiente",
      creado_por: opciones.creadoPor ?? null,
    });
    enCola.add(itemId);
  }
  if (filas.length) {
    const { error } = await admin.from("tiktok_publicaciones").insert(filas);
    if (error) throw new Error(`tiktok_publicaciones: ${error.message}`);
  }
  return { encolados: filas.length, rechazados };
}

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
  if ((count ?? 0) > 0) return true;
  return (await correccionesPendientes(admin, accountId)).length > 0;
}

/** Hasta cuántas veces se intenta corregir un producto ya publicado. */
const INTENTOS_CORRECCION = 2;

/**
 * Los productos ya publicados a los que les falta algo que hoy sí se manda
 * (la guía de tallas como imagen; los colores en español de los primeros):
 * se corrigen por edición parcial, sin rehacer el producto. Un producto
 * que ya se intentó `INTENTOS_CORRECCION` veces se deja en paz.
 */
export async function correccionesPendientes(
  admin: any,
  accountId: string,
): Promise<any[]> {
  const { data } = await admin
    .from("tiktok_publicaciones")
    .select("id, modelo, titulo, product_id, resultado")
    .eq("account_id", accountId)
    .eq("estado", "publicado")
    .not("product_id", "is", null)
    .is("resultado->>guiaTallas", null)
    .order("id", { ascending: true })
    .limit(100);
  return (data ?? []).filter(
    (r: any) =>
      Number(r.resultado?.correccionIntentos ?? 0) < INTENTOS_CORRECCION,
  );
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
            "id, fuente, item_id, modelo, colores, titulo, precio, borrador, intentos, resultado",
          )
          .eq("account_id", accountId)
          .eq("estado", "pendiente")
          .order("creado_en", { ascending: true })
          .limit(50);
        const cola: any[] = pendientes ?? [];
        const correcciones = await correccionesPendientes(admin, accountId);
        if (!cola.length && !correcciones.length)
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
            const r =
              fila.fuente === "meli"
                ? await publicarUnoDeMeli(
                    admin,
                    accountId,
                    tiktok,
                    contexto,
                    plantillas,
                    fila,
                    limite,
                  )
                : await publicarUno(
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
            // Un rechazo de TikTok, un cuerpo inarmable o un pedido que ya no
            // procede (TikTok ya vende esos colores, el modelo ya no está en
            // Amazon) es definitivo: se queda en error para que alguien lo
            // mire. Solo la red y el tiempo se reintentan.
            const definitivo =
              intentos >= INTENTOS_MAXIMOS ||
              err instanceof ErrorTikTok ||
              /plantilla|título|imagen|precio|bodega|variantes|talla|ya vende|catálogo/i.test(
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
            // Se acabó el tiempo: lo que falta se queda para la siguiente
            // vuelta. Cualquier otro fallo NO detiene a los demás productos de
            // la cola (el 30-sep-2026 un GT168 repetido dejó parado al GT169).
            if (err instanceof ErrorSinTiempo || /tiempo/i.test(mensaje)) break;
          }
        }

        const faltan = cola.length - i;

        // Lo ya publicado que le falta algo se corrige con el tiempo que
        // sobre, solo cuando la cola de nuevos ya no tiene nada por delante.
        if (faltan === 0) {
          for (const fila of correcciones) {
            if (Date.now() > limite - 40_000) break;
            await corregirPublicado(admin, accountId, tiktok, fila, limite);
          }
        }

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

  const fichaTexto = colores
    .map((_, i) => fichaDeColor(i))
    .find((f) => f && (f.bullets.length || f.descripcion));
  return publicarArmado(
    admin,
    accountId,
    tiktok,
    ctx,
    plantilla,
    fila,
    limite,
    colores.map((c, i) => ({
      color: c.color,
      fotos: fotosDeColor(i),
      tallas: c.tallas.map((t) => ({ talla: t.talla, sellerSku: t.skuTikTok })),
    })),
    { bullets: fichaTexto?.bullets ?? [], descripcion: fichaTexto?.descripcion ?? null },
  );
}

/** Una variante del producto ya resuelta: de dónde salen sus fotos y qué tallas lleva. */
interface EntradaArmado {
  color: string;
  /** nombre de la variante en TikTok; sin esto, el color en español */
  nombre?: string;
  fotos: string[];
  tallas: { talla: string; sellerSku: string }[];
}

/**
 * Lo común a cualquier fuente (Amazon por modelo, MELI por publicación):
 * sube las fotos, dibuja la guía de tallas, arma el cuerpo, crea el
 * producto y deja los SKUs nuevos en el catálogo de TikTok del ERP.
 */
async function publicarArmado(
  admin: any,
  accountId: string,
  tiktok: ClienteTikTok,
  ctx: ContextoCuenta,
  plantilla: PlantillaTikTok,
  fila: any,
  limite: number,
  entradas: EntradaArmado[],
  texto: { bullets: string[]; descripcion: string | null },
): Promise<ResultadoUno> {
  // 2. Subir las fotos a TikTok (las ya subidas en un intento anterior se reusan).
  const subidas: Record<string, string> = {
    ...(fila.resultado?.subidas ?? {}),
  };
  const urisPorColor: string[][] = [];
  for (let i = 0; i < entradas.length; i++) {
    const uris: string[] = [];
    for (const url of entradas[i].fotos.slice(0, FOTOS_POR_COLOR)) {
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

  // 2b. La guía de tallas (talla MX = largo en cm) dibujada y subida como
  //     imagen de size chart; si TikTok no la acepta, el producto sale sin
  //     ella y queda avisado (el texto va en la descripción de todos modos).
  const guia = guiaDeTallas(
    entradas.flatMap((c) => c.tallas.map((t) => t.talla)),
  );
  const avisosProducto: string[] = [];
  let guiaTallasUri: string | null = null;
  if (guia.length) {
    const llaveGuia = `guia:${guia.map((r) => r.talla).join(",")}`;
    if (subidas[llaveGuia]) guiaTallasUri = subidas[llaveGuia];
    else {
      try {
        const png = await dibujarGuiaTallas(String(fila.titulo), guia);
        let r = null as Awaited<ReturnType<typeof subirImagen>>;
        try {
          r = await subirImagen(
            tiktok,
            new Uint8Array(png),
            "image/png",
            "SIZE_CHART_IMAGE",
          );
        } catch (err) {
          if (!(err instanceof ErrorTikTok)) throw err;
          avisosProducto.push(
            `TikTok no aceptó la guía de tallas como SIZE_CHART_IMAGE (${err.message}); se intentó como imagen de descripción.`,
          );
          r = await subirImagen(
            tiktok,
            new Uint8Array(png),
            "image/png",
            "DESCRIPTION_IMAGE",
          );
        }
        if (!r) return { sinTiempo: true, parcial: { subidas } };
        subidas[llaveGuia] = r.uri;
        guiaTallasUri = r.uri;
      } catch (err) {
        avisosProducto.push(`Sin guía de tallas: ${(err as Error).message}`);
      }
    }
  }

  // 3. El cuerpo y la creación.
  const descripcionHtml = descripcionDesdeAmazon({
    bullets: texto.bullets,
    descripcion: texto.descripcion,
    titulo: String(fila.titulo),
    guiaTallas: textoGuiaTallas(guia),
  });
  const coloresAPublicar: ColorAPublicar[] = entradas.map((c, i) => ({
    color: c.color,
    nombre: c.nombre,
    imagenUri: urisPorColor[i][0] ?? null,
    tallas: c.tallas.map((t) => ({
      talla: t.talla,
      sellerSku: t.sellerSku,
      cantidad:
        ctx.publicadoPorSku.get(
          (ctx.amarrar(t.sellerSku).skuInterno ?? t.sellerSku).toUpperCase(),
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
        guiaTallasUri,
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
      avisos: [...creado.avisos, ...avisosProducto],
      guiaTallas: guiaTallasUri,
      subidas,
      plantilla: plantilla.productoId,
      categoria: plantilla.categoryId,
      imagenes: imagenesUri.length,
      colores: entradas.map((c) => c.nombre ?? c.color),
      cuerpo: {
        ...cuerpo,
        description: String(cuerpo.description).slice(0, 500),
      },
    },
  };
}

/**
 * Una publicación de MELI COMPLETA como un solo producto de TikTok: sus
 * modelos son las variantes («GT117 Café», «GT118 Negro»…), con las fotos
 * de cada variación de MELI, la descripción de la publicación y el SKU de
 * MELI tal cual. Lo que TikTok ya vende de esa publicación se salta.
 */
async function publicarUnoDeMeli(
  admin: any,
  accountId: string,
  tiktok: ClienteTikTok,
  ctx: ContextoCuenta,
  plantillas: Map<string, PlantillaTikTok>,
  fila: any,
  limite: number,
): Promise<ResultadoUno> {
  const itemId = String(fila.item_id ?? fila.modelo).trim().toUpperCase();
  const [variantes, enTikTok] = await Promise.all([
    variantesMeliDeLaBase(admin, accountId, itemId),
    skusEnTikTok(admin, accountId),
  ]);
  if (!variantes.length)
    throw new Error(`${itemId} ya no tiene variantes activas en el catálogo de MELI.`);
  const [resumen] = agruparPublicacionesMeli(variantes, enTikTok);
  const yaVende = new Set(resumen?.enTikTok ?? []);
  const porPublicar = variantes.filter((v) => !yaVende.has(v.sku));
  if (!porPublicar.length)
    throw new Error(`${itemId}: TikTok ya vende todas sus variantes.`);

  const meli = await clienteMeliDeCuenta(admin, accountId);
  if (!meli)
    throw new Error("Mercado Libre no está conectado: sin sus fotos no hay producto.");
  if (Date.now() > limite - 60_000) return { sinTiempo: true, parcial: fila.resultado ?? {} };
  const item = await meli.get<any>(`/items/${itemId}`, {
    attributes: "id,title,pictures,variations",
  });
  let descripcion: string | null = null;
  try {
    const d = await meli.get<any>(`/items/${itemId}/description`, undefined, { reintentos: 1 });
    descripcion = typeof d?.plain_text === "string" && d.plain_text.trim() ? d.plain_text.trim() : null;
  } catch {
    descripcion = null;
  }
  const colores = agruparVariantesMeli(porPublicar, {
    pictures: (item?.pictures ?? [])
      .map((p: any) => ({ id: String(p.id ?? ""), url: String(p.secure_url ?? p.url ?? "") }))
      .filter((p: { url: string }) => p.url),
    variations: (item?.variations ?? []).map((v: any) => ({
      id: String(v.id ?? ""),
      pictureIds: (v.picture_ids ?? []).map((x: unknown) => String(x)),
    })),
  });
  if (!colores.length) throw new Error(`${itemId}: no hay variantes con modelo y talla que publicar.`);

  const plantilla = await plantillaPara(
    admin,
    accountId,
    tiktok,
    colores[0].modelo,
    plantillas,
  );
  return publicarArmado(
    admin,
    accountId,
    tiktok,
    ctx,
    plantilla,
    fila,
    limite,
    colores.map((c) => ({ color: c.color, nombre: c.nombre, fotos: c.fotos, tallas: c.tallas })),
    { bullets: [], descripcion },
  );
}

/**
 * Corrige UN producto ya publicado por edición parcial: la guía de tallas
 * (dibujada con las tallas que el producto tiene en TikTok) y, si alguna
 * variante quedó con el código de color de Amazon (BEIGE, DK BROWN: los
 * primeros productos salieron antes de la traducción), su nombre en
 * español. Pedido del dueño, 30-sep-2026: «me corriges lo que subió mal».
 */
async function corregirPublicado(
  admin: any,
  accountId: string,
  tiktok: ClienteTikTok,
  fila: any,
  limite: number,
): Promise<void> {
  const id = Number(fila.id);
  const productId = String(fila.product_id);
  const resultado: Record<string, any> = { ...(fila.resultado ?? {}) };
  const intentos = Number(resultado.correccionIntentos ?? 0) + 1;
  const inicio = new Date().toISOString();
  const subidas: Record<string, string> = { ...(resultado.subidas ?? {}) };
  try {
    const crudo = await productoTikTok(tiktok, productId);
    if (!crudo) throw new ErrorSinTiempo();

    // 1. Qué atributo es la talla y cuál el color, y qué tallas tiene.
    const skus: any[] = crudo.skus ?? [];
    const esNumero = (v: unknown) =>
      /^\d{1,2}(\.\d)?$/.test(String(v ?? "").trim());
    const idsTalla = new Set<string>();
    for (const s of skus)
      for (const a of s.sales_attributes ?? [])
        if (esNumero(a?.value_name)) idsTalla.add(String(a.id));
    const tallas = skus.flatMap((s) =>
      (s.sales_attributes ?? [])
        .filter((a: any) => idsTalla.has(String(a.id)))
        .map((a: any) => String(a.value_name).trim()),
    );

    const cambios: Record<string, unknown> = {};
    const hecho: string[] = [];

    // 2. La guía de tallas: una sola imagen por juego de tallas.
    const guia = guiaDeTallas(tallas);
    if (guia.length) {
      const llave = `guia:${guia.map((r) => r.talla).join(",")}`;
      let uri = subidas[llave];
      if (!uri) {
        const png = await dibujarGuiaTallas(
          String(fila.titulo ?? crudo.title ?? fila.modelo),
          guia,
        );
        const r = await subirImagen(
          tiktok,
          new Uint8Array(png),
          "image/png",
          "SIZE_CHART_IMAGE",
        );
        if (!r) throw new ErrorSinTiempo();
        uri = r.uri;
        subidas[llave] = uri;
      }
      cambios.size_chart = { image: { uri } };
      hecho.push("guía de tallas");
    }

    // 3. Colores que quedaron en código de Amazon → español.
    const skusCorregidos: Record<string, unknown>[] = [];
    for (const s of skus) {
      let cambio = false;
      const attrs = (s.sales_attributes ?? []).map((a: any) => {
        const base: Record<string, unknown> = {
          id: String(a.id),
          name: String(a.name ?? ""),
          value_name: String(a.value_name ?? ""),
        };
        if (a.value_id) base.value_id = String(a.value_id);
        if (a.sku_img?.uri) base.sku_img = { uri: String(a.sku_img.uri) };
        if (idsTalla.has(String(a.id))) return base;
        const esp = nombreColorEspanol(String(a.value_name ?? ""));
        if (
          esp.traducido &&
          esp.nombre &&
          esp.nombre !== String(a.value_name)
        ) {
          cambio = true;
          // Un valor nuevo del atributo: sin value_id, TikTok lo crea.
          delete base.value_id;
          base.value_name = esp.nombre;
        }
        return base;
      });
      if (cambio)
        skusCorregidos.push({ id: String(s.id), sales_attributes: attrs });
    }
    if (skusCorregidos.length) {
      cambios.skus = skusCorregidos;
      hecho.push(`${skusCorregidos.length} variantes con el color en español`);
    }

    if (!Object.keys(cambios).length) {
      resultado.guiaTallas = "sin tallas";
      resultado.correccionEn = new Date().toISOString();
    } else {
      const respuesta = await editarProductoParcial(tiktok, productId, cambios);
      if (!respuesta) throw new ErrorSinTiempo();
      if (cambios.size_chart)
        resultado.guiaTallas = (cambios.size_chart as any).image.uri;
      resultado.correccionEn = new Date().toISOString();
      resultado.correccion = hecho;
      resultado.avisos = [
        ...(resultado.avisos ?? []),
        ...(respuesta?.warnings ?? [])
          .map((w: any) => String(w?.message ?? ""))
          .filter(Boolean),
      ];
    }
    delete resultado.correccionError;
    resultado.subidas = subidas;
    resultado.correccionIntentos = intentos;
    await admin
      .from("tiktok_publicaciones")
      .update({ resultado, actualizado_en: new Date().toISOString() })
      .eq("id", id);
    await bitacora(admin, accountId, "corregir-producto", inicio, "ok", {
      id,
      modelo: fila.modelo,
      productId,
      hecho,
      cambios: { ...cambios, skus: skusCorregidos.length },
    });
  } catch (err) {
    const mensaje = (err as Error).message;
    if (err instanceof ErrorSinTiempo) return; // sin contar el intento: se sigue en la próxima vuelta
    resultado.subidas = subidas;
    resultado.correccionIntentos = intentos;
    resultado.correccionError = mensaje;
    await admin
      .from("tiktok_publicaciones")
      .update({ resultado, actualizado_en: new Date().toISOString() })
      .eq("id", id);
    await bitacora(admin, accountId, "corregir-producto", inicio, "error", {
      id,
      modelo: fila.modelo,
      productId,
      error: mensaje,
      intentos,
    });
  }
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
    await admin.from("tiktok_sync_log").insert({
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
