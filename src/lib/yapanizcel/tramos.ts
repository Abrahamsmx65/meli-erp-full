/**
 * Qué tramos de ventas hay que bajar en esta corrida.
 *
 * La sincronización no cabe en una sola llamada cuando el catálogo es grande,
 * así que las ventas se bajan por tramos de 7 días y se apunta hasta dónde
 * van (`yz_sync_estado`). Cada corrida hace dos cosas, en este orden:
 *
 *   1. Recalcula lo RECIENTE: los últimos 7 días ya cubiertos más todo lo
 *      nuevo hasta hoy. Así una orden que cambió o un neto que llegó
 *      diferido se corrigen solos.
 *   2. Extiende HACIA ATRÁS, de 7 en 7, hasta cubrir el horizonte (90 días).
 *
 * Los tramos son contiguos por construcción: el reciente arranca 6 días
 * antes del último cubierto, y cada tramo hacia atrás termina el día
 * anterior al primero cubierto. Esta función es pura para poder probarla.
 */

export interface EstadoVentas {
  desde: string | null;
  hasta: string | null;
}

export interface Tramo {
  desde: string;
  hasta: string;
  tipo: "reciente" | "atras";
}

function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const DIAS_TRAMO = 7;
export const DIAS_HORIZONTE = 90;

export function planearTramos(estado: EstadoVentas, hoy: string, horizonte = DIAS_HORIZONTE): Tramo[] {
  const objetivoDesde = sumarDias(hoy, -(horizonte - 1));
  const tramos: Tramo[] = [];

  if (!estado.desde || !estado.hasta) {
    // Primera vez: el tramo reciente y luego todo hacia atrás.
    const desde = sumarDias(hoy, -(DIAS_TRAMO - 1));
    tramos.push({ desde: desde < objetivoDesde ? objetivoDesde : desde, hasta: hoy, tipo: "reciente" });
    let fin = sumarDias(desde, -1);
    while (fin >= objetivoDesde) {
      const ini = sumarDias(fin, -(DIAS_TRAMO - 1));
      tramos.push({ desde: ini < objetivoDesde ? objetivoDesde : ini, hasta: fin, tipo: "atras" });
      fin = sumarDias(ini, -1);
    }
    return tramos;
  }

  // Reciente: desde 6 días antes del último cubierto hasta hoy. Si el último
  // cubierto quedó muy atrás (días sin sincronizar), el tramo crece.
  const inicioReciente = sumarDias(estado.hasta, -(DIAS_TRAMO - 1));
  tramos.push({ desde: inicioReciente < objetivoDesde ? objetivoDesde : inicioReciente, hasta: hoy, tipo: "reciente" });

  let fin = sumarDias(estado.desde, -1);
  while (fin >= objetivoDesde) {
    const ini = sumarDias(fin, -(DIAS_TRAMO - 1));
    tramos.push({ desde: ini < objetivoDesde ? objetivoDesde : ini, hasta: fin, tipo: "atras" });
    fin = sumarDias(ini, -1);
  }
  return tramos;
}

/** El estado después de cubrir un tramo. */
export function avanzarEstado(estado: EstadoVentas, tramo: Tramo): EstadoVentas {
  const desde = !estado.desde || tramo.desde < estado.desde ? tramo.desde : estado.desde;
  const hasta = !estado.hasta || tramo.hasta > estado.hasta ? tramo.hasta : estado.hasta;
  return { desde, hasta };
}
