/**
 * Catálogo COMPLETO de GETAC para creadores: todo el calzado que hay en
 * Amazon, activo o inactivo, con fotos, por categoría (pedido del dueño,
 * 5-oct-2026: «un catálogo de todos los productos que tenemos aunque no
 * estén activos en TikTok, dividido por categorías […] todo lo que hay en
 * Amazon aunque no esté activo, solamente que tenga fotos»).
 *
 * Motor puro: agrupa `amazon_listings` por modelo → color, escoge qué ASINs
 * preguntarle al catálogo (las activas primero) y arma el resultado con lo
 * que el catálogo contestó. La categoría es la de Productos y costos y, si el
 * modelo no tiene, la clasificación de Amazon.
 */
import { esModeloDeCalzado, nombreColorEspanol, partirSkuAmazon, tituloLimpio } from "../tiktok/publicar";
import { compararTallas, elegirFotosPorColor } from "./catalogo";
import { PARAMETROS_POR_OMISION, renglonesDePrecio, type ParametrosPrecioTikTok } from "../tiktok/precios";

/** ASINs que se le preguntan al catálogo por color: con dos casi siempre hay una con fotos propias. */
export const ASINS_POR_COLOR = 2;

/**
 * Los GT viejos (hasta el GT100) no entran: dueño, 5-oct-2026, «hay muchos
 * modelos viejos que son hasta GT100 que no hay que meterlos». Los de otro
 * prefijo (MY2304, YH1909…) sí.
 */
export const GT_ULTIMO_VIEJO = 100;

export function esModeloVigente(modelo: string): boolean {
  const g = /^GT(\d+)/.exec(String(modelo ?? "").trim().toUpperCase());
  return !g || Number(g[1]) > GT_ULTIMO_VIEJO;
}

/** Lo que no tiene categoría ni en el ERP ni en Amazon. */
export const SIN_CATEGORIA = "Otros";

export interface FilaAmazon {
  seller_sku: string;
  asin: string | null;
  estado: string | null;
  titulo: string | null;
}

export interface ColorAmazon {
  codigo: string;
  /** ASINs en orden de preferencia (activos primero), hasta ASINS_POR_COLOR */
  asins: string[];
  tallas: string[];
  activo: boolean;
}

export interface ModeloAmazon {
  modelo: string;
  titulo: string | null;
  /** algún ASIN del modelo, para buscar su padre */
  asinCualquiera: string | null;
  colores: ColorAmazon[];
}

const activa = (estado: string | null) => String(estado ?? "").toLowerCase() === "active";

/** Agrupa el catálogo de Amazon por modelo y color. Solo calzado (las fundas no) y sin los GT viejos. */
export function agruparAmazon(filas: FilaAmazon[]): ModeloAmazon[] {
  const modelos = new Map<string, { titulo: string | null; asin: string | null; colores: Map<string, { asins: { asin: string; activo: boolean }[]; tallas: Set<string> }> }>();
  for (const f of filas) {
    const p = partirSkuAmazon(f.seller_sku);
    if (!p || !esModeloDeCalzado(p.modelo) || !esModeloVigente(p.modelo)) continue;
    const m = modelos.get(p.modelo) ?? { titulo: null, asin: null, colores: new Map() };
    if (!m.titulo && f.titulo) m.titulo = tituloLimpio(f.titulo) || null;
    if (!m.asin && f.asin) m.asin = f.asin;
    const c = m.colores.get(p.color) ?? { asins: [], tallas: new Set<string>() };
    c.tallas.add(p.talla);
    if (f.asin && !c.asins.some((a: { asin: string }) => a.asin === f.asin)) c.asins.push({ asin: f.asin, activo: activa(f.estado) });
    m.colores.set(p.color, c);
    modelos.set(p.modelo, m);
  }
  return [...modelos]
    .map(([modelo, m]) => ({
      modelo,
      titulo: m.titulo,
      asinCualquiera: m.asin,
      colores: [...m.colores]
        .map(([codigo, c]) => {
          const orden = c.asins.map((a, i) => ({ ...a, i })).sort((a, b) => Number(b.activo) - Number(a.activo) || a.i - b.i);
          return {
            codigo,
            asins: orden.slice(0, ASINS_POR_COLOR).map((a) => a.asin),
            tallas: [...c.tallas].sort(compararTallas),
            activo: orden.some((a) => a.activo),
          };
        })
        .sort((a, b) => a.codigo.localeCompare(b.codigo, "es")),
    }))
    .sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));
}

export interface FichaGuardada {
  /** fotos (links completos) */
  f: string[];
  /** clasificación de Amazon */
  c: string | null;
  /** título del catálogo */
  t: string | null;
}

export interface ColorCatalogo {
  color: string;
  fotos: string[];
  tallas: string[];
  tallasConStock: string[];
}

export interface ProductoCatalogo {
  productId: string;
  modelo: string;
  titulo: string;
  categoria: string;
  /** alguna talla activa en Amazon */
  activo: boolean;
  /** el relámpago NORMAL de Precios para TikTok (lo que la tarjeta enseña) */
  precioDesde: number | null;
  precioHasta: number | null;
  /** los tres niveles de Precios para TikTok; null sin relámpago de MELI ni «Mi precio» */
  precios: PreciosTikTok | null;
  bullets: string[];
  colores: ColorCatalogo[];
  pares: number;
  /** escondido desde el back (`tienda_catalogo_ajustes.oculto`): la página no lo enseña */
  oculto: boolean;
  /** pares en cajas cerradas en las bodegas (Industher, Caseshop, EnvioPack) */
  bodega: number;
  /** pares que vienen de China: en el mar y los pedidos que la bodega aún no ve */
  mar: number;
  /** pares en la bodega de TikTok (saldo del kardex) */
  tiktok: number;
  /** bodega + mar + TikTok: lo que la tarjeta enseña arriba */
  total: number;
}

export interface PreciosTikTok {
  live: number;
  normal: number;
  campana: number;
}

/**
 * El precio que tendría cada modelo en TikTok según la lista de Precios
 * para TikTok (dueño, 5-oct-2026: «aumentarle el precio que tendría en
 * TikTok según la lista de precios que tenemos»): la MISMA cuenta que esa
 * pantalla —relámpago de MELI (`meli_neto_relampago_por_modelo`), casilla
 * «quitar 10.5 %» y «Mi precio», que manda— con los parámetros de omisión.
 */
export function preciosTikTokPorModelo(
  relampago: { modelo: string; precio_relampago?: number | null; pares_relampago?: number | null; neto_relampago?: number | null }[],
  objetivos: { modelo: string; precio?: number | null; quitar_retencion?: boolean | null }[],
  p: ParametrosPrecioTikTok = PARAMETROS_POR_OMISION,
): Map<string, PreciosTikTok> {
  const entradas = new Map<string, Parameters<typeof renglonesDePrecio>[0][number]>();
  const nueva = (modelo: string) =>
    entradas.get(modelo) ?? { modelo, categoria: null, paresMeli: 0, netoMeli: 0, costo: null, precioTikTok: null };
  for (const r of relampago) {
    const modelo = String(r.modelo ?? "").toUpperCase();
    if (!modelo) continue;
    entradas.set(modelo, {
      ...nueva(modelo),
      precioRelampagoMeli: r.precio_relampago != null ? Number(r.precio_relampago) : null,
      paresRelampago: Number(r.pares_relampago ?? 0) || 0,
      netoRelampago: r.neto_relampago != null ? Number(r.neto_relampago) : null,
    });
  }
  for (const o of objetivos) {
    const modelo = String(o.modelo ?? "").toUpperCase();
    if (!modelo) continue;
    const precio = Number(o.precio);
    entradas.set(modelo, { ...nueva(modelo), miPrecio: Number.isFinite(precio) && precio > 0 ? precio : null, quitarRetencion: Boolean(o.quitar_retencion) });
  }
  const salida = new Map<string, PreciosTikTok>();
  for (const r of renglonesDePrecio([...entradas.values()], p)) {
    if (!r.niveles) continue;
    const de = (clave: string) => r.niveles!.find((n) => n.clave === clave)?.precio ?? 0;
    salida.set(r.modelo, { live: de("live"), normal: de("normal"), campana: de("campana") });
  }
  return salida;
}

export interface StockModelo {
  bodega: number;
  mar: number;
  tiktok: number;
}

/**
 * Pares por modelo: bodega y en camino de China (en el mar + pedidos que
 * la bodega aún no ve) desde los renglones de `inventario_cache` (los mismos
 * de Bodega y Planificación China), más la bodega de TikTok (saldo de su
 * kardex). El modelo es el primer pedazo del SKU, igual que en Amazon.
 */
export function stockPorModelo(
  renglones: { sku: string; enBodega?: number; enCamino?: number }[],
  kardexTikTok: { sku: string; saldo?: number | null }[] = [],
): Map<string, StockModelo> {
  const m = new Map<string, StockModelo>();
  const de = (sku: string) => {
    const modelo = String(sku ?? "").split("-")[0].trim().toUpperCase();
    if (!modelo) return null;
    const s = m.get(modelo) ?? { bodega: 0, mar: 0, tiktok: 0 };
    m.set(modelo, s);
    return s;
  };
  for (const r of renglones) {
    const s = de(r.sku);
    if (!s) continue;
    s.bodega += Math.max(0, Number(r.enBodega) || 0);
    s.mar += Math.max(0, Number(r.enCamino) || 0);
  }
  // La bodega de TikTok no está en la vista de inventario (construirCajas la descarta): sale de su kardex.
  for (const k of kardexTikTok) {
    const s = de(k.sku);
    if (s) s.tiktok += Math.max(0, Number(k.saldo) || 0);
  }
  return m;
}

/**
 * El catálogo con lo que el catálogo de Amazon contestó. Un color sin
 * ninguna foto no sale; un modelo sin colores con foto, tampoco.
 */
export function armarCatalogoAmazon(
  modelos: ModeloAmazon[],
  fichas: Map<string, FichaGuardada>,
  categoriaDe: Map<string, string | null>,
  tituloPadre: Map<string, string | null> = new Map(),
  extras: { ocultos?: Set<string>; stock?: Map<string, StockModelo>; precios?: Map<string, PreciosTikTok> } = {},
): ProductoCatalogo[] {
  const salida: ProductoCatalogo[] = [];
  for (const m of modelos) {
    const opciones = new Map<string, string[][]>();
    for (const c of m.colores) opciones.set(c.codigo, c.asins.map((a) => fichas.get(a)?.f ?? []));
    const fotos = elegirFotosPorColor(opciones);
    const colores = m.colores
      .filter((c) => fotos[c.codigo]?.length)
      .map((c) => ({ color: nombreColorEspanol(c.codigo).nombre, fotos: fotos[c.codigo].slice(0, 8), tallas: c.tallas, tallasConStock: [] as string[], activo: c.activo }))
      .sort((a, b) => Number(b.activo) - Number(a.activo) || a.color.localeCompare(b.color, "es"))
      .map(({ activo: _a, ...c }) => c);
    if (!colores.length) continue;
    const asins = m.colores.flatMap((c) => c.asins);
    const clasificacion = asins.map((a) => fichas.get(a)?.c).find(Boolean) ?? null;
    const tituloCatalogo = asins.map((a) => fichas.get(a)?.t).find(Boolean) ?? null;
    const titulo =
      tituloLimpio(m.asinCualquiera ? tituloPadre.get(m.asinCualquiera) : null) || tituloLimpio(tituloCatalogo) || m.titulo || m.modelo;
    salida.push({
      productId: `amz-${m.modelo}`,
      modelo: m.modelo,
      titulo,
      categoria: (categoriaDe.get(m.modelo) ?? "").trim() || clasificacion || SIN_CATEGORIA,
      activo: m.colores.some((c) => c.activo),
      precioDesde: extras.precios?.get(m.modelo)?.normal ?? null,
      precioHasta: extras.precios?.get(m.modelo)?.normal ?? null,
      precios: extras.precios?.get(m.modelo) ?? null,
      bullets: [],
      colores,
      pares: 0,
      oculto: extras.ocultos?.has(m.modelo) ?? false,
      bodega: extras.stock?.get(m.modelo)?.bodega ?? 0,
      mar: extras.stock?.get(m.modelo)?.mar ?? 0,
      tiktok: extras.stock?.get(m.modelo)?.tiktok ?? 0,
      total: (extras.stock?.get(m.modelo)?.bodega ?? 0) + (extras.stock?.get(m.modelo)?.mar ?? 0) + (extras.stock?.get(m.modelo)?.tiktok ?? 0),
    });
  }
  return salida;
}
