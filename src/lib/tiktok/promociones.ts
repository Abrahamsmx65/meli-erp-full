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

// ---------------------------------------------------------------------------
// Relámpagos CÍCLICOS: un modelo que SIEMPRE tiene relámpago programada
// ---------------------------------------------------------------------------
// Pedido del dueño, 15-oct-2026: «en cíclicos yo pongo un producto, cuál es
// el precio y el sistema se encarga de que siempre va a estar con relámpagos
// programadas; se pueden adelantar muchas y cada una dura máximo 72 horas».
//
// TikTok NO deja adelantar: un producto solo puede estar en UNA actividad
// viva o programada (17029022 «Resource Conflict: the product or sku
// conflicts with another ONGOING or NOT_START activity», 17 y 18-oct-2026:
// la segunda ventana de la cadena se rechazaba SIEMPRE, la actividad quedaba
// vacía en TikTok y el cron volvía a intentar la misma cada hora con
// 17029004 «name already in use»). Así que cada modelo cíclico lleva UNA
// relámpago a la vez: el fondo (cada 10 min) crea la siguiente en cuanto
// la que corre termina, arrancando en `MINUTOS_DE_ARRANQUE`.

/** TikTok deja una relámpago de hasta 72 h; el ciclo nunca pasa de ahí. */
export const HORAS_MAX_CICLICA = 72;
/** Cuántas ventanas (la que corre o la que sigue) puede tener un modelo: UNA, por la regla de TikTok de arriba. */
export const VENTANAS_ADELANTE = 1;
/**
 * Minutos entre que termina una relámpago cíclica y arranca la siguiente
 * (dueño, 19-oct-2026: «en el tiempo más temprano posible cuando se vence
 * la última, y el espacio entre una y otra de 2 minutos»). TikTok exige un
 * inicio en el futuro; si rechaza uno tan cercano, el servicio reintenta
 * con `MINUTOS_DE_ARRANQUE`.
 */
export const MINUTOS_ARRANQUE_CICLICA = 2;

/**
 * El error de TikTok en palabras para la pantalla (dueño, 19-oct-2026: «está
 * muy no profesional» viendo códigos y rutas). Lo crudo se queda en la
 * constancia de la ventana (`tiktok_promociones.error`).
 */
export function explicarErrorDeCiclica(modelo: string, mensaje: string): string {
  const m = String(mensaje ?? "");
  if (m.includes("17029022") || /ONGOING or NOT_START/i.test(m)) {
    return `TikTok ya tiene el ${modelo} en otra relámpago viva o programada; la cíclica entra cuando termine esa.`;
  }
  if (m.includes("17029004") || /already in use/i.test(m)) {
    return `El nombre de la relámpago ya existía en TikTok; se reintenta con otro nombre en la siguiente pasada.`;
  }
  if (/not connected|no está conectado/i.test(m)) return "TikTok Shop no está conectado.";
  const sinRuta = m.replace(/TikTok Shop \d+ en \/[^:]+: /g, "").replace(/Lote \d+ de \d+ \(\d+ productos\): /g, "");
  return sinRuta.length > 160 ? `${sinRuta.slice(0, 157)}…` : sinRuta;
}

export interface VentanaProgramada {
  inicio: Date;
  fin: Date;
}

/** Las horas de una cíclica: entre 1 y 72, 72 por omisión. */
export function horasDeCiclica(x: unknown): number {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return HORAS_MAX_CICLICA;
  return Math.min(HORAS_MAX_CICLICA, Math.round(n));
}

/** El título de una ventana cíclica: único por modelo y hora de inicio, dentro de los 50 caracteres. */
export function tituloDeCiclica(modelo: string, inicio: Date): string {
  return tituloDeOferta(inicio, "normal", `Cíclica ${String(modelo).trim().toUpperCase()}`);
}

/**
 * Las ventanas que FALTAN para que un modelo tenga `ventanasAdelante`
 * relámpagos vivas o programadas (una, por la regla de TikTok). Si no hay
 * ninguna viva, una nueva desde ahora + `MINUTOS_DE_ARRANQUE` de `horas`
 * (tope 72). Una ventana que ya terminó no cuenta; una que corre o que
 * empieza después, sí, y mientras exista no se crea nada: TikTok la
 * rechazaría. (Con más de una ventana pedida, se encadenan desde el fin de
 * la última; hoy no se usa.)
 */
export function ventanasQueFaltan(
  programadas: VentanaProgramada[],
  horas: number,
  ahora: Date = new Date(),
  ventanasAdelante: number = VENTANAS_ADELANTE,
  minutosDeArranque: number = MINUTOS_ARRANQUE_CICLICA,
): VentanaProgramada[] {
  const h = horasDeCiclica(horas);
  const vivas = programadas.filter((v) => v.fin.getTime() > ahora.getTime());
  const arranque = new Date(ahora.getTime() + minutosDeArranque * 60_000);
  let base = vivas.reduce((max, v) => (v.fin.getTime() > max.getTime() ? v.fin : max), arranque);
  if (base.getTime() < arranque.getTime()) base = arranque;
  const faltan: VentanaProgramada[] = [];
  for (let i = vivas.length; i < ventanasAdelante; i++) {
    const fin = new Date(base.getTime() + h * 3_600_000);
    faltan.push({ inicio: base, fin });
    base = fin;
  }
  return faltan;
}

/**
 * Cuándo termina la relámpago viva de un modelo (la que corre o la
 * programada que termina más tarde), o null si no tiene ninguna. El fondo
 * lo usa para esperar ese momento y crear la siguiente pegada.
 */
export function finDeLaViva(programadas: VentanaProgramada[], ahora: Date = new Date()): Date | null {
  let fin: Date | null = null;
  for (const v of programadas) {
    if (v.fin.getTime() <= ahora.getTime()) continue;
    if (!fin || v.fin.getTime() > fin.getTime()) fin = v.fin;
  }
  return fin;
}

// ---------------------------------------------------------------------------
// Qué relámpago tiene cada producto en TikTok (del detalle de la actividad)
// ---------------------------------------------------------------------------
// Dueño, 15-oct-2026: «que pueda ver el precio en la última relámpago y, si
// ya hay una como la del GT148, que la cíclica empiece desde que termine esa».
// El detalle de una actividad (`GET …/activities/{id}`) trae sus productos
// con el precio de oferta por variante; la búsqueda no.

export interface RelampagoDeProducto {
  activityId: string;
  titulo: string;
  estado: string;
  inicio: string | null;
  fin: string | null;
  /** el precio de oferta más repetido entre las variantes del producto en esa actividad */
  precio: number | null;
}

/** De un detalle crudo de actividad, el precio de oferta por producto (el más repetido entre sus variantes). */
export function preciosDeDetalle(crudo: any): Map<string, number | null> {
  const salida = new Map<string, number | null>();
  for (const p of Array.isArray(crudo?.products) ? crudo.products : []) {
    const id = String(p?.id ?? "");
    if (!id) continue;
    const cuenta = new Map<number, number>();
    const meter = (x: unknown) => {
      const n = Number(x);
      if (Number.isFinite(n) && n > 0) cuenta.set(n, (cuenta.get(n) ?? 0) + 1);
    };
    for (const s of Array.isArray(p?.skus) ? p.skus : []) meter(s?.activity_price?.amount);
    if (!cuenta.size) meter(p?.activity_price?.amount);
    let mejor: number | null = null;
    let veces = 0;
    for (const [precio, n] of cuenta) if (n > veces || (n === veces && mejor != null && precio < mejor)) [mejor, veces] = [precio, n];
    salida.set(id, mejor);
  }
  return salida;
}

/** De un resumen de actividad y su detalle, los renglones «producto → relámpago» que hay que recordar. */
export function relampagosDeActividad(resumen: OfertaResumen, detalle: any): { productId: string; relampago: RelampagoDeProducto }[] {
  const precios = preciosDeDetalle(detalle);
  return [...precios].map(([productId, precio]) => ({
    productId,
    relampago: { activityId: resumen.activityId, titulo: resumen.titulo, estado: resumen.estado, inicio: resumen.inicio, fin: resumen.fin, precio },
  }));
}

/** La relámpago más reciente de un producto: la que termina más tarde (en curso o programada primero; una vencida solo si no hay otra). */
export function ultimaRelampago(lista: RelampagoDeProducto[]): RelampagoDeProducto | null {
  const viva = (r: RelampagoDeProducto) => r.estado === "ONGOING" || r.estado === "NOT_START";
  const ordenadas = [...lista].sort((a, b) => {
    if (viva(a) !== viva(b)) return viva(a) ? -1 : 1;
    return (b.fin ? Date.parse(b.fin) : 0) - (a.fin ? Date.parse(a.fin) : 0);
  });
  return ordenadas[0] ?? null;
}

/** Las relámpagos VIVAS de un producto (en curso o programadas) como ventanas, para encadenar la cíclica después de ellas. */
export function ventanasVivasDeRelampagos(lista: RelampagoDeProducto[], ahora: Date = new Date()): VentanaProgramada[] {
  return lista
    .filter((r) => (r.estado === "ONGOING" || r.estado === "NOT_START") && r.inicio && r.fin && Date.parse(r.fin) > ahora.getTime())
    .map((r) => ({ inicio: new Date(r.inicio as string), fin: new Date(r.fin as string) }));
}
