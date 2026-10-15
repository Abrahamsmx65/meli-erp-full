/**
 * OFERTAS RELÁMPAGO de TikTok desde el panel (pedido del dueño, 15-oct-2026:
 * «una función para poder crear relámpagos en TikTok más rápido […] los
 * relámpagos generales de los que duran cada 3 días»).
 *
 * Lo que el API de promociones de TikTok (`/promotion/202309/activities`)
 * sí da: crear una actividad (tipo FLASHSALE, por VARIANTE), meterle
 * productos con el precio de oferta por talla y el tope de unidades por
 * talla y por comprador (1–99 o ilimitado), listar, editar, desactivar y
 * quitar productos. Lo que NO da, y se queda en el Seller Center: la oferta
 * relámpago de LIVE, las «existencias reservadas para el creador» y la
 * inscripción a campañas de la plataforma. Todo puro; el servicio pone la
 * base y el cliente de TikTok.
 */

/** Cuánto dura la oferta por omisión: la relámpago «de cada 3 días» del dueño. */
export const HORAS_POR_OMISION = 72;
/** Cuántos minutos después de ahora empieza por omisión (TikTok exige un inicio en el futuro). */
export const MINUTOS_DE_ARRANQUE = 15;
/** Tope máximo que TikTok acepta por talla o por comprador; -1 = sin tope. */
export const TOPE_MAXIMO = 99;
export const SIN_TOPE = -1;
/** TikTok acepta hasta 300 variantes por llamada al meter productos. */
export const SKUS_POR_LLAMADA = 300;
export const MAX_TITULO_OFERTA = 50;

export type NivelOferta = "live" | "normal" | "campana";

export interface SkuParaOferta {
  skuId: string;
  productId: string;
  sellerSku: string | null;
  skuInterno: string | null;
  estado: string | null;
  precio: number | null;
}

export interface ProductoParaOferta {
  modelo: string;
  productId: string;
  titulo: string | null;
  /** las variantes ACTIVAS de ese producto */
  skuIds: string[];
  /** precio de lista más común en TikTok hoy */
  precioLista: number | null;
}

/** "GT148-M BROWN-24-MX" → "GT148". */
function modeloDe(sku: string | null): string {
  return String(sku ?? "").trim().split("-")[0].toUpperCase();
}

/**
 * Por modelo, el producto ACTIVO de TikTok con más variantes y esas
 * variantes: lo que entra a la oferta. Un modelo publicado en dos productos
 * activos se queda con el grande; el chico se nombra aparte para avisar.
 */
export function productosParaOferta(skus: SkuParaOferta[], titulos: Map<string, string> = new Map()): ProductoParaOferta[] {
  const porModelo = new Map<string, Map<string, { skuIds: string[]; precios: Map<number, number> }>>();
  for (const s of skus) {
    if (String(s.estado ?? "").toUpperCase() !== "ACTIVATE" || !s.productId || !s.skuId) continue;
    const modelo = modeloDe(s.skuInterno ?? s.sellerSku);
    if (!modelo) continue;
    const productos = porModelo.get(modelo) ?? new Map();
    const acc = productos.get(s.productId) ?? { skuIds: [], precios: new Map<number, number>() };
    acc.skuIds.push(s.skuId);
    if (s.precio != null && s.precio > 0) acc.precios.set(s.precio, (acc.precios.get(s.precio) ?? 0) + 1);
    productos.set(s.productId, acc);
    porModelo.set(modelo, productos);
  }
  const salida: ProductoParaOferta[] = [];
  for (const [modelo, productos] of porModelo) {
    const [productId, acc] = [...productos].sort((a, b) => b[1].skuIds.length - a[1].skuIds.length)[0];
    const precioLista = [...acc.precios.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
    salida.push({ modelo, productId, titulo: titulos.get(productId) ?? null, skuIds: [...new Set(acc.skuIds)], precioLista });
  }
  return salida.sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));
}

/** El título de la oferta: corto, único por fecha y nivel, y dentro de los 50 caracteres de TikTok. */
export function tituloDeOferta(inicio: Date, nivel: NivelOferta, prefijo = "Relámpago GETAC"): string {
  const mx = new Date(inicio.getTime() - 6 * 3_600_000);
  const dd = String(mx.getUTCDate()).padStart(2, "0");
  const mm = String(mx.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(mx.getUTCHours()).padStart(2, "0");
  const mi = String(mx.getUTCMinutes()).padStart(2, "0");
  const sufijo = nivel === "live" ? " live" : nivel === "campana" ? " campaña" : "";
  return `${prefijo}${sufijo} ${dd}/${mm} ${hh}:${mi}`.slice(0, MAX_TITULO_OFERTA);
}

export interface VentanaOferta {
  /** segundos UNIX, como los pide TikTok */
  beginTime: number;
  endTime: number;
}

/** Inicio y fin en segundos UNIX; lanza si el inicio no es futuro o la duración no sirve. */
export function ventanaDeOferta(inicio: Date, horas: number, ahora: Date = new Date()): VentanaOferta {
  if (!Number.isFinite(inicio.getTime())) throw new Error("La fecha de inicio no es válida.");
  if (inicio.getTime() <= ahora.getTime()) throw new Error("La oferta tiene que empezar en el futuro (TikTok no acepta un inicio pasado).");
  if (!Number.isFinite(horas) || horas <= 0 || horas > 24 * 60) throw new Error("La duración tiene que ser de 1 hora a 60 días.");
  const beginTime = Math.floor(inicio.getTime() / 1000);
  return { beginTime, endTime: beginTime + Math.round(horas * 3600) };
}

/** Un tope como lo entiende TikTok: 1–99, o -1 sin tope. Vacío, cero o más de 99 = sin tope. */
export function topeParaTikTok(x: unknown): number {
  const n = Math.round(Number(x));
  if (!Number.isFinite(n) || n <= 0 || n > TOPE_MAXIMO) return SIN_TOPE;
  return n;
}

export interface ModeloEnOferta {
  modelo: string;
  productId: string;
  precio: number;
  skuIds: string[];
}

/** El cuerpo de «crear actividad» (relámpago por variante). */
export function cuerpoDeActividad(titulo: string, ventana: VentanaOferta): Record<string, unknown> {
  const t = titulo.replace(/\s+/g, " ").trim().slice(0, MAX_TITULO_OFERTA);
  if (!t) throw new Error("La oferta necesita un título.");
  return {
    title: t,
    activity_type: "FLASHSALE",
    product_level: "VARIATION",
    begin_time: ventana.beginTime,
    end_time: ventana.endTime,
  };
}

/**
 * Los productos de la oferta como los pide «Update Activity Product», en
 * LOTES de hasta 300 variantes: cada variante con su precio de oferta y los
 * topes. El precio va al peso con dos decimales, como lo manda el catálogo.
 */
export function lotesDeProductos(
  modelos: ModeloEnOferta[],
  topes: { porTalla: number; porComprador: number },
): Record<string, unknown>[][] {
  const lotes: Record<string, unknown>[][] = [];
  let actual: Record<string, unknown>[] = [];
  let enLote = 0;
  for (const m of modelos) {
    if (!(m.precio > 0)) throw new Error(`${m.modelo}: el precio de oferta tiene que ser mayor a cero.`);
    if (!m.skuIds.length) throw new Error(`${m.modelo}: no tiene variantes activas en TikTok.`);
    const skus = m.skuIds.map((id) => ({
      id,
      activity_price_amount: m.precio.toFixed(2),
      quantity_limit: topeParaTikTok(topes.porTalla),
      quantity_per_user: topeParaTikTok(topes.porComprador),
    }));
    // Un producto con más de 300 variantes no cabe en una llamada: se parte.
    for (let i = 0; i < skus.length; i += SKUS_POR_LLAMADA) {
      const pedazo = skus.slice(i, i + SKUS_POR_LLAMADA);
      if (enLote + pedazo.length > SKUS_POR_LLAMADA && actual.length) {
        lotes.push(actual);
        actual = [];
        enLote = 0;
      }
      actual.push({ id: m.productId, quantity_limit: SIN_TOPE, quantity_per_user: SIN_TOPE, skus: pedazo });
      enLote += pedazo.length;
    }
  }
  if (actual.length) lotes.push(actual);
  if (!lotes.length) throw new Error("La oferta no lleva ningún modelo.");
  return lotes;
}

export interface OfertaResumen {
  activityId: string;
  titulo: string;
  tipo: string;
  estado: string;
  nivelProducto: string | null;
  inicio: string | null;
  fin: string | null;
  productos: number;
  /** qué se puede hacer: TikTok manda IMMUTABLE cuando ya no se toca */
  inmutable: boolean;
}

const ESTADOS: Record<string, string> = {
  DRAFT: "borrador",
  NOT_START: "programada",
  ONGOING: "en curso",
  EXPIRED: "vencida",
  DEACTIVATED: "desactivada",
  NOT_EFFECTIVE: "cancelada por TikTok",
};

export function nombreDeEstado(estado: string | null | undefined): string {
  return ESTADOS[String(estado ?? "").toUpperCase()] ?? String(estado ?? "");
}

/** Una actividad cruda de TikTok (búsqueda o detalle) resumida para la pantalla. */
export function resumirActividad(crudo: any): OfertaResumen {
  const seg = (x: unknown) => (x != null && Number(x) > 0 ? new Date(Number(x) * 1000).toISOString() : null);
  const productos: any[] = Array.isArray(crudo?.products) ? crudo.products : [];
  return {
    activityId: String(crudo?.activity_id ?? crudo?.id ?? ""),
    titulo: String(crudo?.title ?? ""),
    tipo: String(crudo?.activity_type ?? ""),
    estado: String(crudo?.status ?? ""),
    nivelProducto: crudo?.product_level ? String(crudo.product_level) : null,
    inicio: seg(crudo?.begin_time),
    fin: seg(crudo?.end_time),
    productos: productos.length,
    inmutable: (Array.isArray(crudo?.activity_commands) ? crudo.activity_commands : []).some((c: unknown) => String(c).toUpperCase() === "IMMUTABLE"),
  };
}

/** Las ofertas que se enseñan arriba: en curso y programadas primero, luego lo demás por fecha. */
export function ordenarOfertas(ofertas: OfertaResumen[]): OfertaResumen[] {
  const peso = (e: string) => (e === "ONGOING" ? 0 : e === "NOT_START" ? 1 : e === "DRAFT" ? 2 : 3);
  return [...ofertas].sort((a, b) => peso(a.estado) - peso(b.estado) || String(b.inicio ?? "").localeCompare(String(a.inicio ?? "")));
}

/** El precio que le toca a un modelo por nivel, desde Precios para TikTok; null si ese modelo no tiene. */
export function precioDeNivel(niveles: { live: number; normal: number; campana: number } | undefined, nivel: NivelOferta): number | null {
  if (!niveles) return null;
  const p = niveles[nivel];
  return Number.isFinite(p) && p > 0 ? p : null;
}
