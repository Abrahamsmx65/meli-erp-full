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
 *
 * CON LO REAL (mismo día: «en vez de calcular con mis estimaciones de
 * comisión y costo de envío, ¿lo puedes calcular con lo real?»): cuando el
 * modelo vendió lo suficiente en los últimos 30 días, cada canal usa lo que
 * la plataforma COBRÓ de verdad (`TarifasReales`, de los RPC
 * `*_tarifas_por_modelo`) en vez de la estimación del dueño:
 *   MELI   ganancia = PR × (1 − comisión real − retención real) − envío real − costo
 *          (retención efectiva: en REVENTA no hay; solo la venta directa la trae)
 *   Amazon PVP = (recibir + FBA real + promociones/otras reales) / (1 − comisión real − retención real)
 *   TikTok lives = (recibir + cargo fijo por par) / (1 − lo que TikTok se queda)
 * Sin ventas suficientes, la estimación de siempre, y se declara cuál se usó.
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

/** Mínimo de pares vendidos en el periodo para creerle a lo real. */
export const PARES_MINIMOS_REALES = 10;
/** Cargo fijo de TikTok por par (sale aparte de lo que se queda en %). */
export const FIJO_TIKTOK = 6;

export interface TarifasReales {
  meli?: { pares: number; paresDirecta: number; comisionPct: number | null; envioPar: number | null; retencionPct: number | null; netoPar: number | null };
  amazon?: { unidades: number; precioPar: number | null; comisionPct: number | null; retencionPct: number | null; fbaPar: number | null; otrosPar: number | null; netoPar: number | null };
  tiktok?: { pares: number; precioPar: number | null; pagoPar: number | null; afiliadoPct: number | null };
}

/** Lo que de verdad se usó en cada canal (real o estimado) para enseñarlo. */
export interface UsadoNumeros {
  meli: { fuente: "real" | "estimado"; comisionPct: number; envio: number; retencionPct: number };
  amazon: { fuente: "real" | "estimado"; pctTotal: number; porPar: number | null };
  tiktok: { fuente: "real" | "estimado"; pctTotal: number; fijo: number };
}

export interface ResultadoNumeros {
  ganancia: number | null;
  /**
   * Lo que MELI DEPOSITÓ de verdad por par en 30 días (reventa incluida: ahí
   * MELI paga precio − comisión − envío sin retenciones) y lo que dejó sobre
   * el costo. Es dinero real a los precios que se vendió, no al relámpago:
   * se enseña, pero los precios de Amazon y TikTok siguen saliendo de la
   * ganancia al relámpago.
   */
  recibidoMeli: { porPar: number; pares: number; ganancia: number | null } | null;
  porcentaje: number | null;
  pvNormal: number | null;
  gananciaNormal: number | null;
  recibirAmazon: number | null;
  pvpAmazon: number | null;
  pvpDeal: number | null;
  tiktokLives: number | null;
  tiktokOferta: number | null;
  tiktokRelampago: number | null;
  usado: UsadoNumeros;
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

/** Qué tasas usa cada canal: lo real si hay ventas suficientes; si no, la estimación del dueño. */
export function tasasUsadas(e: EntradaNumeros, reales?: TarifasReales | null): UsadoNumeros {
  const P = PARAMETROS_NUMEROS;
  const m = reales?.meli;
  const meliReal = m != null && m.pares >= PARES_MINIMOS_REALES;
  const meli = meliReal
    ? {
        fuente: "real" as const,
        comisionPct: m!.comisionPct ?? P.comisionMeli,
        // El envío solo se ve en la venta directa; con muy pocas, el estimado.
        envio: m!.envioPar != null && m!.paresDirecta >= 5 ? m!.envioPar : e.envioMeli ?? 0,
        retencionPct: m!.retencionPct ?? 0,
      }
    : {
        fuente: "estimado" as const,
        comisionPct: P.comisionMeli,
        envio: e.envioMeli ?? 0,
        retencionPct: e.retencion ? P.retencion / P.iva : 0,
      };
  const a = reales?.amazon;
  const amazonReal = a != null && a.unidades >= PARES_MINIMOS_REALES && a.comisionPct != null;
  const amazon = amazonReal
    ? { fuente: "real" as const, pctTotal: (a!.comisionPct ?? 0) + (a!.retencionPct ?? 0), porPar: (a!.fbaPar ?? 0) + (a!.otrosPar ?? 0) }
    : { fuente: "estimado" as const, pctTotal: P.comisionAmazon, porPar: e.envioAmazon };
  const t = reales?.tiktok;
  const tiktokReal = t != null && t.pares >= PARES_MINIMOS_REALES && t.precioPar != null && t.pagoPar != null && t.precioPar > 0;
  const tiktok = tiktokReal
    ? { fuente: "real" as const, pctTotal: 1 - (t!.pagoPar! + FIJO_TIKTOK) / t!.precioPar!, fijo: FIJO_TIKTOK }
    : { fuente: "estimado" as const, pctTotal: e.tiktokComision, fijo: e.tiktokExtra };
  return { meli, amazon, tiktok };
}

export function calcularNumeros(e: EntradaNumeros, costo: number | null, reales?: TarifasReales | null): ResultadoNumeros {
  const P = PARAMETROS_NUMEROS;
  const usado = tasasUsadas(e, reales);
  const pr = e.precioRelampago;
  const pvNormal = e.pvNormal ?? (pr != null ? pr * P.factorPvNormal : null);
  const m = reales?.meli;
  const recibidoMeli =
    m != null && m.pares >= PARES_MINIMOS_REALES && m.netoPar != null
      ? { porPar: m.netoPar, pares: m.pares, ganancia: costo != null ? m.netoPar - costo : null }
      : null;
  const vacio: ResultadoNumeros = {
    ganancia: null,
    recibidoMeli,
    porcentaje: null,
    pvNormal,
    gananciaNormal: null,
    recibirAmazon: null,
    pvpAmazon: null,
    pvpDeal: null,
    tiktokLives: null,
    tiktokOferta: null,
    tiktokRelampago: null,
    usado,
  };
  if (costo == null || pr == null) return vacio;
  const { comisionPct, envio, retencionPct } = usado.meli;
  const gananciaMeli = (precio: number) => precio * (1 - comisionPct - retencionPct) - envio - costo;
  const ganancia = gananciaMeli(pr);
  const gananciaNormal = pvNormal != null ? gananciaMeli(pvNormal) : null;
  const recibirAmazon = costo + ganancia;
  const pvpAmazon =
    usado.amazon.porPar != null && usado.amazon.pctTotal < 1 ? (recibirAmazon + usado.amazon.porPar) / (1 - usado.amazon.pctTotal) : null;
  const pvpDeal = e.pvpDeal ?? (pvpAmazon != null ? pvpAmazon * P.factorDeal : null);
  const tiktokLives = usado.tiktok.pctTotal < 1 ? (recibirAmazon + usado.tiktok.fijo) / (1 - usado.tiktok.pctTotal) : null;
  const tiktokOferta = tiktokLives != null ? tiktokLives * e.tiktokOferta : null;
  return {
    ganancia,
    recibidoMeli,
    porcentaje: costo > 0 ? ganancia / costo : null,
    pvNormal,
    gananciaNormal,
    recibirAmazon,
    pvpAmazon,
    pvpDeal,
    tiktokLives,
    tiktokOferta,
    tiktokRelampago: tiktokOferta != null ? tiktokOferta * P.factorRelampagoTikTok : null,
    usado,
  };
}
