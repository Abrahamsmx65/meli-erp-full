/**
 * NÚMEROS: el precio de cada modelo en MELI, Amazon y TikTok calculado con
 * el costo del ÚLTIMO contenedor (dueño, 11-oct-2026: «ya no quiero
 * actualizar la sección de Números, quiero que tú hagas todos los cálculos
 * de los modelos según el tipo de cambio que pagué»). Motor puro.
 *
 * Las fórmulas son las de su sheet «Números» (pestaña CALZADO), columna
 * por columna:
 *   ganancia relámpago = PR − 15 % PR − envío MELI [− (PR / 1.16) × 10.5 %] − costo
 *   PV normal          = PR × 1.065 (o el que fije el dueño)
 *   recibir en Amazon  = costo + ganancia relámpago
 *   PVP Amazon sin ads = (recibir + envío Amazon) / (1 − 0.2405205)
 *   PVP Amazon deal    = PVP × 1.12 (o el que fije el dueño)
 *   TikTok lives       = (recibir + extra) / (1 − comisión)   (8 y 0.24 casi siempre)
 *   TikTok oferta      = lives × 1.11 (o 1.06)
 *   TikTok relámpago   = oferta × 0.95
 * La retención del 10.5 % (IVA 8 % + ISR 2.5 % sobre la base sin IVA) solo
 * en los modelos marcados. El costo NO lleva comisiones ni gastos: son
 * gasto operativo (decisión del dueño).
 */

export const PARAMETROS_NUMEROS = {
  comisionMeli: 0.15,
  factorPvNormal: 1.065,
  retencion: 0.105,
  iva: 1.16,
  comisionAmazon: 0.2405205,
  factorDeal: 1.12,
  factorRelampagoTikTok: 0.95,
} as const;

export interface EntradaNumeros {
  modelo: string;
  envioMeli: number | null;
  precioRelampago: number | null;
  pvNormal: number | null;
  retencion: boolean;
  envioAmazon: number | null;
  pvpDeal: number | null;
  tiktokExtra: number;
  tiktokComision: number;
  tiktokOferta: number;
}

export interface ResultadoNumeros {
  ganancia: number | null;
  porcentaje: number | null;
  pvNormal: number | null;
  gananciaNormal: number | null;
  recibirAmazon: number | null;
  pvpAmazon: number | null;
  pvpDeal: number | null;
  tiktokLives: number | null;
  tiktokOferta: number | null;
  tiktokRelampago: number | null;
}

export const ENTRADA_VACIA: Omit<EntradaNumeros, "modelo"> = {
  envioMeli: null,
  precioRelampago: null,
  pvNormal: null,
  retencion: false,
  envioAmazon: null,
  pvpDeal: null,
  tiktokExtra: 8,
  tiktokComision: 0.24,
  tiktokOferta: 1.11,
};

function gananciaMeli(precio: number, envio: number, retencion: boolean, costo: number): number {
  const P = PARAMETROS_NUMEROS;
  return precio - precio * P.comisionMeli - envio - (retencion ? (precio / P.iva) * P.retencion : 0) - costo;
}

export function calcularNumeros(e: EntradaNumeros, costo: number | null): ResultadoNumeros {
  const P = PARAMETROS_NUMEROS;
  const vacio: ResultadoNumeros = {
    ganancia: null,
    porcentaje: null,
    pvNormal: null,
    gananciaNormal: null,
    recibirAmazon: null,
    pvpAmazon: null,
    pvpDeal: null,
    tiktokLives: null,
    tiktokOferta: null,
    tiktokRelampago: null,
  };
  const pr = e.precioRelampago;
  const pvNormal = e.pvNormal ?? (pr != null ? pr * P.factorPvNormal : null);
  if (costo == null || pr == null) return { ...vacio, pvNormal };
  const envio = e.envioMeli ?? 0;
  const ganancia = gananciaMeli(pr, envio, e.retencion, costo);
  const gananciaNormal = pvNormal != null ? gananciaMeli(pvNormal, envio, e.retencion, costo) : null;
  const recibirAmazon = costo + ganancia;
  const pvpAmazon = e.envioAmazon != null ? (recibirAmazon + e.envioAmazon) / (1 - P.comisionAmazon) : null;
  const pvpDeal = e.pvpDeal ?? (pvpAmazon != null ? pvpAmazon * P.factorDeal : null);
  const tiktokLives = e.tiktokComision < 1 ? (recibirAmazon + e.tiktokExtra) / (1 - e.tiktokComision) : null;
  const tiktokOferta = tiktokLives != null ? tiktokLives * e.tiktokOferta : null;
  return {
    ganancia,
    porcentaje: costo > 0 ? ganancia / costo : null,
    pvNormal,
    gananciaNormal,
    recibirAmazon,
    pvpAmazon,
    pvpDeal,
    tiktokLives,
    tiktokOferta,
    tiktokRelampago: tiktokOferta != null ? tiktokOferta * P.factorRelampagoTikTok : null,
  };
}
