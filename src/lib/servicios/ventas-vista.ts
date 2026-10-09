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
  calcularMonitorFresco,
  claveMonitorVentas,
  fechaMx,
  normalizarRango,
  servirMonitor,
  VIDA_MONITOR_GUARDADO_MS,
  type Monitor,
  type RangoFechas,
} from "./ventas-monitor";
import {
  calcularPublicidadFresca,
  clavePublicidadMeli,
  servirPublicidad,
  VIDA_PUBLICIDAD_ABIERTA_MS,
  type FilaPublicidad,
} from "./publicidad";
import { guardarCacheApp } from "./cache-app";
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
  /** de cuándo es lo guardado (el más viejo de monitor y publicidad) */
  generadoEn: string | null;
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
  const [sinAdsServido, adsServidos, finanzas] = await Promise.all([
    medir("monitor", servirMonitor(db, cuenta.id, rango)),
    medir(
      "publicidad",
      servirPublicidad(db, cuenta, rango).catch((err) => ({
        datos: {
          filas: [] as FilaPublicidad[],
          totales: { gastoAds: 0 },
          errorAds: `No se pudo leer Product Ads: ${(err as Error).message}`,
          advertencias: [] as string[],
        },
        generadoEn: null as string | null,
        refrescando: false,
      })),
    ),
    medir("finanzas", leerFinanzasMeli(db, cuenta.id, rango)),
  ]);
  const sinAds = sinAdsServido.datos;
  const ads = adsServidos.datos;
  const generadoEn =
    [sinAdsServido.generadoEn, adsServidos.generadoEn]
      .filter((x): x is string => !!x)
      .sort()[0] ?? null;

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
    generadoEn,
  };
}

/**
 * Lo que /ventas y la tabla de modelos piden, con la publicidad ya aplicada:
 * para quien solo quiere las filas por modelo (la ruta de la tabla) sin la
 * cascada del dinero. Lee los mismos renglones guardados que la página.
 */
export async function filasModeloServidas(db: DB, cuenta: Cuenta, rango: RangoFechas) {
  const [monitor, publicidad] = await Promise.all([
    servirMonitor(db, cuenta.id, rango),
    servirPublicidad(db, cuenta, rango).catch((err) => ({
      datos: {
        filas: [] as FilaPublicidad[],
        errorAds: `No se pudo leer Product Ads: ${(err as Error).message}`,
      },
    })),
  ]);
  const ads = publicidad.datos;
  const adsPorModelo = ads.errorAds ? null : new Map(ads.filas.map((f) => [f.modelo, f.gastoAds]));
  return aplicarPublicidadAlMonitor(monitor.datos, adsPorModelo).porModelo;
}

/**
 * Deja masticados los rangos por omisión de /ventas (7 días) y /publicidad
 * (30 días) para que la primera visita lea un renglón. Lo llama el latido;
 * cada pieza solo se recalcula si su renglón tiene más de 10 minutos o está
 * invalidado, así que correrlo seguido cuesta dos lecturas.
 */
export async function precalcularPantallasVentas(
  admin: DB,
  cuenta: { id: string; site_id: string },
  limite: number,
): Promise<{ recalculadas: string[] }> {
  const siete = normalizarRango();
  const treinta = normalizarRango(fechaMx(29));
  const tareas: { clave: string; vida: number; calcular: () => Promise<unknown> }[] = [
    {
      clave: claveMonitorVentas(siete),
      vida: VIDA_MONITOR_GUARDADO_MS,
      calcular: () => calcularMonitorFresco(admin, cuenta.id, siete),
    },
    {
      clave: clavePublicidadMeli(siete),
      vida: VIDA_PUBLICIDAD_ABIERTA_MS,
      calcular: () => calcularPublicidadFresca(admin, cuenta, siete),
    },
    {
      clave: clavePublicidadMeli(treinta),
      vida: VIDA_PUBLICIDAD_ABIERTA_MS,
      calcular: () => calcularPublicidadFresca(admin, cuenta, treinta),
    },
  ];
  const { data } = await admin
    .from("app_cache")
    .select("clave, generado_en, vigente")
    .eq("account_id", cuenta.id)
    .in("clave", tareas.map((t) => t.clave));
  const guardadas = new Map(((data ?? []) as any[]).map((f) => [String(f.clave), f]));

  const recalculadas: string[] = [];
  for (const t of tareas) {
    if (Date.now() > limite) break;
    const g = guardadas.get(t.clave);
    const fresca =
      g && g.vigente !== false && Date.now() - Date.parse(g.generado_en) < t.vida - 30_000;
    if (fresca) continue;
    const t0 = Date.now();
    const datos = await t.calcular();
    await guardarCacheApp(admin, cuenta.id, t.clave, datos, Date.now() - t0);
    recalculadas.push(t.clave);
  }
  return { recalculadas };
}
