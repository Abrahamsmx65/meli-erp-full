/**
 * Monitor de venta de HOY contra AYER y contra el MISMO DÍA de la semana
 * pasada (dueño, 9-oct-2026: «en inicio me puedes poner un monitor de ventas
 * hoy comparado con ayer y con el mismo día la semana pasada»).
 *
 * Hoy va a medias, así que compararlo contra el día completo de ayer siempre
 * sale abajo. La comparación justa es «A ESTA HORA»: lo que ayer (o hace una
 * semana) llevaba vendido hasta la misma hora de México. La hora sale de las
 * series de `ventas_por_hora`; como no toda orden trae su hora, lo vendido a
 * esta hora es el día completo × la parte del día que ya había pasado según
 * sus horas (las dos medidas cuadran con el total del día). La hora en curso
 * cuenta en proporción a los minutos que lleva.
 *
 * Un canal que ese día vendió sin hora registrada (Amazon antes del
 * 9-oct-2026) no se puede partir: su «a esta hora» es null y el total lo deja
 * fuera de la comparación y lo nombra.
 *
 * Motor puro: lo usan la página de inicio y las pruebas.
 */
import { CANALES_TIEMPO, type CanalTiempo, type Medida, type VentasTiempo } from "./ventas-tiempo";

export interface Cifra {
  u: number;
  i: number;
}

export interface DiaMonitor {
  fecha: string;
  /** el día completo (hoy: lo que va) */
  completo: Cifra;
  /** lo vendido hasta la hora de ahora; null si el día no trae horas */
  aEstaHora: Cifra | null;
}

export interface CanalMonitor {
  canal: CanalTiempo;
  nombre: string;
  color: string;
  hoy: DiaMonitor;
  ayer: DiaMonitor;
  semana: DiaMonitor;
}

export interface MonitorHoy {
  hoy: string;
  ayer: string;
  semana: string;
  /** minutos transcurridos del día de México */
  minuto: number;
  canales: CanalMonitor[];
  /** suma de los canales que se pueden comparar a esta hora */
  total: {
    hoy: Cifra;
    ayer: Cifra | null;
    semana: Cifra | null;
    ayerCompleto: Cifra;
    semanaCompleto: Cifra;
    /** lo de hoy de los MISMOS canales que entran a cada comparación */
    hoyContraAyer: Cifra;
    hoyContraSemana: Cifra;
  };
  /** canales fuera de la comparación «a esta hora» de ayer / de la semana */
  sinHoraAyer: string[];
  sinHoraSemana: string[];
  /** venta acumulada por hora (0–23) de cada día, todos los canales comparables */
  curvas: { hoy: Cifra[]; ayer: Cifra[]; semana: Cifra[] };
}

const CERO: Cifra = { u: 0, i: 0 };

export function restarDias(f: string, dias: number): string {
  return new Date(Date.parse(`${f}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
}

/** Minutos del día en México (UTC−6 fijo, como `diaMx`). */
export function minutoMx(ahora = Date.now()): number {
  const d = new Date(ahora - 6 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function sumar(a: Cifra, b: Cifra, k = 1): Cifra {
  return { u: a.u + b.u * k, i: a.i + b.i * k };
}

/** Las 24 horas acumuladas de un día, escaladas al total del día. */
function acumuladoPorHora(serie: VentasTiempo, fecha: string, completo: Cifra): Cifra[] | null {
  const horas = serie.horas.filter((h) => h.f === fecha);
  const total = horas.reduce((a, h) => sumar(a, { u: h.u, i: h.i }), CERO);
  if (total.u <= 0 && total.i <= 0) return completo.u > 0 || completo.i > 0 ? null : Array(24).fill(CERO);
  const porHora: Cifra[] = Array.from({ length: 24 }, () => CERO);
  for (const h of horas) if (h.h >= 0 && h.h < 24) porHora[h.h] = sumar(porHora[h.h], { u: h.u, i: h.i });
  const ku = total.u > 0 ? completo.u / total.u : 0;
  const ki = total.i > 0 ? completo.i / total.i : 0;
  const res: Cifra[] = [];
  let acc = CERO;
  for (let h = 0; h < 24; h++) {
    acc = sumar(acc, porHora[h]);
    res.push({ u: acc.u * ku, i: acc.i * ki });
  }
  return res;
}

/** Lo acumulado hasta el minuto dado: horas completas + la hora en curso en proporción. */
function hastaMinuto(acum: Cifra[], minuto: number): Cifra {
  const h = Math.min(23, Math.floor(minuto / 60));
  const frac = (minuto % 60) / 60;
  const antes = h > 0 ? acum[h - 1] : CERO;
  const enHora = { u: acum[h].u - antes.u, i: acum[h].i - antes.i };
  return sumar(antes, enHora, frac);
}

function diaDe(serie: VentasTiempo, fecha: string, minuto: number, esHoy: boolean): { dia: DiaMonitor; acum: Cifra[] | null } {
  const d = serie.dias.find((x) => x.f === fecha);
  const completo = d ? { u: d.u, i: d.i } : CERO;
  const acum = acumuladoPorHora(serie, fecha, completo);
  const aEstaHora = esHoy ? completo : acum ? hastaMinuto(acum, minuto) : null;
  return { dia: { fecha, completo, aEstaHora }, acum };
}

export function armarMonitorHoy(series: VentasTiempo[], hoy: string, minuto: number): MonitorHoy {
  const ayer = restarDias(hoy, 1);
  const semana = restarDias(hoy, 7);
  const horaActual = Math.min(23, Math.floor(minuto / 60));

  const canales: CanalMonitor[] = [];
  const total = {
    hoy: CERO,
    ayer: CERO as Cifra,
    semana: CERO as Cifra,
    ayerCompleto: CERO,
    semanaCompleto: CERO,
    hoyContraAyer: CERO,
    hoyContraSemana: CERO,
  };
  const sinHoraAyer: string[] = [];
  const sinHoraSemana: string[] = [];
  // Cada curva suma solo los canales que esa curva puede partir por hora; la
  // de hoy, además, solo los que entran a alguna comparación.
  const vacia = () => Array.from({ length: 24 }, () => CERO);
  const curvas = { hoy: vacia(), ayer: vacia(), semana: vacia() };

  for (const c of CANALES_TIEMPO) {
    const serie = series.find((s) => s.canal === c.canal);
    if (!serie) continue;
    const h = diaDe(serie, hoy, minuto, true);
    const a = diaDe(serie, ayer, minuto, false);
    const s = diaDe(serie, semana, minuto, false);
    canales.push({ ...c, hoy: h.dia, ayer: a.dia, semana: s.dia });

    total.hoy = sumar(total.hoy, h.dia.completo);
    total.ayerCompleto = sumar(total.ayerCompleto, a.dia.completo);
    total.semanaCompleto = sumar(total.semanaCompleto, s.dia.completo);
    if (a.dia.aEstaHora) {
      total.ayer = sumar(total.ayer, a.dia.aEstaHora);
      total.hoyContraAyer = sumar(total.hoyContraAyer, h.dia.completo);
    } else sinHoraAyer.push(c.nombre);
    if (s.dia.aEstaHora) {
      total.semana = sumar(total.semana, s.dia.aEstaHora);
      total.hoyContraSemana = sumar(total.hoyContraSemana, h.dia.completo);
    } else sinHoraSemana.push(c.nombre);

    if (a.acum) a.acum.forEach((x, i) => (curvas.ayer[i] = sumar(curvas.ayer[i], x)));
    if (s.acum) s.acum.forEach((x, i) => (curvas.semana[i] = sumar(curvas.semana[i], x)));
    if (h.acum && (a.acum || s.acum)) h.acum.forEach((x, i) => (curvas.hoy[i] = sumar(curvas.hoy[i], x)));
  }

  return {
    hoy,
    ayer,
    semana,
    minuto,
    canales,
    total: {
      ...total,
      // con TODOS los canales sin hora no hay comparación a esta hora
      ayer: sinHoraAyer.length === canales.length && canales.length ? null : total.ayer,
      semana: sinHoraSemana.length === canales.length && canales.length ? null : total.semana,
    },
    sinHoraAyer,
    sinHoraSemana,
    curvas: { ...curvas, hoy: curvas.hoy.slice(0, horaActual + 1) },
  };
}

/** Cambio relativo; null si no hay base contra qué comparar. */
export function cambio(actual: number, base: number | null | undefined): number | null {
  if (base == null || base <= 0) return null;
  return actual / base - 1;
}

export const valorDe = (c: Cifra | null | undefined, m: Medida) => (c ? (m === "importe" ? c.i : c.u) : 0);
