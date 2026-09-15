/**
 * Catálogo de SKUs por canal, para descargarlo en Excel desde /skus.
 *
 * Tres listas SEPARADAS, cada una con lo que su canal sabe de cada SKU:
 *
 * - MELI calzado: `skus` (SKU, publicación, variación, código de Full,
 *   título, modelo/color/talla) + el FNSKU y ASIN de Amazon cuando el mismo
 *   par también se vende por FBA (amarre por `claveOrdenada`, como las
 *   etiquetas).
 * - MELI fundas (YAPANIZCEL): `yz_skus`, con diseño / modelo del celular /
 *   color. No hay talla ni Amazon.
 * - Amazon: la unión de `amazon_listings` (catálogo completo), `amazon_skus`
 *   (lo que ya vendió) y `amazon_inventario` (FBA, de donde sale el FNSKU).
 *   Se leen JUNTAS solo para el Excel: el plan de FBA sigue usando nada más
 *   `amazon_skus`, por la regla de la corrida despareja.
 *
 * Las funciones `armar*` son puras (se prueban solas); las `leer*` hacen las
 * consultas.
 */
import { traerTodo, type DB } from "../datos/repos";
import { buscarAmazon, claveOrdenada, mapaAmazon, type DatoAmazon } from "../etiquetas/resolver";
import { claveComparacion } from "../importar/sku";

export type Canal = "calzado" | "fundas" | "amazon";

export const CANALES: { canal: Canal; nombre: string; archivo: string }[] = [
  { canal: "calzado", nombre: "Mercado Libre · calzado", archivo: "skus-meli-calzado" },
  { canal: "fundas", nombre: "Mercado Libre · fundas (YAPANIZCEL)", archivo: "skus-meli-fundas" },
  { canal: "amazon", nombre: "Amazon", archivo: "skus-amazon" },
];

export function esCanal(x: unknown): x is Canal {
  return x === "calzado" || x === "fundas" || x === "amazon";
}

// ---------------------------------------------------------------------------
// Desglose de un SKU con las piezas en cualquier orden
// ---------------------------------------------------------------------------

const SUFIJOS_SITIO = new Set([
  "MX", "MLM", "AR", "MLA", "BR", "MLB", "CL", "MLC",
  "CO", "MCO", "PE", "MPE", "UY", "MLU", "US", "MX1",
]);

export interface Desglose {
  modelo: string | null;
  color: string | null;
  talla: string | null;
}

/**
 * MODELO-COLOR-TALLA o MODELO-TALLA-COLOR (Amazon a veces pone la talla
 * antes del color: GT128-23-BLK-MX). El modelo va primero siempre; la talla
 * es la única pieza numérica corta; el color es todo lo demás. Sin sufijo de
 * país.
 */
export function desglosarFlexible(sku: string): Desglose {
  const partes = sku.split("-").map((p) => p.trim()).filter(Boolean);
  if (partes.length === 0) return { modelo: null, color: null, talla: null };
  if (partes.length === 1) return { modelo: partes[0], color: null, talla: null };

  while (partes.length > 2 && SUFIJOS_SITIO.has(partes[partes.length - 1].toUpperCase())) {
    partes.pop();
  }

  const [modelo, ...resto] = partes;
  // Al final, la talla es cualquier número corto (como en `desglosarSku`).
  // En medio, solo de DOS dígitos: un "4" suelto es parte del modelo
  // (GT104-4-BLK), no una talla.
  const ultima = resto[resto.length - 1];
  const i = /^\d{1,2}(\.\d)?$/.test(ultima)
    ? resto.length - 1
    : resto.findIndex((p) => /^\d{2}(\.\d)?$/.test(p));
  if (i < 0) return { modelo, color: resto.join("-") || null, talla: null };
  const color = [...resto.slice(0, i), ...resto.slice(i + 1)].join("-");
  return { modelo, color: color || null, talla: resto[i] };
}

/** Orden natural: modelo, color, talla numérica, y el SKU como desempate. */
function compararFilas(
  a: { modelo: string | null; color: string | null; talla?: string | null; sku: string },
  b: { modelo: string | null; color: string | null; talla?: string | null; sku: string },
): number {
  const m = (a.modelo ?? "").localeCompare(b.modelo ?? "", "es", { numeric: true });
  if (m) return m;
  const c = (a.color ?? "").localeCompare(b.color ?? "", "es", { numeric: true });
  if (c) return c;
  const ta = Number(a.talla ?? NaN);
  const tb = Number(b.talla ?? NaN);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return a.sku.localeCompare(b.sku, "es", { numeric: true });
}

// ---------------------------------------------------------------------------
// MELI calzado
// ---------------------------------------------------------------------------

export interface SkuMeliCrudo {
  sku: string;
  item_id: string | null;
  variation_id: string | null;
  inventory_id: string | null;
  user_product_id: string | null;
  titulo: string | null;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  estado: string | null;
  precio: number | string | null;
  activo: boolean | null;
}

export interface FilaCalzado {
  sku: string;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  titulo: string | null;
  itemId: string | null;
  variationId: string | null;
  /** El código de Full (inventory_id): el que va en la etiqueta. */
  codigoFull: string | null;
  userProductId: string | null;
  estado: string | null;
  precio: number | null;
  /** Amazon, cuando el mismo par también está en FBA. */
  fnsku: string | null;
  skuAmazon: string | null;
  asin: string | null;
}

function numero(x: unknown): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function armarFilasCalzado(
  skus: SkuMeliCrudo[],
  amazon: Map<string, DatoAmazon>,
): FilaCalzado[] {
  const filas = skus.map((s): FilaCalzado => {
    const d = desglosarFlexible(s.sku);
    const amz = buscarAmazon(amazon, s.sku);
    return {
      sku: s.sku,
      modelo: s.modelo ?? d.modelo,
      color: s.color ?? d.color,
      talla: s.talla ?? d.talla,
      titulo: s.titulo,
      itemId: s.item_id,
      variationId: s.variation_id,
      codigoFull: s.inventory_id,
      userProductId: s.user_product_id,
      estado: s.activo === false ? "retirado" : s.estado,
      precio: numero(s.precio),
      fnsku: amz?.fnsku ?? null,
      skuAmazon: amz?.sku ?? null,
      asin: amz?.asin ?? null,
    };
  });
  return filas.sort(compararFilas);
}

export async function leerCatalogoCalzado(db: DB, accountId: string): Promise<FilaCalzado[]> {
  const [skus, amazon] = await Promise.all([
    traerTodo<SkuMeliCrudo>(
      db,
      "skus",
      "sku, item_id, variation_id, inventory_id, user_product_id, titulo, modelo, color, talla, estado, precio, activo",
      (q) => q.eq("account_id", accountId),
    ),
    mapaAmazon(db),
  ]);
  return armarFilasCalzado(skus, amazon);
}

// ---------------------------------------------------------------------------
// MELI fundas (YAPANIZCEL)
// ---------------------------------------------------------------------------

export interface SkuFundaCrudo {
  sku: string;
  item_id: string | null;
  variation_id: string | null;
  inventory_id: string | null;
  user_product_id: string | null;
  titulo: string | null;
  diseno: string | null;
  modelo: string | null;
  color: string | null;
  estado: string | null;
  precio: number | string | null;
}

export interface FilaFundas {
  sku: string;
  /** El diseño de la funda (499, 501…). */
  diseno: string | null;
  /** El modelo del CELULAR (iPhone 15, A06…). */
  modelo: string | null;
  color: string | null;
  titulo: string | null;
  itemId: string | null;
  variationId: string | null;
  codigoFull: string | null;
  userProductId: string | null;
  estado: string | null;
  precio: number | null;
}

export function armarFilasFundas(skus: SkuFundaCrudo[]): FilaFundas[] {
  const filas = skus.map(
    (s): FilaFundas => ({
      sku: s.sku,
      diseno: s.diseno,
      modelo: s.modelo,
      color: s.color,
      titulo: s.titulo,
      itemId: s.item_id,
      variationId: s.variation_id,
      codigoFull: s.inventory_id,
      userProductId: s.user_product_id,
      estado: s.estado,
      precio: numero(s.precio),
    }),
  );
  return filas.sort((a, b) => {
    const d = (a.diseno ?? "").localeCompare(b.diseno ?? "", "es", { numeric: true });
    if (d) return d;
    return compararFilas(a, b);
  });
}

export async function leerCatalogoFundas(db: DB, accountId: string): Promise<FilaFundas[]> {
  const skus = await traerTodo<SkuFundaCrudo>(
    db,
    "yz_skus",
    "sku, item_id, variation_id, inventory_id, user_product_id, titulo, diseno, modelo, color, estado, precio",
    (q) => q.eq("account_id", accountId),
  );
  return armarFilasFundas(skus);
}

// ---------------------------------------------------------------------------
// Amazon
// ---------------------------------------------------------------------------

export interface ListingCrudo {
  seller_sku: string;
  asin: string | null;
  /** Preguntado por SKU al API de publicaciones (migración 0047). */
  fnsku: string | null;
  titulo: string | null;
  estado: string | null;
  /** DEFAULT (envío propio) | AMAZON_NA (FBA) */
  canal: string | null;
  precio: number | string | null;
  cantidad: number | null;
}

export interface SkuAmazonCrudo {
  seller_sku: string;
  asin: string | null;
  fnsku: string | null;
  titulo: string | null;
  estado: string | null;
  precio: number | string | null;
}

export interface InventarioAmazonCrudo {
  seller_sku: string;
  asin: string | null;
  fnsku: string | null;
  disponible: number | null;
  total: number | null;
}

export interface FilaAmazon {
  sku: string;
  asin: string | null;
  fnsku: string | null;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  titulo: string | null;
  estado: string | null;
  /** "FBA" | "Envío propio" | null */
  logistica: string | null;
  precio: number | null;
  /** Disponible en FBA (del inventario); null si no está en el reporte. */
  disponibleFba: number | null;
  /** El SKU de MELI calzado que es el mismo par, si se amarra. */
  skuMeli: string | null;
}

function logisticaAmazon(canal: string | null): string | null {
  if (!canal) return null;
  const c = canal.toUpperCase();
  if (c.startsWith("AMAZON")) return "FBA";
  if (c === "DEFAULT") return "Envío propio";
  return canal;
}

/**
 * Índice de los SKUs de MELI por clave canónica y por piezas ordenadas, para
 * ponerle a cada SKU de Amazon su SKU de MELI (los dos pueden diferir en el
 * orden de las piezas y en el sufijo -MX).
 */
export function indexarSkusMeli(skusMeli: string[]): Map<string, string> {
  const ix = new Map<string, string>();
  for (const s of skusMeli) {
    const c = claveComparacion(s);
    const o = claveOrdenada(s);
    if (!ix.has(c)) ix.set(c, s);
    if (!ix.has(o)) ix.set(o, s);
  }
  return ix;
}

export function armarFilasAmazon(
  listings: ListingCrudo[],
  skus: SkuAmazonCrudo[],
  inventario: InventarioAmazonCrudo[],
  skusMeli: Map<string, string> = new Map(),
): FilaAmazon[] {
  const porSku = new Map<string, FilaAmazon>();
  const fila = (sellerSku: string): FilaAmazon => {
    let f = porSku.get(sellerSku);
    if (!f) {
      const d = desglosarFlexible(sellerSku);
      f = {
        sku: sellerSku,
        asin: null,
        fnsku: null,
        modelo: d.modelo,
        color: d.color,
        talla: d.talla,
        titulo: null,
        estado: null,
        logistica: null,
        precio: null,
        disponibleFba: null,
        skuMeli:
          skusMeli.get(claveComparacion(sellerSku)) ??
          skusMeli.get(claveOrdenada(sellerSku)) ??
          null,
      };
      porSku.set(sellerSku, f);
    }
    return f;
  };

  // El catálogo manda en título, estado, precio y logística.
  for (const l of listings) {
    if (!l.seller_sku) continue;
    const f = fila(l.seller_sku);
    f.asin = l.asin ?? f.asin;
    f.fnsku = l.fnsku ?? f.fnsku;
    f.titulo = l.titulo ?? f.titulo;
    f.estado = l.estado ?? f.estado;
    f.logistica = logisticaAmazon(l.canal) ?? f.logistica;
    f.precio = numero(l.precio) ?? f.precio;
  }
  // Lo vendido rellena lo que el catálogo no trae.
  for (const s of skus) {
    if (!s.seller_sku) continue;
    const f = fila(s.seller_sku);
    f.asin = f.asin ?? s.asin ?? null;
    f.fnsku = f.fnsku ?? s.fnsku ?? null;
    f.titulo = f.titulo ?? s.titulo ?? null;
    f.estado = f.estado ?? s.estado ?? null;
    f.precio = f.precio ?? numero(s.precio);
  }
  // El FNSKU bueno es el del inventario de FBA.
  for (const i of inventario) {
    if (!i.seller_sku) continue;
    const f = fila(i.seller_sku);
    f.asin = f.asin ?? i.asin ?? null;
    if (i.fnsku) f.fnsku = i.fnsku;
    f.disponibleFba = i.disponible ?? i.total ?? f.disponibleFba;
    if (!f.logistica) f.logistica = "FBA";
  }

  return [...porSku.values()].sort(compararFilas);
}

export async function leerCatalogoAmazon(
  db: DB,
  amazonAccountId: string,
  meliAccountId: string | null,
): Promise<FilaAmazon[]> {
  const acotar = (q: any) => q.eq("account_id", amazonAccountId);
  const [listings, skus, inventario, meli] = await Promise.all([
    traerTodo<ListingCrudo>(
      db,
      "amazon_listings",
      "seller_sku, asin, fnsku, titulo, estado, canal, precio, cantidad",
      acotar,
    ).catch(() =>
      traerTodo<ListingCrudo>(
        db,
        "amazon_listings",
        "seller_sku, asin, titulo, estado, canal, precio, cantidad",
        acotar,
      )
        .then((f) => f.map((x) => ({ ...x, fnsku: null })))
        .catch(() => [] as ListingCrudo[]),
    ),
    traerTodo<SkuAmazonCrudo>(
      db,
      "amazon_skus",
      "seller_sku, asin, fnsku, titulo, estado, precio",
      acotar,
    ).catch(() => [] as SkuAmazonCrudo[]),
    traerTodo<InventarioAmazonCrudo>(
      db,
      "amazon_inventario",
      "seller_sku, asin, fnsku, disponible, total",
      acotar,
    ).catch(() => [] as InventarioAmazonCrudo[]),
    meliAccountId
      ? traerTodo<{ sku: string }>(db, "skus", "sku", (q) => q.eq("account_id", meliAccountId)).catch(
          () => [] as { sku: string }[],
        )
      : Promise.resolve([] as { sku: string }[]),
  ]);
  return armarFilasAmazon(listings, skus, inventario, indexarSkusMeli(meli.map((m) => m.sku)));
}

// ---------------------------------------------------------------------------
// Resumen para la pantalla
// ---------------------------------------------------------------------------

export interface ResumenCanal {
  canal: Canal;
  nombre: string;
  conectado: boolean;
  /** SKUs en el catálogo del canal. */
  skus: number;
  /** Cuántos traen FNSKU (calzado: amarrados a Amazon; Amazon: en FBA). */
  conFnsku: number | null;
  /** Última vez que el canal se sincronizó (ISO) o null. */
  actualizadoEn: string | null;
}

async function contar(db: DB, tabla: string, filtrar: (q: any) => any): Promise<number> {
  const { count, error } = await filtrar(db.from(tabla).select("*", { count: "exact", head: true }));
  if (error) return 0;
  return count ?? 0;
}

async function ultimaFecha(db: DB, tabla: string, filtrar: (q: any) => any): Promise<string | null> {
  const { data } = await filtrar(db.from(tabla).select("actualizado_en"))
    .order("actualizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.actualizado_en as string | undefined) ?? null;
}

export async function resumenCatalogos(
  db: DB,
  cuentas: { calzado: string | null; fundas: string | null; amazon: string | null },
): Promise<ResumenCanal[]> {
  const nombre = (c: Canal) => CANALES.find((x) => x.canal === c)!.nombre;

  const calzado = async (): Promise<ResumenCanal> => {
    if (!cuentas.calzado) {
      return { canal: "calzado", nombre: nombre("calzado"), conectado: false, skus: 0, conFnsku: null, actualizadoEn: null };
    }
    const id = cuentas.calzado;
    const [skus, actualizadoEn] = await Promise.all([
      contar(db, "skus", (q) => q.eq("account_id", id)),
      ultimaFecha(db, "skus", (q) => q.eq("account_id", id)),
    ]);
    return { canal: "calzado", nombre: nombre("calzado"), conectado: true, skus, conFnsku: null, actualizadoEn };
  };

  const fundas = async (): Promise<ResumenCanal> => {
    if (!cuentas.fundas) {
      return { canal: "fundas", nombre: nombre("fundas"), conectado: false, skus: 0, conFnsku: null, actualizadoEn: null };
    }
    const id = cuentas.fundas;
    const [skus, actualizadoEn] = await Promise.all([
      contar(db, "yz_skus", (q) => q.eq("account_id", id)),
      ultimaFecha(db, "yz_skus", (q) => q.eq("account_id", id)),
    ]);
    return { canal: "fundas", nombre: nombre("fundas"), conectado: true, skus, conFnsku: null, actualizadoEn };
  };

  const amazon = async (): Promise<ResumenCanal> => {
    if (!cuentas.amazon) {
      return { canal: "amazon", nombre: nombre("amazon"), conectado: false, skus: 0, conFnsku: null, actualizadoEn: null };
    }
    const id = cuentas.amazon;
    const [listados, vendidos, conFnsku, actualizadoEn] = await Promise.all([
      contar(db, "amazon_listings", (q) => q.eq("account_id", id)),
      contar(db, "amazon_skus", (q) => q.eq("account_id", id)),
      contar(db, "amazon_inventario", (q) => q.eq("account_id", id).not("fnsku", "is", null)),
      ultimaFecha(db, "amazon_listings", (q) => q.eq("account_id", id)),
    ]);
    // El catálogo es el universo; si nunca se ha traído, lo vendido.
    return {
      canal: "amazon",
      nombre: nombre("amazon"),
      conectado: true,
      skus: Math.max(listados, vendidos),
      conFnsku,
      actualizadoEn,
    };
  };

  return Promise.all([calzado(), fundas(), amazon()]);
}
