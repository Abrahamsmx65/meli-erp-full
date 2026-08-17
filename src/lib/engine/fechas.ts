import type { ISODate } from "./types";

/** Convierte un Date a YYYY-MM-DD usando UTC (evita corrimientos por zona horaria). */
export function aISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function deISO(s: ISODate): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function sumarDias(s: ISODate, n: number): ISODate {
  const d = deISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return aISO(d);
}

export function diffDias(a: ISODate, b: ISODate): number {
  return Math.round((deISO(b).getTime() - deISO(a).getTime()) / 86_400_000);
}

/** Lista inclusiva de fechas de `desde` a `hasta`. */
export function rangoFechas(desde: ISODate, hasta: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let cur = desde;
  let guard = 0;
  while (cur <= hasta && guard++ < 4000) {
    out.push(cur);
    cur = sumarDias(cur, 1);
  }
  return out;
}

/**
 * Fecha del próximo envío según el ritmo semanal.
 * Con 2 envíos por semana asumimos lunes y jueves, que es el patrón típico.
 */
export function proximoEnvio(hoy: ISODate, enviosPorSemana: number): ISODate {
  const diasEnvio =
    enviosPorSemana >= 7 ? [0, 1, 2, 3, 4, 5, 6]
    : enviosPorSemana >= 3 ? [1, 3, 5]      // lun, mié, vie
    : enviosPorSemana >= 2 ? [1, 4]         // lun, jue
    : [1];                                  // lun
  for (let i = 0; i <= 7; i++) {
    const f = sumarDias(hoy, i);
    if (diasEnvio.includes(deISO(f).getUTCDay())) return f;
  }
  return sumarDias(hoy, 1);
}
