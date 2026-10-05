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
  precioDesde: null;
  precioHasta: null;
  bullets: string[];
  colores: ColorCatalogo[];
  pares: number;
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
      precioDesde: null,
      precioHasta: null,
      bullets: [],
      colores,
      pares: 0,
    });
  }
  return salida;
}
