/**
 * Panel de publicidad de Amazon por modelo (el "parent": MY2307, GT128…).
 *
 * El espejo del panel de Publicidad de MELI, pero sin API nuevo: el gasto de
 * publicidad por SKU ya llega en la economía por producto (SKU Economics vía
 * Data Kiosk, tabla `amazon_economia`), que trae ventas, tarifas, publicidad
 * y neto por día y por SKU. Las unidades y la venta del periodo salen de
 * `amazon_ventas_diarias`, igual que el monitor.
 *
 * Ojo con los denominadores: la economía llega con unos días de retraso, así
 * que "$ ads/unidad" y el % se calculan con las unidades y ventas del MISMO
 * reporte de economía (mismos días), no con las del periodo completo — la
 * misma decisión que ya tomó el monitor de Amazon.
 */
import { traerRpcTodo, traerTodo, type DB } from "../datos/repos";
import { desglosarSku } from "./sync";
import { configPorProducto } from "./productos";
import { normalizarRango, type RangoFechas } from "./ventas-monitor";

export interface FilaPublicidadAmazon {
  modelo: string;
  /** unidades vendidas del periodo (amazon_ventas_diarias) */
  unidades: number;
  /** venta bruta del periodo */
  importe: number;
  /** venta − costo de producto (estimada, como el monitor); null = sin costo */
  ganancia: number | null;
  /** gasto de publicidad del periodo (economía); null = sin dato del modelo */
  gastoAds: number | null;
  /** unidades del reporte de economía (el denominador del por-unidad) */
  unidadesEconomia: number;
  /** gasto ÷ unidades de la economía; null = sin datos */
  costoPorUnidad: number | null;
  /** gasto ÷ ventas de la economía (TACOS); null = sin datos */
  tacos: number | null;
  /** ganancia − gasto; null = sin costo o sin dato de ads */
  gananciaNeta: number | null;
}

export interface PublicidadAmazon {
  filas: FilaPublicidadAmazon[];
  totales: {
    gastoAds: number;
    unidades: number;
    importe: number;
    /** solo de los modelos con costo capturado */
    ganancia: number;
    coberturaCosto: number;
    /** gasto ÷ unidades del reporte de economía */
    costoPorUnidad: number | null;
    /** gasto ÷ ventas del reporte de economía */
    tacos: number | null;
    /** venta del reporte de economía (el denominador del TACOS) */
    ventasEconomia: number;
  };
  /** hasta qué fecha hay economía cargada; null = nada en el rango */
  economiaHasta: string | null;
  /**
   * Por qué no hay gasto de ads: el rango sin datos todavía, o un error al
   * leerlos. null = hay economía. Nunca se calla un fallo: enseñar "sin
   * datos" cuando la lectura truena esconde el problema.
   */
  aviso: string | null;
}

/**
 * Economía de un SKU en el periodo, YA SUMADA (la función
 * `amazon_economia_por_sku` de la base la agrega: por día son ~154 mil
 * renglones por rango, imposibles de bajar en una pantalla).
 */
export interface EconomiaSku {
  seller_sku: string;
  unidades: number | null;
  ventas: number | null;
  publicidad: number | null;
  /** último día con datos de ese SKU, para saber hasta dónde llega el reporte */
  ultima_fecha: string | null;
}

interface VentaAmazon {
  seller_sku: string;
  fecha: string;
  unidades: number | null;
  importe: number | null;
}

export function armarPublicidadAmazon(opts: {
  ventas: VentaAmazon[];
  economia: EconomiaSku[];
  costoDeModelo: Map<string, number | null>;
  /** mensaje de error si la economía no se pudo leer */
  errorEconomia?: string | null;
}): PublicidadAmazon {
  const { ventas, economia, costoDeModelo } = opts;

  const modeloDe = (sku: string): string =>
    (desglosarSku(sku).modelo ?? sku).toUpperCase();

  interface Acum {
    unidades: number;
    importe: number;
    gastoAds: number;
    conAds: boolean;
    unidadesEco: number;
    ventasEco: number;
  }
  const porModelo = new Map<string, Acum>();
  const de = (modelo: string): Acum => {
    let a = porModelo.get(modelo);
    if (!a) {
      a = { unidades: 0, importe: 0, gastoAds: 0, conAds: false, unidadesEco: 0, ventasEco: 0 };
      porModelo.set(modelo, a);
    }
    return a;
  };

  for (const v of ventas) {
    const a = de(modeloDe(String(v.seller_sku ?? "")));
    a.unidades += v.unidades ?? 0;
    a.importe += v.importe ?? 0;
  }

  let economiaHasta: string | null = null;
  for (const e of economia) {
    const a = de(modeloDe(String(e.seller_sku ?? "")));
    // En la economía la publicidad ya viene en positivo (así la suma y la
    // enseña el monitor de Amazon).
    a.gastoAds += Number(e.publicidad) || 0;
    a.conAds = true;
    a.unidadesEco += Number(e.unidades) || 0;
    a.ventasEco += Number(e.ventas) || 0;
    const hasta = e.ultima_fecha;
    if (hasta && (!economiaHasta || hasta > economiaHasta)) economiaHasta = hasta;
  }

  const filas: FilaPublicidadAmazon[] = [...porModelo.entries()]
    .filter(([, a]) => a.unidades > 0 || a.gastoAds > 0)
    .map(([modelo, a]) => {
      const costo = costoDeModelo.get(modelo) ?? null;
      const ganancia =
        costo != null && a.unidades > 0 ? a.importe - costo * a.unidades : null;
      const gastoAds = a.conAds ? a.gastoAds : null;
      return {
        modelo,
        unidades: a.unidades,
        importe: a.importe,
        ganancia,
        gastoAds,
        unidadesEconomia: a.unidadesEco,
        costoPorUnidad:
          gastoAds != null && a.unidadesEco > 0 ? gastoAds / a.unidadesEco : null,
        tacos: gastoAds != null && a.ventasEco > 0 ? gastoAds / a.ventasEco : null,
        gananciaNeta:
          ganancia != null && gastoAds != null ? ganancia - gastoAds : null,
      };
    })
    // En orden alfabético de modelo, igual que el panel de MELI.
    .sort((x, y) => x.modelo.localeCompare(y.modelo, "es"));

  let gastoAds = 0;
  let unidades = 0;
  let importe = 0;
  let ganancia = 0;
  let unidadesConCosto = 0;
  let unidadesEco = 0;
  let ventasEco = 0;
  for (const [modelo, a] of porModelo) {
    gastoAds += a.gastoAds;
    unidades += a.unidades;
    importe += a.importe;
    unidadesEco += a.unidadesEco;
    ventasEco += a.ventasEco;
    const costo = costoDeModelo.get(modelo) ?? null;
    if (costo != null && a.unidades > 0) {
      ganancia += a.importe - costo * a.unidades;
      unidadesConCosto += a.unidades;
    }
  }

  return {
    filas,
    totales: {
      gastoAds,
      unidades,
      importe,
      ganancia,
      coberturaCosto: unidades > 0 ? unidadesConCosto / unidades : 0,
      costoPorUnidad: unidadesEco > 0 ? gastoAds / unidadesEco : null,
      tacos: ventasEco > 0 ? gastoAds / ventasEco : null,
      ventasEconomia: ventasEco,
    },
    economiaHasta,
    aviso: opts.errorEconomia
      ? `No se pudo leer la economía por SKU de Amazon: ${opts.errorEconomia}`
      : economia.length
        ? null
        : "El rango no tiene datos de SKU Economics todavía: el gasto de publicidad de Amazon llega con unos días de retraso por el Data Kiosk.",
  };
}

/** Diez minutos de caché por instancia, como el panel de MELI. */
const cacheAmz = new Map<string, { en: number; datos: PublicidadAmazon }>();
const VIDA_CACHE_MS = 10 * 60_000;

export async function cargarPublicidadAmazon(
  db: DB,
  amazonAccountId: string,
  meliAccountId: string | null,
  rango?: RangoFechas,
): Promise<PublicidadAmazon> {
  const r = rango ?? normalizarRango();
  const claveCache = `${amazonAccountId}|${r.desde}|${r.hasta}`;
  const guardado = cacheAmz.get(claveCache);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_MS) return guardado.datos;

  // La economía se pide YA SUMADA por SKU a la base: por día son ~154 mil
  // renglones en 30 días (154 páginas de mil) y la lectura no alcanzaba a
  // terminar; el error se tragaba y el panel decía "sin datos" con $319 mil
  // de publicidad cargados. Sumada son ~6 mil renglones en un viaje.
  // Por PÁGINAS: el API corta en 1,000 renglones y la suma trae ~6 mil SKUs;
  // sin paginar, el gasto de publicidad llegaba recortado y el total salía
  // chico sin avisar.
  const leerEconomia = () =>
    traerRpcTodo<EconomiaSku>(db, "amazon_economia_por_sku", {
      p_account: amazonAccountId,
      p_desde: r.desde,
      p_hasta: r.hasta,
    });

  const [ventas, economia, config] = await Promise.all([
    traerTodo<VentaAmazon>(
      db,
      "amazon_ventas_diarias",
      "seller_sku, fecha, unidades, importe",
      (q) => q.eq("account_id", amazonAccountId).gte("fecha", r.desde).lte("fecha", r.hasta),
    ),
    leerEconomia(),
    // Costos y categorías viven con la cuenta de MELI: mismos productos.
    meliAccountId ? configPorProducto(db, meliAccountId) : Promise.resolve(new Map()),
  ]);

  const costoDeModelo = new Map<string, number | null>();
  for (const [modelo, cfg] of config) costoDeModelo.set(modelo, cfg.costo);

  const datos = armarPublicidadAmazon({
    ventas,
    economia: economia.filas,
    costoDeModelo,
    errorEconomia: economia.error,
  });
  // Un panel con la economía rota no se cachea: al recargar debe reintentar.
  if (!economia.error) cacheAmz.set(claveCache, { en: Date.now(), datos });
  return datos;
}
