/**
 * La guardia de los horarios de recolección dentro de un corte.
 *
 * Para RECOLECCIÓN se le pide a TikTok el horario de cada paquete
 * (`handover_time_slots`). El 15-sep-2026 esa ruta contestó "Internal
 * error. Please try again" en TODOS los paquetes, y el corte se la pidió
 * paquete por paquete de todos modos: cada llamada fallida se comió sus
 * reintentos (2 + 4 + 8 segundos) y de 255 pedidos solo 52 alcanzaron a
 * confirmarse antes de que Vercel cortara. Los otros 203 se quedaron
 * esperando con el reloj de las 48 horas corriendo.
 *
 * Y no era un error del pedido: a la tienda le ACTIVARON la recolección
 * sin hora fija (dato del dueño, 15-sep-2026), así que no hay horario que
 * pedir y el paquete sale bien como recolección a secas. Esta guardia se
 * rinde a tiempo: después de `FALLOS_PARA_RENDIRSE` fallos seguidos deja
 * de preguntar en ese corte y los demás paquetes salen de una vez como
 * recolección sin horario, que es lo que la tienda tiene. Confirmar el
 * envío es lo urgente; el horario no. Se anota como NOTA del corte, no
 * como error, y una sola vez.
 */

/** Fallos SEGUIDOS del horario después de los cuales ya no se pregunta. */
export const FALLOS_PARA_RENDIRSE = 3;

export interface GuardiaHorarios {
  /** fallos seguidos; un éxito los pone en cero */
  seguidos: number;
  /** fallos en total dentro del corte */
  fallos: number;
  /** paquetes que se mandaron sin preguntar porque la guardia ya se rindió */
  saltados: number;
  /** el último error que contestó TikTok, para declararlo */
  ultimoError: string | null;
}

export function crearGuardia(): GuardiaHorarios {
  return { seguidos: 0, fallos: 0, saltados: 0, ultimoError: null };
}

/** ¿Todavía vale la pena preguntarle a TikTok el horario? */
export function debePreguntar(g: GuardiaHorarios): boolean {
  return g.seguidos < FALLOS_PARA_RENDIRSE;
}

export function anotarExito(g: GuardiaHorarios): void {
  g.seguidos = 0;
}

export function anotarFallo(g: GuardiaHorarios, error: string): void {
  g.seguidos += 1;
  g.fallos += 1;
  g.ultimoError = error;
}

export function anotarSalto(g: GuardiaHorarios): void {
  g.saltados += 1;
}

/**
 * Lo que se le dice al dueño cuando la guardia tuvo que actuar, UNA vez y
 * no cincuenta: cuántos paquetes salieron como recolección sin horario y
 * qué contestó TikTok. Es una nota, no un error: los pedidos entraron.
 */
export function avisoDeGuardia(g: GuardiaHorarios): string | null {
  const afectados = g.fallos + g.saltados;
  if (!afectados) return null;
  const causa = g.ultimoError ? ` (TikTok contestó: ${g.ultimoError})` : "";
  const rendida = g.saltados
    ? ` Después de ${FALLOS_PARA_RENDIRSE} fallos seguidos ya no se le preguntó a los demás, para que el corte alcanzara a confirmar todo.`
    : "";
  return `TikTok no dio horario de recolección para ${afectados} ${afectados === 1 ? "paquete" : "paquetes"}${causa}: salieron como recolección sin hora fija, que es como está la tienda.${rendida}`;
}
