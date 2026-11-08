/**
 * NÚMEROS: el precio de cada modelo en MELI, Amazon y TikTok calculado con
 * el costo del ÚLTIMO contenedor (dueño, 11-oct-2026: «ya no quiero
 * actualizar la sección de Números, quiero que tú hagas todos los cálculos
 * de los modelos según el tipo de cambio que pagué»). Motor puro.
 *
 * Las fórmulas son las de su sheet «Números» (pestaña CALZADO), columna
 * por columna:
 *   ganancia relámpago = PR − 15 % PR − envío MELI [− (PR / 1.16) × 10.5 %] − costo
 *   PV normal          = PR × 1.05 (o el que fije el dueño; era 1.065 hasta el 8-nov-2026)
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
  // Dueño, 8-nov-2026: «el precio de no relámpago es 5 % arriba» (era 6.5 %).
  factorPvNormal: 1.05,
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

/** Pares mínimos vendidos AL PRECIO RELÁMPAGO para creerle al depósito real a ese precio. */
export const PARES_MINIMOS_AL_PRECIO = 5;

export interface TarifasReales {
  /** Depósito real de MELI por par a cada precio al cliente (redondeado al peso). */
  meliPorPrecio?: { precio: number; pares: number; netoPar: number }[];
  meli?: { pares: number; paresDirecta: number; comisionPct: number | null; envioPar: number | null; retencionPct: number | null; netoPar: number | null };
  amazon?: { unidades: number; precioPar: number | null; comisionPct: number | null; retencionPct: number | null; fbaPar: number | null; otrosPar: number | null; netoPar: number | null };
  tiktok?: { pares: number; precioPar: number | null; pagoPar: number | null; afiliadoPct: number | null };
  /**
   * Envío que MELI cobra HOY al vendedor con las medidas que ella capturó
   * (simulador de Costos de envío al precio de venta), mediana por TRAMO de
   * precio (`tramoEnvio`: < $299, $299–$498, desde $499).
   */
  envioMeliPorTramo?: Partial<Record<number, { costo: number; variantes: number }>>;
  /** Lo que cobra cada plataforma en TODA la cuenta (para el modelo que no vendió ahí). */
  general?: TarifasGenerales | null;
}

/**
 * Lo que Amazon y TikTok cobran HOY en toda la cuenta (30 días, modelos con
 * venta suficiente, ponderado por pares). Dueño, 8-nov-2026: «Amazon y
 * TikTok se tienen que calcular según los números reales que se nos cobran
 * hoy en día […] ya no interesa el 8 % y el 24 %»: un modelo que todavía no
 * vende en Amazon o TikTok usa esto en vez de la estimación fija.
 */
export interface TarifasGenerales {
  amazon: { pctTotal: number; retencionPct: number; porPar: number; unidades: number } | null;
  tiktok: { pctTotal: number; pares: number } | null;
}

/**
 * Lo que MELI y Amazon contestan EN VIVO a un precio exacto (dueño,
 * 8-nov-2026: «tiene que tomar la info en tiempo real de MELI y de Amazon» y
 * «considerar la diferencia de envío abajo y arriba de $299 en los dos»):
 * MELI = comisión (% y cargo fijo de los artículos baratos) de
 * `/sites/MLM/listing_prices` y envío del simulador con las medidas que MELI
 * capturó, a cada precio; Amazon = comisión y FBA de `getMyFeesEstimateForSKU`
 * al PVP (que se vuelve a preguntar hasta que el precio deja de moverse).
 * Lo arma `servicios/numeros-vivo.ts`.
 */
export interface NumerosVivo {
  leidoEn: string;
  meli: { precio: number; comisionPct: number; fijo: number; envio: number | null }[];
  amazon: { precio: number; comisionPct: number; porPar: number; sku: string } | null;
  avisos: string[];
}

export function tarifasGenerales(porModelo: Record<string, TarifasReales>): TarifasGenerales {
  let aU = 0, aPct = 0, aRet = 0;
  const aPorPar: number[] = [];
  let tPrecio = 0, tRecibe = 0, tPares = 0;
  for (const r of Object.values(porModelo)) {
    const a = r.amazon;
    if (a && a.unidades >= PARES_MINIMOS_REALES && a.comisionPct != null) {
      aU += a.unidades;
      aPct += ((a.comisionPct ?? 0) + (a.retencionPct ?? 0)) * a.unidades;
      aRet += (a.retencionPct ?? 0) * a.unidades;
      if (a.fbaPar != null) aPorPar.push((a.fbaPar ?? 0) + (a.otrosPar ?? 0));
    }
    const t = r.tiktok;
    if (t && t.pares >= PARES_MINIMOS_REALES && t.precioPar != null && t.pagoPar != null && t.precioPar > 0) {
      tPrecio += t.precioPar * t.pares;
      tRecibe += (t.pagoPar + FIJO_TIKTOK) * t.pares;
      tPares += t.pares;
    }
  }
  aPorPar.sort((x, y) => x - y);
  const mediana = aPorPar.length ? aPorPar[Math.floor(aPorPar.length / 2)] : null;
  return {
    amazon: aU > 0 && mediana != null ? { pctTotal: aPct / aU, retencionPct: aRet / aU, porPar: mediana, unidades: aU } : null,
    tiktok: tPares > 0 ? { pctTotal: 1 - tRecibe / tPrecio, pares: tPares } : null,
  };
}

/** Lo que de verdad se usó en cada canal (real o estimado) para enseñarlo. */
/** Tramo de envío de MELI: abajo de $299, de $299 a $498 (con descuento) y desde $499 (completo). */
export function tramoEnvio(precio: number): number {
  return precio < 299 ? 0 : precio < 499 ? 1 : 2;
}

export interface UsadoNumeros {
  /**
   * `envioFuente`: «meli» = lo que MELI cobra hoy con sus medidas a un precio
   * del mismo tramo; «ventas» = mediana de las ventas directas de 30 días;
   * «tuyo» = el capturado en Números (no hay nada real).
   */
  meli: {
    fuente: "real" | "estimado" | "vivo";
    comisionPct: number;
    /** cargo fijo por unidad de MELI (artículos abajo de $299), solo en vivo */
    fijo: number;
    envio: number;
    retencionPct: number;
    envioFuente: "vivo" | "meli" | "ventas" | "tuyo";
  };
  /** «general» = lo que cobra la plataforma en toda la cuenta (el modelo no vendió ahí); «vivo» = Amazon al PVP */
  amazon: { fuente: "vivo" | "real" | "general" | "estimado"; pctTotal: number; porPar: number | null };
  tiktok: { fuente: "real" | "general" | "estimado"; pctTotal: number; fijo: number };
}

export interface ResultadoNumeros {
  /** Lo depositado de verdad − costo si hay ventas reales; si no, la ganancia al relámpago. */
  ganancia: number | null;
  /** Lo que dejaría el precio relámpago con las tasas de arriba (solo referencia si hay ganancia real). */
  gananciaRelampago: number | null;
  /**
   * Lo que MELI deposita por par AL PRECIO RELÁMPAGO DE NÚMEROS (dueño,
   * 8-nov-2026: «a relámpago de 499.99 no sale cuánto recibiría real»; el
   * relámpago que se escribe aquí es el ancla y todo lo demás se calcula de
   * él). `fuente`:
   *   «real»          se vendió a ese precio (±$1, ≥ 5 pares): lo depositado;
 *   «vivo»          comisión y envío que MELI contesta en vivo a ese precio;
   *   «desde_ventas»  no se vendió a ese precio, pero sí cerca (mismo lado de
   *                   los $299): lo que MELI se quedó de verdad en ESE precio
   *                   (`base`) llevado al precio de aquí;
   *   «tasas»         sin ventas: comisión, envío y retención de `usado.meli`.
   * Es la ganancia de MELI y de ahí salen «Recibir», Amazon y TikTok.
   */
  recibidoMeli: {
    porPar: number;
    precio: number;
    pares: number;
    ganancia: number | null;
    fuente: "real" | "vivo" | "desde_ventas" | "tasas";
    base: { precio: number; porPar: number; pares: number } | null;
  } | null;
  /** El relámpago REAL de MELI en 30 días (precio más bajo con volumen), solo referencia. */
  relampagoMeli: { precio: number; porPar: number; pares: number } | null;
  /** Promedio depositado por par en 30 días a todos los precios (solo referencia). */
  promedioMeli: { porPar: number; pares: number } | null;
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
/** El envío de MELI a `precio`: el que cobra MELI con sus medidas en ese tramo; si no, el de ventas; si no, el tuyo. */
export function envioMeliA(e: EntradaNumeros, reales: TarifasReales | null | undefined, precio: number | null) {
  const m = reales?.meli;
  const simulado = precio != null ? reales?.envioMeliPorTramo?.[tramoEnvio(precio)] : undefined;
  const deVentas = m != null && m.pares >= PARES_MINIMOS_REALES && m.envioPar != null && m.paresDirecta >= 5 ? m.envioPar : null;
  if (simulado) return { envio: simulado.costo, envioFuente: "meli" as const };
  if (deVentas != null) return { envio: deVentas, envioFuente: "ventas" as const };
  return { envio: e.envioMeli ?? 0, envioFuente: "tuyo" as const };
}

/** Lo leído en vivo de MELI a ese precio exacto (±50 centavos). */
function vivoMeliA(vivo: NumerosVivo | null | undefined, precio: number | null) {
  return precio == null ? undefined : vivo?.meli.find((x) => Math.abs(x.precio - precio) <= 0.5);
}

export function tasasUsadas(e: EntradaNumeros, reales?: TarifasReales | null, vivo?: NumerosVivo | null): UsadoNumeros {
  const P = PARAMETROS_NUMEROS;
  const m = reales?.meli;
  const meliReal = m != null && m.pares >= PARES_MINIMOS_REALES;
  const envio = envioMeliA(e, reales, e.precioRelampago);
  const enVivo = vivoMeliA(vivo, e.precioRelampago);
  const retencionPct = meliReal ? m!.retencionPct ?? 0 : e.retencion ? P.retencion / P.iva : 0;
  const meli = enVivo
    ? {
        fuente: "vivo" as const,
        comisionPct: enVivo.comisionPct,
        fijo: enVivo.fijo,
        retencionPct,
        ...(enVivo.envio != null ? { envio: enVivo.envio, envioFuente: "vivo" as const } : envio),
      }
    : meliReal
      ? { fuente: "real" as const, comisionPct: m!.comisionPct ?? P.comisionMeli, fijo: 0, retencionPct, ...envio }
      : { fuente: "estimado" as const, comisionPct: P.comisionMeli, fijo: 0, retencionPct, ...envio };
  const a = reales?.amazon;
  const amazonReal = a != null && a.unidades >= PARES_MINIMOS_REALES && a.comisionPct != null;
  const g = reales?.general ?? null;
  const retAmazon = (amazonReal ? a!.retencionPct : null) ?? g?.amazon?.retencionPct ?? 0;
  const amazon = vivo?.amazon
    ? { fuente: "vivo" as const, pctTotal: vivo.amazon.comisionPct + retAmazon, porPar: vivo.amazon.porPar }
    : amazonReal
    ? { fuente: "real" as const, pctTotal: (a!.comisionPct ?? 0) + (a!.retencionPct ?? 0), porPar: (a!.fbaPar ?? 0) + (a!.otrosPar ?? 0) }
    : g?.amazon
      ? // El envío de FBA depende del tamaño de la caja: el que capturó el dueño manda; si no, la mediana de la cuenta.
        { fuente: "general" as const, pctTotal: g.amazon.pctTotal, porPar: e.envioAmazon ?? g.amazon.porPar }
      : { fuente: "estimado" as const, pctTotal: P.comisionAmazon, porPar: e.envioAmazon };
  const t = reales?.tiktok;
  const tiktokReal = t != null && t.pares >= PARES_MINIMOS_REALES && t.precioPar != null && t.pagoPar != null && t.precioPar > 0;
  const tiktok = tiktokReal
    ? { fuente: "real" as const, pctTotal: 1 - (t!.pagoPar! + FIJO_TIKTOK) / t!.precioPar!, fijo: FIJO_TIKTOK }
    : g?.tiktok
      ? { fuente: "general" as const, pctTotal: g.tiktok.pctTotal, fijo: FIJO_TIKTOK }
      : { fuente: "estimado" as const, pctTotal: e.tiktokComision, fijo: e.tiktokExtra };
  return { meli, amazon, tiktok };
}

/**
 * El relámpago REAL de MELI: de los precios a los que se vendió en 30 días,
 * el más bajo con volumen (≥ 10 % de los pares y al menos
 * `PARES_MINIMOS_AL_PRECIO`). Misma idea que `meli_neto_relampago_por_modelo`
 * de Precios para TikTok: el promedio mezcla precio lleno y oferta.
 */
export function escalonRelampago<T extends { precio: number; pares: number }>(escalones: T[]): T | null {
  const total = escalones.reduce((a, x) => a + x.pares, 0);
  if (!total) return null;
  const minimo = Math.max(PARES_MINIMOS_AL_PRECIO, total * 0.1);
  const conVolumen = escalones.filter((x) => x.pares >= minimo).sort((a, b) => a.precio - b.precio);
  return conVolumen[0] ?? null;
}

export function calcularNumeros(
  e: EntradaNumeros,
  costo: number | null,
  reales?: TarifasReales | null,
  vivo?: NumerosVivo | null,
): ResultadoNumeros {
  const P = PARAMETROS_NUMEROS;
  let usado = tasasUsadas(e, reales, vivo);
  const pr = e.precioRelampago;
  const pvNormal = e.pvNormal ?? (pr != null ? pr * P.factorPvNormal : null);
  const m = reales?.meli;
  const promedioMeli = m != null && m.pares >= PARES_MINIMOS_REALES && m.netoPar != null ? { porPar: m.netoPar, pares: m.pares } : null;
  const escalones = reales?.meliPorPrecio ?? [];
  const historico = escalonRelampago(escalones);
  const relampagoMeli = historico ? { precio: historico.precio, porPar: historico.netoPar, pares: historico.pares } : null;
  // Lo que MELI cobra a CADA precio: en vivo si se leyó a ese precio; si no,
  // las tasas del modelo con el envío del tramo de ESE precio ($299 / $499).
  const cargosA = (precio: number): CargosMeli => {
    const v = vivoMeliA(vivo, precio);
    const sinVivo = tasasUsadas(e, reales).meli;
    if (v) return { comisionPct: v.comisionPct, fijo: v.fijo, envio: v.envio ?? envioMeliA(e, reales, precio).envio, retencionPct: sinVivo.retencionPct, vivo: true };
    return { comisionPct: sinVivo.comisionPct, fijo: 0, envio: envioMeliA(e, reales, precio).envio, retencionPct: sinVivo.retencionPct, vivo: false };
  };
  const recibidoMeli = pr != null ? recibidoAlPrecio(pr, escalones, cargosA, costo) : null;
  const vacio: ResultadoNumeros = {
    ganancia: null,
    gananciaRelampago: null,
    recibidoMeli,
    relampagoMeli,
    promedioMeli,
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
  if (costo == null || pr == null || !recibidoMeli) return vacio;
  const gananciaMeli = (precio: number) => {
    const c = cargosA(precio);
    return precio * (1 - c.comisionPct - c.retencionPct) - c.fijo - c.envio - costo;
  };
  const gananciaRelampago = gananciaMeli(pr);
  const ganancia = recibidoMeli.porPar - costo;
  const gananciaNormal = pvNormal != null ? gananciaMeli(pvNormal) : null;
  const recibirAmazon = costo + ganancia;
  const pvp = (a: UsadoNumeros["amazon"]) => (a.porPar != null && a.pctTotal < 1 ? (recibirAmazon + a.porPar) / (1 - a.pctTotal) : null);
  let pvpAmazon = pvp(usado.amazon);
  // Lo de Amazon en vivo vale en el tramo de precio donde se preguntó: abajo
  // de $299 Amazon cobra otra cosa. Si el PVP cae en otro tramo, se espera la
  // siguiente lectura y mientras tanto sale con lo de 30 días.
  if (vivo?.amazon && pvpAmazon != null && tramoEnvio(pvpAmazon) !== tramoEnvio(vivo.amazon.precio)) {
    usado = { ...usado, amazon: tasasUsadas(e, reales).amazon };
    pvpAmazon = pvp(usado.amazon);
  }
  const pvpDeal = e.pvpDeal ?? (pvpAmazon != null ? pvpAmazon * P.factorDeal : null);
  const tiktokLives = usado.tiktok.pctTotal < 1 ? (recibirAmazon + usado.tiktok.fijo) / (1 - usado.tiktok.pctTotal) : null;
  const tiktokOferta = tiktokLives != null ? tiktokLives * e.tiktokOferta : null;
  return {
    ganancia,
    gananciaRelampago,
    recibidoMeli,
    relampagoMeli,
    promedioMeli,
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

export interface CargosMeli {
  comisionPct: number;
  fijo: number;
  envio: number;
  retencionPct: number;
  /** leídos de MELI en vivo a ese precio */
  vivo: boolean;
}

/**
 * Cuánto deposita MELI por par a `precio`, en este orden: lo depositado de
 * verdad si se vendió a ese precio; lo que MELI cobra EN VIVO a ese precio;
 * lo que MELI se quedó en el precio vendido más cercano del MISMO tramo de
 * envío ($299 / $499) llevado a este precio; las tasas.
 */
export function recibidoAlPrecio(
  precio: number,
  escalones: { precio: number; pares: number; netoPar: number }[],
  cargosA: (precio: number) => CargosMeli,
  costo: number | null,
): NonNullable<ResultadoNumeros["recibidoMeli"]> {
  const ganancia = (porPar: number) => (costo != null ? porPar - costo : null);
  const alPrecio = escalones.find((x) => Math.abs(x.precio - precio) <= 1 && x.pares >= PARES_MINIMOS_AL_PRECIO);
  if (alPrecio)
    return { porPar: alPrecio.netoPar, precio, pares: alPrecio.pares, ganancia: ganancia(alPrecio.netoPar), fuente: "real", base: null };
  const c = cargosA(precio);
  const conTasas = precio * (1 - c.comisionPct - c.retencionPct) - c.fijo - c.envio;
  if (c.vivo) return { porPar: conTasas, precio, pares: 0, ganancia: ganancia(conTasas), fuente: "vivo", base: null };
  const tramo = tramoEnvio(precio);
  const cercano = escalones
    .filter((x) => x.pares >= PARES_MINIMOS_AL_PRECIO && x.precio > 0 && tramoEnvio(x.precio) === tramo)
    .sort((a, b) => Math.abs(a.precio - precio) - Math.abs(b.precio - precio) || b.pares - a.pares)[0];
  if (cercano) {
    const pctQueda = 1 - (cercano.netoPar + c.envio + c.fijo) / cercano.precio;
    if (pctQueda >= 0 && pctQueda < 1) {
      const porPar = precio * (1 - pctQueda) - c.envio - c.fijo;
      return {
        porPar,
        precio,
        pares: 0,
        ganancia: ganancia(porPar),
        fuente: "desde_ventas",
        base: { precio: cercano.precio, porPar: cercano.netoPar, pares: cercano.pares },
      };
    }
  }
  return { porPar: conTasas, precio, pares: 0, ganancia: ganancia(conTasas), fuente: "tasas", base: null };
}
