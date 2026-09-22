/**
 * El "corte lunes": primero TODO lo de antes de hoy.
 *
 * El lunes se despacha lo del viernes, sábado y domingo (y lo que venga de
 * más atrás). Regla del dueño (20-sep-2026): el primer corte se lleva TODO
 * lo pendiente hasta el domingo a las 23:59 de México —viernes, sábado,
 * domingo y cualquier cosa más vieja—, completo y solo, con su etiqueta, su
 * lista y su surtido; lo que se vendió HOY (el lunes) se va en un segundo
 * corte, que todavía tiene tiempo.
 *
 * La regla no está amarrada al lunes: un pedido es URGENTE cuando su día de
 * venta (en hora de México, UTC−6 fijo) es anterior al día de hoy. Corrido
 * un lunes da exactamente lo que pidió el dueño y cualquier otro día se
 * porta igual: lo de ayer y antes primero, lo de hoy después.
 *
 * Puro: recibe los pendientes con su fecha y el momento actual.
 */
import { diaMx } from "./ventas";

/** Cuántos días de antigüedad hacen urgente a un pedido: lo de ayer (México) ya lo es. */
export const DIAS_URGENTE = 1;

export interface PendienteConFecha {
  orderId: string;
  estado: string;
  /** cuándo lo hizo el cliente (ISO); sin fecha se trata como urgente */
  creadoEn?: string | null;
}

export interface Tandas<T> {
  /** el lunes: viernes, sábado, domingo y lo más viejo — todo lo de antes de hoy */
  urgentes: T[];
  /** lo vendido HOY (día de México) */
  resto: T[];
  /** el último día (México) que todavía es urgente: ayer */
  corte: string;
}

function diaSeguro(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? diaMx(new Date(t).toISOString()) : null;
}

/**
 * Parte los pendientes en dos tandas. `ahora` es el momento del corte (por
 * omisión, ya); el día de referencia se saca en hora de México.
 */
export function partirEnTandas<T extends PendienteConFecha>(
  pendientes: T[],
  ahora: Date = new Date(),
): Tandas<T> {
  const corte = diaMx(new Date(ahora.getTime() - DIAS_URGENTE * 86_400_000).toISOString());
  const urgentes: T[] = [];
  const resto: T[] = [];
  for (const p of pendientes ?? []) {
    const dia = diaSeguro(p.creadoEn);
    // Sin fecha no se puede saber si corre prisa: se manda con los urgentes,
    // que es el lado seguro (se despacha antes, no después).
    if (!dia || dia <= corte) urgentes.push(p);
    else resto.push(p);
  }
  return { urgentes, resto, corte };
}

/** ¿Hoy es lunes en México? (para ofrecer el corte partido sin que lo pidan) */
export function esLunesMx(ahora: Date = new Date()): boolean {
  return new Date(ahora.getTime() - 6 * 3_600_000).getUTCDay() === 1;
}

/** El texto con el que el corte anota un pedido que no alcanzó a confirmar por tiempo. */
export const ERROR_SIN_TIEMPO = "Se acabó el tiempo; entra al siguiente corte.";

/**
 * Cuántos pedidos se quedaron fuera de un corte SOLO por tiempo. El corte
 * del lunes lo usa para decidir si arranca la segunda tanda: si la primera
 * dejó pedidos de días anteriores sin cortar, lo de hoy NO va antes que
 * ellos (21-sep-2026: el corte #32 dejó 485 del fin de semana por tiempo y
 * el #33 se llevó los 205 del lunes de todos modos).
 */
export function contarSinTiempo(errores: { orderId: string; error: string }[]): number {
  return (errores ?? []).filter((e) => e.orderId && e.error === ERROR_SIN_TIEMPO).length;
}

/** Los pendientes en el orden en que se cortan: lo más viejo primero; sin fecha, al frente. */
export function ordenarPorAntiguedad<T extends PendienteConFecha>(pendientes: T[]): T[] {
  return [...(pendientes ?? [])].sort((a, b) => {
    const ta = a.creadoEn ? Date.parse(a.creadoEn) : NaN;
    const tb = b.creadoEn ? Date.parse(b.creadoEn) : NaN;
    const va = Number.isFinite(ta) ? ta : -Infinity;
    const vb = Number.isFinite(tb) ? tb : -Infinity;
    return va - vb || a.orderId.localeCompare(b.orderId);
  });
}

// ---------------------------------------------------------------------------
// Un corte que CONTINÚA otro se le une
// ---------------------------------------------------------------------------

export interface CorteContinuable {
  id: number;
  /** cuándo se hizo (ISO) */
  creadoEn: string;
  errores: { orderId: string; error: string }[];
  /** paquetes ya preparados en la estación: con alguno, las hojas ya están en uso */
  preparados: number;
}

/**
 * Cuando un corte se queda sin tiempo, lo que sobró entra al siguiente; y
 * ese siguiente NO es otro corte: es la continuación del mismo. Decisión
 * del dueño (21 y 22-sep-2026: «puedes agrupar los cortes que hice hoy
 * todos juntos», «agrupar todo en el corte 36 para que quede bien»):
 * tres hojas del mismo día con los modelos revueltos entre ellas es doble
 * trabajo. Así que si algún pedido que se va a cortar ahora quedó POR
 * TIEMPO en un corte de HOY (México) al que nadie le ha preparado nada,
 * el nuevo corte se UNE a ese en vez de abrir otro. Con algo ya preparado
 * no se une: sus hojas están impresas y a medio trabajar, y renumerarlas
 * dejaría el papel de la mesa sin cuadrar.
 *
 * Devuelve el id del corte al que unirse (el más reciente que aplique) o
 * null para abrir uno nuevo.
 */
export function corteQueContinua(cortes: CorteContinuable[], orderIds: string[], ahora: Date = new Date()): number | null {
  const hoy = diaMx(ahora.toISOString());
  const quiere = new Set(orderIds);
  const candidatos = (cortes ?? [])
    .filter((c) => c.preparados === 0 && diaSeguro(c.creadoEn) === hoy)
    .filter((c) => (c.errores ?? []).some((e) => e.orderId && e.error === ERROR_SIN_TIEMPO && quiere.has(e.orderId)))
    .sort((a, b) => Date.parse(b.creadoEn) - Date.parse(a.creadoEn) || b.id - a.id);
  return candidatos[0]?.id ?? null;
}

/**
 * Los errores del corte unido: los «se acabó el tiempo» de los pedidos
 * que esta vez SÍ se intentaron se quitan (ya tienen su resultado nuevo,
 * bueno o malo) y lo nuevo se agrega al final.
 */
export function erroresAlUnir(
  viejos: { orderId: string; error: string }[],
  nuevos: { orderId: string; error: string }[],
  intentados: Iterable<string>,
): { orderId: string; error: string }[] {
  const ahora = new Set(intentados);
  const quedan = (viejos ?? []).filter((e) => !(e.orderId && e.error === ERROR_SIN_TIEMPO && ahora.has(e.orderId)));
  return [...quedan, ...(nuevos ?? [])];
}

/**
 * ¿Hay que volver a lanzar el corte? Sí cuando la ronda dejó pedidos por
 * TIEMPO y además avanzó (confirmó a alguien): una ronda que no confirmó a
 * nadie y aun así se quedó sin tiempo es TikTok sin contestar, y repetirla
 * a ciegas no sirve. Decisión del dueño (22-sep-2026): «que no tenga que
 * picarle otra vez, sino automáticamente se vuelva a hacer el corte hasta
 * terminar» y «no quiero que pongas máximos»: no hay tope de rondas; se
 * para solo cuando ya no queda nada por tiempo o cuando una ronda no
 * avanza.
 */
export function hayQueSeguir(ronda: { pedidos: number; errores: { orderId: string; error: string }[] }[]): boolean {
  const sinTiempo = ronda.reduce((a, c) => a + contarSinTiempo(c.errores), 0);
  const confirmados = ronda.reduce((a, c) => a + (c.pedidos ?? 0), 0);
  return sinTiempo > 0 && confirmados > 0;
}
