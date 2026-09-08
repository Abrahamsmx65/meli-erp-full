/**
 * Caché por PERIODO de los cortes mensuales (MELI calzado y fundas).
 *
 * Armar un estado de resultados baja renglones de venta, órdenes agregadas,
 * catálogo, cargos, gastos y publicidad: segundos por mes. Cambiar de mes en
 * la pantalla debe ser leer un renglón, así que cada periodo se guarda
 * masticado (app_cache «corte:YYYY-MM» en calzado; yz_cache igual en fundas)
 * y la pantalla SIEMPRE sirve lo guardado; el refresco corre por atrás:
 *
 *   · mes CORRIENTE: se refresca en el fondo si tiene más de 10 minutos
 *     (las ventas y los netos se mueven todo el día);
 *   · mes CERRADO calculado con el mes aún abierto: le faltan días — se
 *     refresca en el fondo una vez;
 *   · mes CERRADO calculado ya cerrado: casi congelado; solo lo mueven una
 *     revisión tardía, un cargo o un gasto — refresco de fondo cada 6 horas
 *     y las rutas que escriben (gastos) lo recalculan al momento.
 *
 * El corte GUARDADO (cortes_meli / yz_cortes, el congelado a mano) es otra
 * cosa y no pasa por aquí: ese ya es un renglón.
 */
import type { Cuenta, DB } from "../datos/repos";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { cargarEstadoResultados, periodoActual, periodoSiguiente, type EstadoResultados } from "./corte-meli";
import { guardarCacheYz, leerCacheYzGuardado } from "../yapanizcel/cache";
import { cargarEstadoResultadosYz } from "../yapanizcel/corte";
import type { CuentaYz } from "../yapanizcel/cuenta";

export const claveCorte = (periodo: string): string => `corte:${periodo}`;

/** ¿El renglón guardado del periodo necesita un refresco de fondo? (pura) */
export function corteNecesitaRefresco(
  periodo: string,
  generadoEn: string,
  vigente: boolean,
  ahora = Date.now(),
  hoyPeriodo = periodoActual(),
): boolean {
  if (!vigente) return true;
  const generado = Date.parse(generadoEn);
  if (!Number.isFinite(generado)) return true;
  const edadMs = ahora - generado;
  if (periodo >= hoyPeriodo) return edadMs > 10 * 60_000;
  // El mes cerró a la medianoche de México (~06:00 UTC del día 1 siguiente):
  // un renglón calculado antes de eso no vio los últimos días del mes.
  const cierre = Date.parse(`${periodoSiguiente(periodo)}-01T07:00:00Z`);
  if (generado < cierre) return true;
  return edadMs > 6 * 3_600_000;
}

interface Guardado {
  datos: EstadoResultados;
  generadoEn: string;
  vigente: boolean;
}

/**
 * Sirve el corte guardado del periodo y, si le toca, lo refresca en el
 * fondo con `after()` (fuera de un request no hay fondo y se queda como
 * está). Solo sin renglón —primera vez— se calcula en el clic.
 */
async function obtenerConCachePorPeriodo(opts: {
  periodo: string;
  leer: () => Promise<Guardado | null>;
  guardar: (datos: EstadoResultados, msCalculo: number) => Promise<void>;
  calcular: () => Promise<EstadoResultados>;
}): Promise<EstadoResultados> {
  const recalc = async (): Promise<EstadoResultados> => {
    const t0 = Date.now();
    const e = await opts.calcular();
    await opts.guardar(e, Date.now() - t0);
    return e;
  };

  const guardado = await opts.leer();
  if (!guardado) return recalc();

  if (corteNecesitaRefresco(opts.periodo, guardado.generadoEn, guardado.vigente)) {
    try {
      const { after } = await import("next/server");
      after(async () => {
        try {
          await recalc();
        } catch (err) {
          console.error(`corte ${opts.periodo}: refresco de fondo:`, (err as Error).message);
        }
      });
    } catch {
      // Fuera de un request (pruebas, scripts): sin fondo; el dato guardado sirve igual.
    }
  }
  return guardado.datos;
}

/** El corte de MELI (calzado) del periodo, masticado. */
export async function obtenerEstadoResultadosMeli(db: DB, cuenta: Cuenta, periodo: string): Promise<EstadoResultados> {
  return obtenerConCachePorPeriodo({
    periodo,
    leer: () => leerCacheAppGuardado<EstadoResultados>(db, cuenta.id, claveCorte(periodo)),
    guardar: (datos, ms) => guardarCacheApp(db, cuenta.id, claveCorte(periodo), datos, ms),
    calcular: () => cargarEstadoResultados(db, cuenta, periodo),
  });
}

/** El corte de fundas del periodo, masticado. */
export async function obtenerEstadoResultadosYz(db: DB, cuenta: CuentaYz, periodo: string): Promise<EstadoResultados> {
  return obtenerConCachePorPeriodo({
    periodo,
    leer: () => leerCacheYzGuardado<EstadoResultados>(db, cuenta.id, claveCorte(periodo)),
    guardar: (datos, ms) => guardarCacheYz(db, cuenta.id, claveCorte(periodo), datos, ms),
    calcular: () => cargarEstadoResultadosYz(db, cuenta, periodo),
  });
}

/**
 * Recalcula el corte del periodo AHORA y deja el renglón fresco. Lo llaman
 * las rutas que escriben algo que mueve la cuenta (un gasto) y el hacer
 * corte: quien capturó quiere ver el efecto al recargar, no en 10 minutos.
 */
export async function refrescarCorteMeli(db: DB, cuenta: Cuenta, periodo: string): Promise<EstadoResultados> {
  const t0 = Date.now();
  const e = await cargarEstadoResultados(db, cuenta, periodo);
  await guardarCacheApp(db, cuenta.id, claveCorte(periodo), e, Date.now() - t0);
  return e;
}

export async function refrescarCorteYz(db: DB, cuenta: CuentaYz, periodo: string): Promise<EstadoResultados> {
  const t0 = Date.now();
  const e = await cargarEstadoResultadosYz(db, cuenta, periodo);
  await guardarCacheYz(db, cuenta.id, claveCorte(periodo), e, Date.now() - t0);
  return e;
}

/** Guarda un estado recién calculado como el renglón del periodo (sin recalcular). */
export async function guardarCorteEnCacheMeli(db: DB, accountId: string, periodo: string, e: EstadoResultados): Promise<void> {
  await guardarCacheApp(db, accountId, claveCorte(periodo), e, 0);
}

export async function guardarCorteEnCacheYz(db: DB, accountId: string, periodo: string, e: EstadoResultados): Promise<void> {
  await guardarCacheYz(db, accountId, claveCorte(periodo), e, 0);
}
