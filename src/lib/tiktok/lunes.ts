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
