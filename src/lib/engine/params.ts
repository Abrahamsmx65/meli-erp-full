import type { Parametros } from "./types";

export const PARAMETROS_DEFAULT: Parametros = {
  enviosPorSemana: 2,
  leadTimeDias: 7,
  horizonteDias: 30,
  diasHistoria: 90,
  pesosRecencia: [0.5, 0.3, 0.2],
  aplicarTendencia: true,
  tendenciaMin: 0.7,
  tendenciaMax: 1.5,
  nivelServicio: 0.95,
  ssMinimoDias: 3,
  factorCorreccionMax: 3,
  diasStockMinimosConfiables: 15,
  sobrestockFactor: 1.5,
  permiteUnidadesSueltas: false,
  pesoFaltante: 3,
  pesoSobrante: 1,
  pesoFaltanteCritico: 3,
  maxCajasPorEnvio: 0,
  maxPiezasPorEnvio: 0,
  corridaSobranteFactor: 1.5,
  corridaDiasDispareja: 7,
  corridaFaltanteGrande: 200,
  nuevoDias: 60,
  holguraObjetivoDias: 2,
  cajasMinimasSinEstreno: 2,
};

export function normalizarParametros(p: Partial<Parametros> | null | undefined): Parametros {
  const out: Parametros = { ...PARAMETROS_DEFAULT, ...(p ?? {}) };

  // Los pesos de recencia siempre suman 1.
  const pesos = out.pesosRecencia?.length ? out.pesosRecencia.slice() : [1];
  const suma = pesos.reduce((a, b) => a + b, 0);
  out.pesosRecencia = suma > 0 ? pesos.map((w) => w / suma) : pesos.map(() => 1 / pesos.length);

  out.enviosPorSemana = Math.max(0.25, out.enviosPorSemana);
  out.leadTimeDias = Math.max(0, out.leadTimeDias);
  out.horizonteDias = Math.max(1, out.horizonteDias);
  out.diasHistoria = Math.max(14, Math.round(out.diasHistoria));
  out.nivelServicio = Math.min(0.999, Math.max(0.5, out.nivelServicio));
  out.tendenciaMin = Math.min(out.tendenciaMin, 1);
  out.tendenciaMax = Math.max(out.tendenciaMax, 1);
  out.factorCorreccionMax = Math.max(1, out.factorCorreccionMax);
  out.corridaSobranteFactor = Math.max(1, out.corridaSobranteFactor);
  out.corridaDiasDispareja = Math.max(1, Math.round(out.corridaDiasDispareja));
  out.corridaFaltanteGrande = Math.max(0, out.corridaFaltanteGrande);
  out.nuevoDias = Math.max(0, Math.round(out.nuevoDias));
  out.holguraObjetivoDias = Math.max(0, out.holguraObjetivoDias);
  out.cajasMinimasSinEstreno = Math.max(0, Math.round(out.cajasMinimasSinEstreno));

  return out;
}

/** Días entre un envío y el siguiente. 2 envíos/semana -> 3.5 días. */
export function periodoRevision(p: Parametros): number {
  return 7 / Math.max(0.25, p.enviosPorSemana);
}

/**
 * Ventana que el stock de seguridad tiene que proteger.
 * Si mando hoy, lo que mande llega en `leadTime`; lo siguiente que mande
 * llega `periodoRevision` después. Ese hueco es el riesgo real.
 */
export function ventanaRiesgo(p: Parametros): number {
  return p.leadTimeDias + periodoRevision(p);
}

const TABLA_Z: [number, number][] = [
  [0.5, 0.0], [0.8, 0.842], [0.85, 1.036], [0.9, 1.282], [0.925, 1.44],
  [0.95, 1.645], [0.96, 1.751], [0.97, 1.881], [0.975, 1.96],
  [0.98, 2.054], [0.99, 2.326], [0.995, 2.576], [0.999, 3.09],
];

/** Z para un nivel de servicio dado, por interpolación lineal (sin dependencias). */
export function zScore(nivelServicio: number): number {
  const n = Math.min(0.999, Math.max(0.5, nivelServicio));
  for (let i = 0; i < TABLA_Z.length - 1; i++) {
    const [p0, z0] = TABLA_Z[i];
    const [p1, z1] = TABLA_Z[i + 1];
    if (n >= p0 && n <= p1) {
      if (p1 === p0) return z0;
      return z0 + ((z1 - z0) * (n - p0)) / (p1 - p0);
    }
  }
  return TABLA_Z[TABLA_Z.length - 1][1];
}
