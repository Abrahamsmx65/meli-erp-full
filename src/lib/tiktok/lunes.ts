/**
 * El "corte lunes": primero lo que ya lleva días esperando.
 *
 * El lunes se despacha lo del viernes, sábado y domingo. Los pedidos del
 * viernes por la tarde y los del sábado son los que ya casi cumplen las 48
 * horas que TikTok da para despachar, así que ESOS van en el primer corte,
 * completo y solo; lo que se vendió domingo y lunes se va en un segundo
 * corte, que todavía tiene tiempo.
 *
 * La regla no está amarrada al lunes: un pedido es URGENTE cuando su día de
 * venta (en hora de México) quedó dos días o más atrás. Corrido un lunes da
 * exactamente lo que pidió el dueño —sábado y viernes en la primera tanda,
 * domingo y lunes en la segunda— y cualquier otro día se porta igual de
 * bien: lo viejo primero.
 *
 * Puro: recibe los pendientes con su fecha y el momento actual.
 */
import { diaMx } from "./ventas";

/** Cuántos días de antigüedad hacen urgente a un pedido. */
export const DIAS_URGENTE = 2;

export interface PendienteConFecha {
  orderId: string;
  estado: string;
  /** cuándo lo hizo el cliente (ISO); sin fecha se trata como urgente */
  creadoEn?: string | null;
}

export interface Tandas<T> {
  /** viernes y sábado el lunes: dos días o más de antigüedad */
  urgentes: T[];
  /** domingo y lunes: lo de ayer y hoy */
  resto: T[];
  /** el día (México) desde el cual un pedido YA NO es urgente */
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
