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

  // Lanzamiento: el primer día con evidencia (stock o venta). Si es el
  // primer día de la ventana, el SKU ya existía antes y no se sabe cuándo
  // nació: no cuenta como lanzamiento. Sin ningún dato, tampoco.
  let lanzamiento: string | null = null;
  let diasDesdeLanzamiento: number | null = null;
  const primerConDato = dias.findIndex(
    (d) => d.origen !== "desconocido" || d.unidades > 0 || d.fraccionConStock > 0,
  );
  if (primerConDato > 0) {
    lanzamiento = dias[primerConDato].fecha;
    diasDesdeLanzamiento = dias.length - primerConDato;
  }

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

  // El MISMO techo global aplica al ponderado. Sin esto, el tope de 3× solo
  // protegía el fallback: un SKU con 1 venta y 89 días agotado quedaba con
  // demanda 9× la observada (su único bucket útil extrapolaba 3× SOBRE 30
  // días y los buckets vacíos ni pesaban en el promedio) — el plan lo
  // marcaba crítico y pedía cajas para una venta que nunca existió.
  if (tasaObservada > EPS && tasaPonderada > techo) {
    tasaPonderada = techo;
    notas.push(
      `Demanda topada en ${p.factorCorreccionMax}× lo observado en la ventana completa.`,
    );
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

  // --- Tendencia corta: la última semana ----------------------------------
  // La tendencia de arriba compara bloques de 30 días; esta mira los últimos
  // 7 para reaccionar a lo que cambia día con día. Solo EMPUJA hacia arriba
  // (nunca baja la demanda): si la semana corre más fuerte que el mes, el
  // plan lo ve hoy y no hasta que el bucket mensual lo alcance. Se adelanta
  // la mitad del empuje: una semana buena cuenta, pero no manda sola.
  if (p.aplicarTendencia && dias.length >= 10) {
    const ultimos7 = dias.slice(-7);
    const efectivos7 = ultimos7.reduce((a, d) => a + d.fraccionConStock, 0);
    const unidades7 = ultimos7.reduce((a, d) => a + d.unidades, 0);
    if (efectivos7 >= 3) {
      const tasa7 = unidades7 / efectivos7;
      const base = tasaPonderada * factorTendencia;
      if (base > EPS && tasa7 > base * 1.15) {
        const empuje = clamp(tasa7 / base, 1, p.tendenciaMax);
        factorTendencia *= 1 + (empuje - 1) * 0.5;
        notas.push(
          `La última semana corre +${((empuje - 1) * 100).toFixed(0)}% arriba del promedio: se adelanta la mitad del empuje.`,
        );
      }
    }
  }

  // --- Demanda final ------------------------------------------------------
  const temporada = override?.factorTemporada ?? 1;
  let demandaDiaria = tasaPonderada * factorTendencia * temporada;

  // El techo global gobierna también DESPUÉS de la tendencia: sin esto, el
  // factor (hasta 1.5×) y el empuje semanal (hasta 1.25×) volvían a subir
  // por encima del 3× recién topado — techo efectivo 5.6×. La temporada
  // (override explícito del usuario) sí queda fuera del tope.
  if (tasaObservada > EPS && demandaDiaria > techo * temporada) {
    demandaDiaria = techo * temporada;
    notas.push(
      `Demanda topada en ${p.factorCorreccionMax}× lo observado (la tendencia no puede rebasar el techo).`,
    );
  }

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
    lanzamiento,
    diasDesdeLanzamiento,
  };
}

/** Venta perdida estimada por agotamiento en la ventana analizada. */
export function ventaPerdida(d: DemandaSku): number {
  const diasPerdidos = Math.max(0, d.diasCalendario - d.diasEfectivos);
  return Math.round(diasPerdidos * d.demandaDiaria);
}
