/**
 * GETAC WRAPPED: el año del negocio contado como el «Wrapped» de Spotify
 * (dueño, 18-oct-2026: «algo divertido de mi negocio que esté padre»).
 *
 * Motor puro: junta el año ya sumado (`sumarAnio`, de los estados de
 * resultados guardados) con la venta por día y por hora de los cuatro
 * canales (`ventas_por_hora`) y saca las tarjetas: cuánto se vendió, el
 * modelo estrella, el mejor día, la hora y el día de la semana en que más
 * se compra, el canal favorito, el mejor mes y la utilidad. No inventa: una
 * tarjeta sin datos para armarse no sale.
 */
import type { Anio } from "./consolidado-anio";
import type { VentasTiempo } from "../graficas/ventas-tiempo";
import { CANALES_TIEMPO } from "../graficas/ventas-tiempo";

/** Lo que mide de largo una caja de zapato, en metros (para la fila de cajas). */
export const LARGO_CAJA_M = 0.33;
/** El Zócalo de la CDMX mide ~240 m por lado: una vuelta son ~960 m. */
export const VUELTA_ZOCALO_M = 960;

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export interface DiaTop {
  fecha: string;
  importe: number;
  unidades: number;
  ordenes: number;
  diaSemana: string;
}

export interface Wrapped {
  ejercicio: number;
  desde: string;
  hasta: string;
  unidades: number;
  ventaBruta: number;
  utilidadNeta: number;
  margen: number | null;
  /** pares de calzado (todo lo que no es funda) */
  pares: number;
  /** km que medirían esos pares en fila, caja tras caja */
  kmEnFila: number;
  vueltasZocalo: number;
  /** cada cuántos segundos se vendió una unidad, en promedio */
  segundosPorUnidad: number | null;
  diasConVenta: number;
  modeloEstrella: { modelo: string; categoria: string; unidades: number; importe: number } | null;
  modeloQueMasDejo: { modelo: string; ganancia: number; unidades: number } | null;
  /** cuántos modelos distintos se vendieron */
  modelos: number;
  categoriaReina: { categoria: string; unidades: number; parte: number } | null;
  mejorDia: DiaTop | null;
  /** hora de México (0–23) con más venta en todo el año */
  horaPico: { hora: number; parte: number } | null;
  diaSemanaFavorito: { dia: string; parte: number } | null;
  canalFavorito: { nombre: string; color: string; parte: number; unidades: number } | null;
  canales: { nombre: string; color: string; parte: number }[];
  mejorMes: { periodo: string; utilidadNeta: number; ventaBruta: number } | null;
}

const diaSemanaDe = (f: string) => DIAS_SEMANA[new Date(`${f}T12:00:00Z`).getUTCDay()];

/** Arma el Wrapped (puro). `series` puede venir incompleta: un canal que falló no aporta. */
export function armarWrapped(anio: Anio, series: VentasTiempo[], desde: string, hasta: string): Wrapped {
  const t = anio.total;

  // Por día, por hora y por día de la semana, los cuatro canales juntos.
  const porDia = new Map<string, { i: number; u: number; o: number }>();
  const porHora = new Array(24).fill(0) as number[];
  const porSemana = new Array(7).fill(0) as number[];
  const porCanal = new Map<string, number>();
  for (const s of series) {
    for (const d of s.dias) {
      if (d.f < desde || d.f > hasta) continue;
      const v = porDia.get(d.f) ?? { i: 0, u: 0, o: 0 };
      v.i += d.i;
      v.u += d.u;
      v.o += d.o;
      porDia.set(d.f, v);
      porSemana[new Date(`${d.f}T12:00:00Z`).getUTCDay()] += d.i;
      porCanal.set(s.canal, (porCanal.get(s.canal) ?? 0) + d.i);
    }
    for (const h of s.horas) {
      if (h.f < desde || h.f > hasta || h.h < 0 || h.h > 23) continue;
      porHora[h.h] += h.i;
    }
  }

  let mejorDia: DiaTop | null = null;
  for (const [fecha, v] of porDia) {
    if (v.i > 0 && (!mejorDia || v.i > mejorDia.importe)) {
      mejorDia = { fecha, importe: v.i, unidades: v.u, ordenes: v.o, diaSemana: diaSemanaDe(fecha) };
    }
  }
  const diasConVenta = [...porDia.values()].filter((v) => v.u > 0).length;

  const sumaHoras = porHora.reduce((a, b) => a + b, 0);
  const hora = sumaHoras > 0 ? porHora.indexOf(Math.max(...porHora)) : -1;
  const sumaSemana = porSemana.reduce((a, b) => a + b, 0);
  const dia = sumaSemana > 0 ? porSemana.indexOf(Math.max(...porSemana)) : -1;

  // Canales: del año sumado (venta bruta), que es lo que cuadra con el corte.
  const ventaCanales = anio.canales.reduce((a, k) => a + Math.max(0, k.ventaBruta), 0);
  const colorDe = (canal: string) => CANALES_TIEMPO.find((x) => x.canal === canal)?.color ?? "#8b6640";
  const canales = anio.canales
    .filter((k) => k.ventaBruta > 0 && ventaCanales > 0)
    .map((k) => ({ nombre: k.nombre, color: colorDe(k.canal), parte: k.ventaBruta / ventaCanales, unidades: k.unidades }));
  const canalFavorito = canales[0] ?? null;

  const conVenta = anio.modelos.filter((m) => m.unidades > 0);
  const estrella = [...conVenta].sort((a, b) => b.unidades - a.unidades || b.importe - a.importe)[0];
  const dejo = conVenta.filter((m) => (m.ganancia ?? 0) > 0).sort((a, b) => (b.ganancia ?? 0) - (a.ganancia ?? 0))[0];

  const unidadesCat = anio.categorias.reduce((a, c) => a + c.unidades, 0);
  const reina = [...anio.categorias].sort((a, b) => b.unidades - a.unidades)[0];

  const pares = conVenta.filter((m) => m.categoria !== "Fundas").reduce((a, m) => a + m.unidades, 0);
  const metros = pares * LARGO_CAJA_M;

  // El ritmo cuenta los días desde la primera venta hasta el último día leído.
  const fechas = [...porDia.keys()].filter((f) => (porDia.get(f)?.u ?? 0) > 0).sort();
  const dias = fechas.length
    ? Math.round((Date.parse(`${fechas[fechas.length - 1]}T12:00:00Z`) - Date.parse(`${fechas[0]}T12:00:00Z`)) / 86_400_000) + 1
    : 0;

  const cerrados = anio.meses.filter((m) => !m.sinDatos && !m.enCurso);
  const mejorMes = [...cerrados].sort((a, b) => b.utilidadNeta - a.utilidadNeta)[0];

  return {
    ejercicio: anio.ejercicio,
    desde,
    hasta,
    unidades: t.unidades,
    ventaBruta: t.ventaBruta,
    utilidadNeta: t.utilidadNeta,
    margen: t.margen,
    pares,
    kmEnFila: metros / 1000,
    vueltasZocalo: metros / VUELTA_ZOCALO_M,
    segundosPorUnidad: dias > 0 && t.unidades > 0 ? (dias * 86_400) / t.unidades : null,
    diasConVenta,
    modeloEstrella: estrella
      ? { modelo: estrella.modelo, categoria: estrella.categoria, unidades: estrella.unidades, importe: estrella.importe }
      : null,
    modeloQueMasDejo: dejo ? { modelo: dejo.modelo, ganancia: dejo.ganancia ?? 0, unidades: dejo.unidades } : null,
    modelos: conVenta.length,
    categoriaReina: reina && unidadesCat > 0 ? { categoria: reina.categoria, unidades: reina.unidades, parte: reina.unidades / unidadesCat } : null,
    mejorDia,
    horaPico: hora >= 0 ? { hora, parte: porHora[hora] / sumaHoras } : null,
    diaSemanaFavorito: dia >= 0 ? { dia: DIAS_SEMANA[dia], parte: porSemana[dia] / sumaSemana } : null,
    canalFavorito: canalFavorito
      ? { nombre: canalFavorito.nombre, color: canalFavorito.color, parte: canalFavorito.parte, unidades: canalFavorito.unidades }
      : null,
    canales: canales.map(({ nombre, color, parte }) => ({ nombre, color, parte })),
    mejorMes: mejorMes ? { periodo: mejorMes.periodo, utilidadNeta: mejorMes.utilidadNeta, ventaBruta: mejorMes.ventaBruta } : null,
  };
}

/** «cada 23 segundos», «cada 2 minutos»… */
export function ritmoEnPalabras(segundos: number): string {
  if (segundos < 1.5) return "más de una por segundo";
  if (segundos < 90) return `una cada ${Math.round(segundos)} segundos`;
  const min = segundos / 60;
  if (min < 90) return `una cada ${Math.round(min)} minutos`;
  return `una cada ${Math.round(min / 60)} horas`;
}

/** «9 de la noche», «12 del día», «10 de la mañana». */
export function horaEnPalabras(h: number): string {
  if (h === 0) return "12 de la noche";
  if (h === 12) return "12 del día";
  if (h < 12) return `${h} de la ${h < 6 ? "madrugada" : "mañana"}`;
  const h12 = h - 12;
  return `${h12} de la ${h12 < 8 ? "tarde" : "noche"}`;
}

/** El resumen en texto, para mandarlo por WhatsApp. */
export function textoParaCompartir(w: Wrapped, nombreEjercicio: string, pesos: (x: number) => string): string {
  const l: string[] = [`🥿 GETAC Wrapped ${nombreEjercicio}`];
  l.push(`${w.unidades.toLocaleString("es-MX")} unidades vendidas · ${pesos(w.ventaBruta)} de venta`);
  if (w.pares > 0) l.push(`${w.pares.toLocaleString("es-MX")} pares en fila = ${w.kmEnFila.toFixed(1)} km de cajas`);
  if (w.modeloEstrella) l.push(`⭐ Modelo estrella: ${w.modeloEstrella.modelo} (${w.modeloEstrella.unidades.toLocaleString("es-MX")})`);
  if (w.mejorDia) l.push(`🔥 Mejor día: ${w.mejorDia.fecha} con ${pesos(w.mejorDia.importe)}`);
  if (w.horaPico) l.push(`🕘 Hora pico: las ${horaEnPalabras(w.horaPico.hora)}`);
  if (w.canalFavorito) l.push(`🏆 Canal favorito: ${w.canalFavorito.nombre} (${Math.round(w.canalFavorito.parte * 100)} %)`);
  l.push(`💰 Utilidad neta: ${pesos(w.utilidadNeta)}`);
  return l.join("\n");
}
