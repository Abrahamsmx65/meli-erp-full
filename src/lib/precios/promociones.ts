/**
 * Precios de MELI y Amazon desde Números (dueño, 13-oct-2026: «cambié el
 * precio en Números de GT251 GT253 GT254 GT255 GT257 GT258; ajusta según eso
 * las relámpago primero, los precios en la oferta de Buen Fin luego en la
 * oferta de todos los días, estos 3 en Mercado Libre; después ajusta en
 * Amazon el precio a PVP deal»; «Buen Fin es el normal», «oferta de todos
 * los días lleva el precio normal, redondea a .99»). Motor puro.
 *
 *   Relámpago (LIGHTNING)            = precio relámpago de Números
 *   Buen Fin (por nombre)            = PV normal redondeado a .99
 *   Oferta de todos los días (nombre)= PV normal redondeado a .99
 *   Amazon                           = PVP deal (redondeado a .99)
 *
 * Una promoción que no es ninguna de las tres NO se toca: se enseña para
 * que el dueño vea qué más tiene la publicación.
 */

export type ClasePromo = "relampago" | "buen_fin" | "todos_los_dias";

export const ORDEN_CLASES: ClasePromo[] = ["relampago", "buen_fin", "todos_los_dias"];

export const NOMBRE_CLASE: Record<ClasePromo, string> = {
  relampago: "Relámpago",
  buen_fin: "Buen Fin",
  todos_los_dias: "Oferta de todos los días",
};

/** Una promoción tal como la contesta /seller-promotions/items/{id}. */
export interface PromoMeli {
  id?: string | null;
  type?: string | null;
  status?: string | null;
  name?: string | null;
  price?: number | null;
  original_price?: number | null;
  min_discounted_price?: number | null;
  max_discounted_price?: number | null;
  suggested_discounted_price?: number | null;
  start_date?: string | null;
  finish_date?: string | null;
  /** relámpago: cuántos pares se pueden reservar */
  stock?: { min?: number | null; max?: number | null } | null;
  /** parte del descuento que pone MELI (% del precio original) */
  meli_percentage?: number | null;
  seller_percentage?: number | null;
}

/** Desde este precio el vendedor paga el envío en MELI México. */
export const UMBRAL_ENVIO_VENDEDOR = 299;

/**
 * Lo que MELI pone de su bolsa en una promoción con aporte: con él, la venta
 * se le cobra al vendedor como si fuera a precio + aporte.
 */
export function aporteMeli(p: PromoMeli): number {
  const pct = Number(p.meli_percentage ?? 0);
  const base = Number(p.original_price ?? 0);
  return pct > 0 && base > 0 ? (base * pct) / 100 : 0;
}

/**
 * Con el aporte de MELI una venta abajo de $299 se cobra como si fuera de
 * $299 o más, y entonces el vendedor paga el envío (~$20). Dueño,
 * 14-oct-2026, GT266 en Buen Fin 26: «arriba de 298.99 yo pago envío;
 * prefiero ponerlo a 298.99 de mi bolsa que me bajen $10 pero me lo cobren
 * como si lo vendí a $300». Esa promoción NO se toca: se queda su precio
 * propio.
 */
export function cruzaEnvioPorAporte(p: PromoMeli, nuevo: number | null): boolean {
  if (nuevo == null || nuevo >= UMBRAL_ENVIO_VENDEDOR) return false;
  const aporte = aporteMeli(p);
  return aporte > 0 && nuevo + aporte >= UMBRAL_ENVIO_VENDEDOR;
}

export interface Objetivos {
  modelo: string;
  relampago: number | null;
  normal: number | null;
  pvpDeal: number | null;
}

/** Sube al .99 del mismo peso: 532.49 → 532.99; 585.99 se queda. */
export function redondear99(x: number | null | undefined): number | null {
  if (x == null || !Number.isFinite(x) || x <= 0) return null;
  const centavos = Math.round(x * 100);
  const pesos = Math.floor(centavos / 100);
  return centavos % 100 === 99 ? centavos / 100 : pesos + 0.99;
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function clasificarPromo(p: PromoMeli): ClasePromo | null {
  if ((p.type ?? "").toUpperCase() === "LIGHTNING") return "relampago";
  const nombre = sinAcentos(p.name ?? "");
  if (/buen\s*fin/.test(nombre)) return "buen_fin";
  // «Activa Tus Descuentos» es la oferta de todos los días del dueño
  // (14-oct-2026: «puedes hacer que lo tome»).
  if (/todos\s*los\s*dias|activa\s*tus\s*descuentos/.test(nombre)) return "todos_los_dias";
  return null;
}

export function precioDeClase(clase: ClasePromo, o: Objetivos): number | null {
  return clase === "relampago" ? o.relampago : o.normal;
}

/** Ya inscrita en la promoción (se MODIFICA) o solo candidata (se INSCRIBE). */
export function estaInscrita(p: PromoMeli): boolean {
  return ["started", "pending", "active", "programmed"].includes((p.status ?? "").toLowerCase());
}

export type AccionPromo = "cambiar" | "inscribir" | "igual" | "no_se_toca" | "sin_precio" | "pagarias_envio";

export interface RenglonPromo {
  itemId: string;
  promoId: string | null;
  tipo: string;
  nombre: string;
  /** tipo + nombre de la promoción: con eso el dueño la asigna a mano */
  clave: string;
  estado: string;
  clase: ClasePromo | null;
  actual: number | null;
  nuevo: number | null;
  minimo: number | null;
  maximo: number | null;
  /**
   * El precio nuevo queda fuera del min–max que MELI mandó. Solo AVISA: el
   * 14-oct-2026 el dueño vio «fuera del rango» en Buen Fin 26 con un precio
   * que MELI sí le acepta en su pantalla; quien decide es MELI al recibirlo.
   */
  fueraDeRango: boolean;
  /** lo que pone MELI en la promoción (null = la paga toda el vendedor) */
  aporte: number | null;
  inicio: string | null;
  fin: string | null;
  /** relámpago candidata: pares que MELI deja reservar */
  stockMin: number | null;
  stockMax: number | null;
  accion: AccionPromo;
}

const igualPrecio = (a: number | null, b: number | null) =>
  a != null && b != null && Math.round(a * 100) === Math.round(b * 100);

/** Llave de una promoción para asignarla a mano: la misma en todas las publicaciones. */
export function clavePromo(p: PromoMeli): string {
  return `${(p.type ?? "").toUpperCase()}|${(p.name ?? "").trim()}`;
}

/**
 * Lo que el dueño eligió para cada promoción (`clavePromo` → clase o
 * "no_tocar"). Manda sobre lo que se reconoce por nombre: MELI llama a las
 * campañas como quiere («Activa Tus Descuentos») y solo el dueño sabe cuál
 * es su oferta de todos los días.
 */
export type Asignaciones = Record<string, ClasePromo | "no_tocar">;

export function planDePromo(itemId: string, p: PromoMeli, o: Objetivos, asignadas: Asignaciones = {}): RenglonPromo {
  const elegida = asignadas[clavePromo(p)];
  const clase = elegida === "no_tocar" ? null : elegida ?? clasificarPromo(p);
  const nuevo = clase ? precioDeClase(clase, o) : null;
  const inscrita = estaInscrita(p);
  const actual = inscrita ? p.price ?? null : null;
  const minimo = p.min_discounted_price ?? null;
  const maximo = p.max_discounted_price ?? null;
  let accion: AccionPromo;
  if (!clase) accion = "no_se_toca";
  else if (nuevo == null) accion = "sin_precio";
  else if (inscrita && igualPrecio(actual, nuevo)) accion = "igual";
  else if (cruzaEnvioPorAporte(p, nuevo)) accion = "pagarias_envio";
  else accion = inscrita ? "cambiar" : "inscribir";
  return {
    itemId,
    promoId: p.id ?? null,
    tipo: p.type ?? "",
    nombre: p.name ?? p.type ?? "",
    clave: clavePromo(p),
    estado: p.status ?? "",
    clase,
    actual,
    nuevo,
    minimo,
    maximo,
    aporte: aporteMeli(p) || null,
    fueraDeRango:
      nuevo != null && ((minimo != null && minimo > 0 && nuevo < minimo) || (maximo != null && maximo > 0 && nuevo > maximo)),
    inicio: p.start_date ?? null,
    fin: p.finish_date ?? null,
    stockMin: p.stock?.min ?? null,
    stockMax: p.stock?.max ?? null,
    accion,
  };
}

/** Relámpago primero, luego Buen Fin, luego todos los días; lo demás al final. */
/** Llave de un renglón (publicación + promoción) para los pares a reservar. */
export function claveRenglon(r: { itemId: string; promoId: string | null; tipo: string }): string {
  return `${r.itemId}|${r.promoId ?? r.tipo}`;
}

/** Pares que se reservan cuando MELI no dice el mínimo (con 1 de respaldo). */
export const PARES_RELAMPAGO_POR_OMISION = 5;

/**
 * Pares a reservar al inscribir un relámpago, en el orden en que se prueban:
 * lo que puso el dueño, si no el mínimo que pide MELI, y si MELI no dice
 * nada, 5 y luego 1 (dueño, 14-oct-2026: «la cantidad no me importa nunca,
 * siempre confirma las relámpago si cumplen con el precio»; ese día 299
 * candidatas se quedaron fuera por no traer mínimo). Lo que el dueño
 * escribe fuera del rango de MELI sí es error: es su número, no uno nuestro.
 */
export function stockParaRelampago(r: RenglonPromo, pedido: number | undefined): { intentos: number[] } | { error: string } {
  if (pedido != null) {
    if (!Number.isInteger(pedido) || pedido <= 0) return { error: "los pares a reservar deben ser un número entero" };
    if (r.stockMin != null && pedido < r.stockMin) return { error: `MELI pide reservar al menos ${r.stockMin} pares` };
    if (r.stockMax != null && r.stockMax > 0 && pedido > r.stockMax) return { error: `MELI deja reservar a lo más ${r.stockMax} pares` };
    return { intentos: [pedido] };
  }
  if (r.stockMin != null && r.stockMin > 0) return { intentos: [r.stockMin] };
  const tope = r.stockMax != null && r.stockMax > 0 ? r.stockMax : Infinity;
  return { intentos: [...new Set([Math.min(PARES_RELAMPAGO_POR_OMISION, tope), 1])] };
}

export function leerStocks(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (x && typeof x === "object")
    for (const [k, v] of Object.entries(x)) {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) out[k] = n;
    }
  return out;
}

export function esAsignacion(x: unknown): x is ClasePromo | "no_tocar" {
  return x === "no_tocar" || ORDEN_CLASES.includes(x as ClasePromo);
}

export function leerAsignaciones(x: unknown): Asignaciones {
  const out: Asignaciones = {};
  if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) if (esAsignacion(v)) out[k] = v;
  return out;
}

export function ordenarPlan(r: RenglonPromo[]): RenglonPromo[] {
  const peso = (x: RenglonPromo) => (x.clase ? ORDEN_CLASES.indexOf(x.clase) : ORDEN_CLASES.length);
  return [...r].sort((a, b) => peso(a) - peso(b) || a.itemId.localeCompare(b.itemId));
}

/** Modelo de un SKU de Amazon o MELI: lo que va antes del primer guion. */
export function modeloDeSku(sku: string): string {
  return sku.trim().toUpperCase().split(/[-_ ]/)[0] ?? "";
}

// ---------------------------------------------------------------------------
// Amazon: el precio y el PRECIO MÍNIMO van juntos
// ---------------------------------------------------------------------------

/** El mínimo queda más de 15 % abajo del precio (dueño, 14-oct-2026). */
export const DESCUENTO_MINIMO_AMAZON = 0.15;

/**
 * Precio mínimo del vendedor para un precio de lista: abajo del 85 % del
 * precio, en .99 (616.99 → 523.99). Dueño, 14-oct-2026: «cuando actualizo
 * el precio hay que actualizar también el precio mínimo para que sea más de
 * 15 % menor que el precio de lista».
 */
export function precioMinimoAmazon(precio: number): number {
  return Math.max(0.99, Math.floor(precio * (1 - DESCUENTO_MINIMO_AMAZON)) - 0.01);
}

type Oferta = Record<string, unknown>;
const conValor = (v: number) => [{ schedule: [{ value_with_tax: v }] }];
const valorDe = (x: unknown): number | null => {
  const v = (x as { schedule?: { value_with_tax?: unknown }[] }[] | undefined)?.[0]?.schedule?.[0]?.value_with_tax;
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};

/**
 * La oferta de Amazon (`purchasable_offer`) con el precio y el mínimo
 * nuevos. El parche REEMPLAZA el atributo completo, así que lo demás que la
 * publicación ya traía (máximo, oferta, otros mercados) se copia tal cual;
 * un máximo que quedaría abajo del precio nuevo se quita (Amazon rechazaría
 * la oferta).
 */
export function ofertaAmazon(actual: Oferta[] | undefined, marketplaceId: string, precio: number): Oferta[] {
  const lista = Array.isArray(actual) ? actual : [];
  const delMercado = lista.find((o) => o?.marketplace_id === marketplaceId);
  const otras = lista.filter((o) => o !== delMercado);
  const nueva: Oferta = { ...(delMercado ?? {}), marketplace_id: marketplaceId, currency: (delMercado?.currency as string) ?? "MXN" };
  nueva.our_price = conValor(precio);
  nueva.minimum_seller_allowed_price = conValor(precioMinimoAmazon(precio));
  const maximo = valorDe(nueva.maximum_seller_allowed_price);
  if (maximo != null && maximo < precio) delete nueva.maximum_seller_allowed_price;
  return [...otras, nueva];
}
