/**
 * Lo que un SKU VENDE CUANDO TIENE STOCK: la demanda que usa el pedido a
 * China (decisión del dueño, 11-oct-2026: «si no tenía stock y jala tanto,
 * entonces sí deberíamos calcular según el stock alto»; y «quiero ya tener
 * el pedido bien armado por ti con tus cálculos, no por mí»).
 *
 * La demanda del plan de Full (`calcularDemanda`) corrige el agotamiento
 * dividiendo la venta entre los días con stock, la topa en 3× lo observado
 * y le suma una tendencia de hasta +50 %. Para un horizonte de 180 días
 * eso falla en los dos sentidos: el GT104 BLK vendía 560 pares al mes
 * surtido y el tope lo dejaba en 480; el GT104 NAVY nunca vendió más de
 * 800 surtido y la tendencia lo subía a 1,037.
 *
 * Aquí la regla es solo lo observado con stock:
 *   - cuenta únicamente los DÍAS SURTIDOS (stock al menos
 *     `FRACCION_DIA_SURTIDO` del día): un día con poco stock o agotado no
 *     diluye el promedio;
 *   - los días surtidos se parten en tandas POR CONTEO (los últimos 30
 *     surtidos, los 30 anteriores, el resto), no por calendario, y pesan
 *     50 / 30 / 20: si las últimas semanas surtidas son las mejores, esas
 *     mandan (la tendencia se sigue sin retraso), pero no se extrapola más
 *     allá de lo visto;
 *   - una oferta de una semana entra con su peso dentro de la tanda (7 de
 *     30 días al 50 %), no se vuelve la nueva normal; una oferta que dura
 *     el mes entero sí sube la demanda, y con razón;
 *   - sin `DIAS_SURTIDOS_MINIMOS` días surtidos no hay dato (null): el
 *     pedido a China cae a la demanda del plan de Full, como antes.
 */
import type { DiaStock } from "./types";

/** stock al menos esta fracción del día = día surtido */
export const FRACCION_DIA_SURTIDO = 0.75;
/** con menos días surtidos que esto el número no es confiable */
export const DIAS_SURTIDOS_MINIMOS = 14;
/** tamaño de cada tanda de días surtidos */
export const DIAS_POR_TANDA = 30;

export interface DemandaSurtida {
  /** pares por día vendidos en los días surtidos, ponderados por recencia; null sin datos suficientes */
  tasa: number | null;
  diasSurtidos: number;
  unidadesSurtidas: number;
  /** pares por día de la tanda más reciente (para enseñar «últimos 30 surtidos») */
  tasaReciente: number | null;
}

export function demandaConStock(
  dias: DiaStock[],
  pesos: number[] = [0.5, 0.3, 0.2],
  minimo = DIAS_SURTIDOS_MINIMOS,
): DemandaSurtida {
  const surtidos = dias.filter((d) => d.fraccionConStock >= FRACCION_DIA_SURTIDO);
  const unidadesSurtidas = surtidos.reduce((a, d) => a + d.unidades, 0);
  if (surtidos.length < minimo) {
    return { tasa: null, diasSurtidos: surtidos.length, unidadesSurtidas, tasaReciente: null };
  }

  // Tandas desde el final: la última tiene los días surtidos MÁS recientes.
  const tandas: { dias: number; unidades: number }[] = [];
  let fin = surtidos.length;
  for (let i = 0; i < pesos.length && fin > 0; i++) {
    const inicio = i === pesos.length - 1 ? 0 : Math.max(0, fin - DIAS_POR_TANDA);
    const trozo = surtidos.slice(inicio, fin);
    tandas.push({ dias: trozo.length, unidades: trozo.reduce((a, d) => a + d.unidades, 0) });
    fin = inicio;
  }

  let sumaPeso = 0;
  let sumaTasa = 0;
  tandas.forEach((t, i) => {
    if (t.dias <= 0) return;
    const w = pesos[i] ?? 0;
    sumaPeso += w;
    sumaTasa += w * (t.unidades / t.dias);
  });
  const tasa = sumaPeso > 0 ? sumaTasa / sumaPeso : unidadesSurtidas / surtidos.length;
  const reciente = tandas[0];
  return {
    tasa,
    diasSurtidos: surtidos.length,
    unidadesSurtidas,
    tasaReciente: reciente && reciente.dias > 0 ? reciente.unidades / reciente.dias : null,
  };
}
