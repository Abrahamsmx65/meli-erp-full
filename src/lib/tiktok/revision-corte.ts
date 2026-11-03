/**
 * La revisión ANTES de confirmar un corte (Despacho de TikTok): el número
 * que se enseña sale de la simulación que ya existe (`simularCorte`), no se
 * inventa. La simulación no sabe de modos: siempre trae TODO lo pendiente
 * (con el filtro de modelo y el vendedor) y la partición en tandas; aquí se
 * lee lo que entraría con cada modo.
 *
 * - «todo» = «Hacer corte»: todos los pendientes.
 * - «ayer»: la primera tanda (hasta ayer a las 23:59 de México y lo más
 *   viejo); lo de hoy se queda.
 * - «lunes»: las dos tandas, en dos cortes.
 *
 * La defensa (lo que se cancela por stock y lo que queda en duda) la calcula
 * la simulación sobre TODO lo pendiente; con «ayer» no se puede partir por
 * tanda (los pedidos de la simulación no traen fecha), así que se declara
 * como de todo lo pendiente.
 */

export type ModoCorte = "ayer" | "lunes" | "todo";

/** Lo que la pantalla lee de `SimulacionCorte` (solo lo necesario). */
export interface SimulacionParaRevisar {
  pedidos: { pares: unknown[]; bloqueados?: unknown[]; aviso?: string | null }[];
  totalPares: number;
  tandas?: { urgentes: number; resto: number; corte: string } | null;
  porModelo?: { revueltos?: { pedidos: number } } | null;
}

export interface RevisionCorte {
  /** pedidos que el corte de ese modo toma */
  entran: number;
  /** pares de esos pedidos; null cuando la simulación no los puede partir (corte ayer con pedidos de hoy) */
  pares: number | null;
  /** corte ayer: los de hoy que se quedan sin corte */
  seQuedanHoy: number;
  /** corte lunes: cuántos van en el primer corte y cuántos en el segundo */
  primerCorte: number;
  segundoCorte: number;
  /** el día de corte de las tandas (AAAA-MM-DD, hora de México) */
  diaCorte: string | null;
  /** pedidos completos que se cancelan en TikTok por falta de stock */
  seCancelan: number;
  /** pedidos que se confirman sin un renglón (ese renglón se cancela) */
  seCancelanEnParte: number;
  /** pedidos con stock en duda: se quedan fuera sin cancelar */
  enDuda: number;
  /** la defensa se contó sobre todo lo pendiente, no solo sobre lo que entra con este modo */
  defensaDeTodoLoPendiente: boolean;
  /** pedidos con más de un modelo (de todos los pendientes) */
  revueltos: number;
}

/** El aviso con el que `simularCorte` marca un pedido con stock en duda. */
const PREFIJO_EN_DUDA = "Stock en duda";

export function revisarSimulacion(sim: SimulacionParaRevisar, modo: ModoCorte): RevisionCorte {
  const pedidos = sim.pedidos ?? [];
  let seCancelan = 0;
  let seCancelanEnParte = 0;
  let enDuda = 0;
  for (const p of pedidos) {
    const bloqueados = p.bloqueados?.length ?? 0;
    if (bloqueados) {
      if (p.pares.length) seCancelanEnParte++;
      else seCancelan++;
    } else if (p.aviso?.startsWith(PREFIJO_EN_DUDA)) {
      enDuda++;
    }
  }
  const total = pedidos.length;
  const urgentes = sim.tandas?.urgentes ?? total;
  const resto = sim.tandas?.resto ?? 0;
  const entran = modo === "ayer" ? urgentes : total;
  return {
    entran,
    pares: modo === "ayer" && resto > 0 ? null : sim.totalPares,
    seQuedanHoy: modo === "ayer" ? resto : 0,
    primerCorte: modo === "lunes" ? urgentes : 0,
    segundoCorte: modo === "lunes" ? resto : 0,
    diaCorte: sim.tandas?.corte ?? null,
    seCancelan,
    seCancelanEnParte,
    enDuda,
    defensaDeTodoLoPendiente: modo === "ayer" && resto > 0,
    revueltos: sim.porModelo?.revueltos?.pedidos ?? 0,
  };
}

/** Un corte terminado, para la línea de cierre. */
export interface CierreDeCorte {
  corteId: number;
  numero: number;
  /** pedidos que entraron en ESTE clic (todas las rondas) */
  pedidos: number;
}

/**
 * Junta las respuestas de todas las rondas de un clic por corte: cada ronda
 * que se UNE a un corte trae solo lo que le sumó, así que se acumula. Una
 * ronda sin corte guardado (nadie entró) no cuenta.
 */
export function cierresDeRondas(rondas: { corteId?: number | null; numero?: number | null; pedidos?: number | null }[]): CierreDeCorte[] {
  const porCorte = new Map<number, CierreDeCorte>();
  for (const r of rondas) {
    if (r.corteId == null) continue;
    const previo = porCorte.get(r.corteId);
    if (previo) previo.pedidos += r.pedidos ?? 0;
    else porCorte.set(r.corteId, { corteId: r.corteId, numero: r.numero ?? 0, pedidos: r.pedidos ?? 0 });
  }
  return [...porCorte.values()];
}
