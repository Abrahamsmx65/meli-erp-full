/**
 * Cálculo de demanda real por SKU.
 *
 * "Demanda real" = lo que se habría vendido si nunca se hubiera agotado.
 * Se obtiene dividiendo las unidades vendidas entre los días EFECTIVOS con
 * stock (no entre los días de calendario), y después se inclina hacia lo
 * reciente y se ajusta por tendencia.
 */
import { calcularFraccionesConStock } from "./stockHistory";
import type {
  Bucket,
  Confianza,
  DemandaSku,
  DiaStock,
  Parametros,
  SkuOverride,
} from "./types";

const EPS = 1e-9;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Desviación estándar muestral. */
function desviacion(valores: number[]): number {
  const n = valores.length;
  if (n < 2) return 0;
  const media = valores.reduce((a, b) => a + b, 0) / n;
  const varianza = valores.reduce((a, v) => a + (v - media) ** 2, 0) / (n - 1);
  return Math.sqrt(Math.max(0, varianza));
}

/**
 * Parte los días (ordenados de más viejo a más nuevo) en buckets de recencia
 * de 30 días, del más reciente al más antiguo.
 */
function construirBuckets(
  dias: DiaStock[],
  nBuckets: number,
  factorCorreccionMax: number,
  tamano = 30,
): Bucket[] {
  const buckets: Bucket[] = [];
  const total = dias.length;
  for (let b = 0; b < nBuckets; b++) {
    const finIdx = total - b * tamano;              // exclusivo
    const iniIdx = Math.max(0, finIdx - tamano);    // inclusivo
    if (finIdx <= 0) break;
    const trozo = dias.slice(iniIdx, finIdx);
    if (!trozo.length) break;

    const unidades = trozo.reduce((a, d) => a + d.unidades, 0);
    const efectivos = trozo.reduce((a, d) => a + d.fraccionConStock, 0);

    const corregida = efectivos >= 0.5 ? unidades / efectivos : 0;
    // El tope de corrección se aplica DENTRO de cada bucket. Si no, un SKU
    // que solo tuvo stock 2 días del bucket dispararía la tasa sin control
    // y el tope global se quedaría sin efecto.
    const techoBucket = (unidades / Math.max(1, trozo.length)) * factorCorreccionMax;

    buckets.push({
      etiqueta: b === 0 ? "Últimos 30 días" : `Días ${b * tamano + 1}-${(b + 1) * tamano}`,
      diasCalendario: trozo.length,
      diasEfectivos: Number(efectivos.toFixed(2)),
      unidades,
      tasaDiaria: unidades > 0 ? Math.min(corregida, techoBucket) : 0,
    });
  }
  return buckets;
}

export function calcularDemanda(
  sku: string,
  dias: DiaStock[],
  p: Parametros,
  override?: SkuOverride,
): DemandaSku {
  const notas: string[] = [];

  // Fracciones de día con stock (muta `dias`) + tasa corregida global.
  const tasaCorregidaRaw = calcularFraccionesConStock(dias);

  const unidadesTotales = dias.reduce((a, d) => a + d.unidades, 0);
  const diasCalendario = dias.length;
  const diasEfectivos = dias.reduce((a, d) => a + d.fraccionConStock, 0);
  const diasSinStock = dias.filter((d) => d.fraccionConStock < 0.5).length;

  const tasaObservada = diasCalendario > 0 ? unidadesTotales / diasCalendario : 0;

  // Tope de seguridad: nunca inflar la demanda más de lo permitido.
  const techo = tasaObservada * p.factorCorreccionMax;
  let tasaCorregida = tasaCorregidaRaw;
  if (tasaObservada > EPS && tasaCorregida > techo) {
    tasaCorregida = techo;
    notas.push(
      `Corrección por agotamiento topada en ${p.factorCorreccionMax}× para no extrapolar de más.`,
    );
  }
  const factorCorreccion = tasaObservada > EPS ? tasaCorregida / tasaObservada : 1;

  // --- Buckets de recencia ------------------------------------------------
  const nBuckets = Math.max(1, p.pesosRecencia.length);
  const buckets = construirBuckets(dias, nBuckets, p.factorCorreccionMax);

  // Promedio ponderado sobre los buckets que sí tienen días útiles.
  let sumaPeso = 0;
  let sumaTasa = 0;
  buckets.forEach((b, i) => {
    if (b.diasEfectivos < 1) return;
    const w = p.pesosRecencia[i] ?? 0;
    sumaPeso += w;
    sumaTasa += w * b.tasaDiaria;
  });
  let tasaPonderada = sumaPeso > EPS ? sumaTasa / sumaPeso : tasaCorregida;

  // El ponderado no debería alejarse del corregido global si hay poca data.
  if (sumaPeso <= EPS) {
    tasaPonderada = tasaCorregida;
    notas.push("Sin buckets con días útiles: se usa la tasa corregida global.");
  }

  // --- Tendencia ----------------------------------------------------------
  let factorTendencia = 1;
  if (p.aplicarTendencia && buckets.length >= 2) {
    const reciente = buckets[0];
    const previos = buckets.slice(1).filter((b) => b.diasEfectivos >= 1);
    if (reciente.diasEfectivos >= 5 && previos.length) {
      const diasPrev = previos.reduce((a, b) => a + b.diasEfectivos, 0);
      const uniPrev = previos.reduce((a, b) => a + b.unidades, 0);
      const tasaPrev = diasPrev > 0 ? uniPrev / diasPrev : 0;
      if (tasaPrev > EPS) {
        const bruto = reciente.tasaDiaria / tasaPrev;
        factorTendencia = clamp(bruto, p.tendenciaMin, p.tendenciaMax);
        if (bruto > p.tendenciaMax) {
          notas.push(
            `Va en subida fuerte (${(bruto * 100 - 100).toFixed(0)}%), topada en +${((p.tendenciaMax - 1) * 100).toFixed(0)}%.`,
          );
        } else if (bruto < p.tendenciaMin) {
          notas.push(
            `Va en caída fuerte (${(bruto * 100 - 100).toFixed(0)}%), topada en ${((p.tendenciaMin - 1) * 100).toFixed(0)}%.`,
          );
        } else if (factorTendencia > 1.1) {
          notas.push(`Tendencia al alza: +${((factorTendencia - 1) * 100).toFixed(0)}%.`);
        } else if (factorTendencia < 0.9) {
          notas.push(`Tendencia a la baja: ${((factorTendencia - 1) * 100).toFixed(0)}%.`);
        }
      }
    }
  }

  // --- Demanda final ------------------------------------------------------
  const temporada = override?.factorTemporada ?? 1;
  let demandaDiaria = tasaPonderada * factorTendencia * temporada;

  if (override?.demandaManual != null && override.demandaManual >= 0) {
    demandaDiaria = override.demandaManual;
    notas.push("Demanda fijada a mano (override).");
  }
  if (temporada !== 1) {
    notas.push(`Factor de temporada aplicado: ×${temporada}.`);
  }

  // --- Variabilidad -------------------------------------------------------
  // Solo días que fueron mayormente vendibles, normalizados por su fracción.
  const diasUtiles = dias.filter((d) => d.fraccionConStock >= 0.5);
  const normalizados = diasUtiles.map((d) => d.unidades / Math.max(0.5, d.fraccionConStock));
  let sigmaDiaria = desviacion(normalizados);

  // Piso de Poisson: para SKUs de venta esporádica, la varianza nunca es cero.
  const pisoPoisson = Math.sqrt(Math.max(0, demandaDiaria));
  sigmaDiaria = Math.max(sigmaDiaria, pisoPoisson);
  // Techo: un solo pico no debe disparar el stock de seguridad al infinito.
  sigmaDiaria = Math.min(sigmaDiaria, Math.max(3 * demandaDiaria, pisoPoisson * 3));

  const coefVariacion = demandaDiaria > EPS ? sigmaDiaria / demandaDiaria : 0;

  // --- Confianza ----------------------------------------------------------
  let confianza: Confianza;
  if (diasEfectivos >= Math.max(30, p.diasStockMinimosConfiables * 2)) confianza = "alta";
  else if (diasEfectivos >= p.diasStockMinimosConfiables) confianza = "media";
  else confianza = "baja";

  if (confianza === "baja") {
    notas.push(
      `Solo ${diasEfectivos.toFixed(1)} días con stock en la ventana: el número es una estimación gruesa.`,
    );
  }
  if (diasSinStock >= 7) {
    const perdidas = Math.round(diasSinStock * demandaDiaria);
    notas.push(
      `Estuvo agotado ~${diasSinStock} días; eso equivale a unas ${perdidas} piezas que no se vendieron.`,
    );
  }

  return {
    sku,
    unidadesTotales,
    diasCalendario,
    diasEfectivos: Number(diasEfectivos.toFixed(2)),
    diasSinStock,
    tasaObservada,
    tasaCorregida,
    factorCorreccion,
    buckets,
    tasaPonderada,
    factorTendencia,
    demandaDiaria: Math.max(0, demandaDiaria),
    sigmaDiaria,
    coefVariacion,
    confianza,
    notas,
  };
}

/** Venta perdida estimada por agotamiento en la ventana analizada. */
export function ventaPerdida(d: DemandaSku): number {
  const diasPerdidos = Math.max(0, d.diasCalendario - d.diasEfectivos);
  return Math.round(diasPerdidos * d.demandaDiaria);
}
