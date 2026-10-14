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
  if (/todos\s*los\s*dias/.test(nombre)) return "todos_los_dias";
  return null;
}

export function precioDeClase(clase: ClasePromo, o: Objetivos): number | null {
  return clase === "relampago" ? o.relampago : o.normal;
}

/** Ya inscrita en la promoción (se MODIFICA) o solo candidata (se INSCRIBE). */
export function estaInscrita(p: PromoMeli): boolean {
  return ["started", "pending", "active", "programmed"].includes((p.status ?? "").toLowerCase());
}

export type AccionPromo = "cambiar" | "inscribir" | "igual" | "no_se_toca" | "sin_precio" | "fuera_de_rango" | "relampago_candidata";

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
  else if ((minimo != null && minimo > 0 && nuevo < minimo) || (maximo != null && maximo > 0 && nuevo > maximo)) accion = "fuera_de_rango";
  // Inscribir en un relámpago pide reservar stock y horario: eso se hace en MELI.
  else if (!inscrita && clase === "relampago") accion = "relampago_candidata";
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
    accion,
  };
}

/** Relámpago primero, luego Buen Fin, luego todos los días; lo demás al final. */
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
