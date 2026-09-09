/**
 * La vista de Ventas de MELI, ya masticada.
 *
 * Regla del dueño: la pantalla no calcula, solo presenta. Aquí se junta lo
 * que /ventas necesita —el monitor con la publicidad ya descontada, la
 * cascada real del dinero (del motor de finanzas) y los cuadres entre
 * niveles— en UN objeto. Si otra pantalla quiere las mismas cifras, pide
 * esta función y no hay dos versiones del mismo número.
 */
import {
  aplicarPublicidadAlMonitor,
  cargarMonitor,
  type Monitor,
  type RangoFechas,
} from "./ventas-monitor";
import { cargarPublicidad, type FilaPublicidad } from "./publicidad";
import { leerFinanzasMeli } from "./finanzas/leer";
import { aCentavos } from "./finanzas/motor";
import type { FinanzasPeriodo } from "./finanzas/tipos";
import type { Cuenta } from "../datos/repos";
import type { DB } from "../datos/repos";
import type { Cronometro } from "./cronometro";

/** Dos cifras que deberían ser iguales, y si no lo son, cuánto difieren. */
export interface Cuadre {
  /** Qué se compara, en palabras del dueño. */
  que: string;
  arriba: number;
  abajo: number;
  /** centavos; 0 = cuadra */
  diferencia: number;
}

export interface VistaVentas {
  monitor: Monitor;
  /** null = Product Ads no contestó; la pantalla lo declara. */
  gastoAds: number | null;
  errorAds: string | null;
  advertenciasAds: string[];
  /** ganancia del periodo con la publicidad descontada; null sin dato de ads */
  gananciaConAds: number | null;
  finanzas: FinanzasPeriodo;
  /**
   * Los totales de cada tabla contra la cifra de arriba. Se calculan AQUÍ
   * para que la pantalla los grite si no cuadran, no para esconderlos.
   */
  cuadres: Cuadre[];
}

function cuadre(que: string, arriba: number, abajo: number): Cuadre {
  return { que, arriba, abajo, diferencia: aCentavos(abajo) - aCentavos(arriba) };
}

export async function vistaVentas(
  db: DB,
  cuenta: Cuenta,
  rango: RangoFechas,
  reloj?: Cronometro,
): Promise<VistaVentas> {
  const medir = <T>(nombre: string, p: Promise<T>) => (reloj ? reloj.medir(nombre, p) : p);

  // La publicidad del mismo periodo, para que la ganancia ya la tenga
  // descontada: recibo − costo − publicidad. Si Product Ads no contesta, se
  // declara y la ganancia se muestra sin ads, nunca con un cero disfrazado.
  const [sinAds, ads, finanzas] = await Promise.all([
    medir("monitor", cargarMonitor(db, cuenta.id, rango)),
    medir(
      "publicidad",
      cargarPublicidad(db, cuenta, rango).catch((err) => ({
        filas: [] as FilaPublicidad[],
        totales: { gastoAds: 0 },
        errorAds: `No se pudo leer Product Ads: ${(err as Error).message}`,
        advertencias: [] as string[],
      })),
    ),
    medir("finanzas", leerFinanzasMeli(db, cuenta.id, rango)),
  ]);

  const gastoAds = ads.errorAds ? null : ads.totales.gastoAds;
  const adsPorModelo = ads.errorAds ? null : new Map(ads.filas.map((f) => [f.modelo, f.gastoAds]));
  const monitor = aplicarPublicidadAlMonitor(sinAds, adsPorModelo);
  const gananciaConAds = gastoAds == null ? null : monitor.desglose.gananciaReal - gastoAds;

  const sumaCategorias = (campo: "unidades7" | "importe7" | "neto7") =>
    monitor.porCategoria.reduce((a, c) => a + (c[campo] ?? 0), 0);
  const sumaModelos = (campo: "unidades7" | "importe7" | "neto7") =>
    monitor.porModelo.reduce((a, c) => a + (c[campo] ?? 0), 0);

  const cuadres: Cuadre[] = [
    cuadre("Unidades: fichas vs. por categoría", monitor.semana.unidades, sumaCategorias("unidades7")),
    cuadre("Venta: fichas vs. por categoría", monitor.semana.importe, sumaCategorias("importe7")),
    cuadre("Unidades: fichas vs. por modelo", monitor.semana.unidades, sumaModelos("unidades7")),
    cuadre("Venta: fichas vs. por modelo", monitor.semana.importe, sumaModelos("importe7")),
    // El bruto por renglón (ventas diarias) contra el bruto por orden que
    // reconstruye el motor: si difieren, hay órdenes sin renglones o
    // renglones sin orden, y eso se dice con su monto.
    cuadre(
      "Venta bruta: por renglón vs. por orden",
      monitor.semana.importe,
      finanzas.totales.bruto / 100,
    ),
  ];

  return {
    monitor,
    gastoAds,
    errorAds: ads.errorAds ?? null,
    advertenciasAds: ads.advertencias ?? [],
    gananciaConAds,
    finanzas,
    cuadres,
  };
}
