/**
 * Monitor de ventas con costos y ganancia.
 *
 * Por SKU y por diseño, en el periodo elegido: unidades, importe de lista,
 * comisión de MELI, neto real depositado, costo y ganancia. Regla del
 * dueño: NADA se estima. Un renglón cuyo depósito aún no se ha leído de
 * Mercado Pago aporta cero al neto y a la ganancia, y se declara aparte
 * (venta y unidades sin neto); el cron de netos lo completa solo.
 */
import type { DB } from "../datos/repos";
import { mapaCostosUnificado, soloCostos } from "../servicios/costos-unificados";
import { costoDeSku } from "./costos";
import { hoyMx, restarDias, rpcTodo } from "./db";
import { desglosar } from "./sku";
import { guardarCacheYz, leerCacheYzGuardado } from "./cache";

export interface Rango {
  desde: string;
  hasta: string;
}

export function normalizarRango(desde?: string, hasta?: string): Rango {
  const hoy = hoyMx();
  const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const h = ok(hasta) ?? hoy;
  const d = ok(desde) ?? restarDias(h, 29);
  return d <= h ? { desde: d, hasta: h } : { desde: h, hasta: d };
}

export interface Totales {
  unidades: number;
  ordenes: number;
  importe: number;
  comision: number;
  neto: number;
  costo: number;
  ganancia: number;
  /** Unidades cuyo depósito todavía no se ha leído: fuera del neto y de la ganancia. */
  unidadesSinNeto: number;
  /** Venta (importe) de esas unidades: se declara, nunca se estima. */
  ventaSinNeto: number;
  /** Unidades sin costo cargado (la ganancia no las cuenta como costo 0). */
  unidadesSinCosto: number;
  /** Neto de los SKUs CON costo cargado: la única parte con ganancia calculable. */
  netoConCosto: number;
  /**
   * Neto de los SKUs SIN costo cargado. NO entra a la ganancia (contarlo
   * como si costara $0 la inflaba); se declara aparte.
   */
  netoSinCosto: number;
}

export interface FilaVentas extends Totales {
  clave: string;
  titulo?: string | null;
  diseno: string;
  precioPromedio: number;
  margen: number | null;
  costoUnitario: number | null;
}

export interface DiaVentas {
  fecha: string;
  unidades: number;
  importe: number;
  neto: number;
}

export interface Monitor {
  rango: Rango;
  hoy: Totales;
  ayer: Totales;
  periodo: Totales;
  anterior: Totales;
  porSku: FilaVentas[];
  porDiseno: FilaVentas[];
  porDia: DiaVentas[];
  skusSinCosto: number;
  /** Qué falta por leer: se declara, nunca se rellena. */
  pendiente: {
    /** órdenes del periodo que siguen sin depósito real (se completan solas) */
    ordenesPendientes: number;
  };
}

function vacio(): Totales {
  return { unidades: 0, ordenes: 0, importe: 0, comision: 0, neto: 0, costo: 0, ganancia: 0, unidadesSinNeto: 0, ventaSinNeto: 0, unidadesSinCosto: 0, netoConCosto: 0, netoSinCosto: 0 };
}

interface FilaResumen {
  sku: string;
  unidades: number;
  ordenes: number;
  importe: number;
  comision: number;
  /** solo el neto REAL (renglones con depósito conocido) */
  neto: number;
  unidades_sin_neto: number;
  importe_sin_neto: number;
  comision_sin_neto: number;
}

/**
 * Suma un renglón del RPC a los totales. Solo el neto REAL entra al neto y
 * a la ganancia; la venta sin depósito leído se acumula aparte para
 * declararla. Pura, para probarla.
 */
export function sumarResumen(t: Totales, f: FilaResumen, costoUnit: number | null): void {
  t.unidades += Number(f.unidades);
  t.ordenes += Number(f.ordenes);
  t.importe += Number(f.importe);
  t.comision += Number(f.comision);
  const netoFila = Number(f.neto) || 0;
  t.neto += netoFila;
  t.ventaSinNeto += Number(f.importe_sin_neto ?? 0);
  t.unidadesSinNeto += Number(f.unidades_sin_neto ?? 0);
  // Las unidades sin depósito leído quedan FUERA de la ganancia por los dos
  // lados: ni su neto (no se conoce) ni su costo. Restar el costo de todas
  // las unidades contra el neto de unas cuantas daba una ganancia negativa
  // de más de un millón (9-sep-2026).
  const unidadesConNeto = Math.max(0, Number(f.unidades) - Number(f.unidades_sin_neto ?? 0));
  if (costoUnit == null) {
    t.unidadesSinCosto += Number(f.unidades);
    t.netoSinCosto += netoFila;
  } else {
    t.costo += costoUnit * unidadesConNeto;
    t.netoConCosto += netoFila;
  }
  // La ganancia SOLO cubre la venta con costo cargado y depósito leído.
  // Antes era neto − costo con TODO el neto adentro: el neto de miles de
  // SKUs sin costo entraba como ganancia pura y la inflaba. Sin costo no
  // hay ganancia calculable; se declara, nunca se rellena con cero.
  t.ganancia = t.netoConCosto - t.costo;
}

/**
 * Las sumas se hacen EN la base (yz_ventas_resumen / yz_ventas_por_dia):
 * un periodo de 30 días son ~126 mil renglones diarios y traerlos a la
 * página la tumbaba por tiempo.
 */
export async function cargarMonitor(db: DB, accountId: string, rango: Rango): Promise<Monitor> {
  const dias = Math.round((Date.parse(rango.hasta) - Date.parse(rango.desde)) / 86_400_000) + 1;
  const anterior: Rango = { hasta: restarDias(rango.desde, 1), desde: restarDias(rango.desde, dias) };
  const hoy = hoyMx();
  const ayer = restarDias(hoy, 1);

  const resumen = (desde: string, hasta: string) =>
    rpcTodo<FilaResumen>(db, "yz_ventas_resumen", { p_account: accountId, p_desde: desde, p_hasta: hasta }, ["sku"]);

  // Cuántas órdenes del periodo siguen sin depósito leído: se declara.
  const observados = async (desde: string, hasta: string) => {
    const { data, error } = await db.rpc("yz_netos_observados", { p_account: accountId, p_desde: desde, p_hasta: hasta });
    if (error) throw new Error(`yz_netos_observados: ${error.message}`);
    const f: any = Array.isArray(data) ? data[0] : data;
    return { pendientes: Number(f?.ordenes_pendientes ?? 0) };
  };

  // Los títulos SOLO de los SKUs que vendieron en el periodo: antes se bajaba
  // el catálogo completo (~15 mil variantes) para ponerle título a la tabla.
  const pPeriodo = resumen(rango.desde, rango.hasta);
  const pTitulos = pPeriodo.then((filas) => titulosDeSkus(db, accountId, filas.map((f) => f.sku)));

  const [rPeriodo, rAnterior, rHoy, rAyer, porDiaFilas, titulos, mapaUnificado, obsPeriodo] = await Promise.all([
    pPeriodo,
    resumen(anterior.desde, anterior.hasta),
    resumen(hoy, hoy),
    resumen(ayer, ayer),
    rpcTodo<{ fecha: string; unidades: number; importe: number; neto: number; importe_sin_neto: number; comision_sin_neto: number }>(db, "yz_ventas_por_dia", { p_account: accountId, p_desde: rango.desde, p_hasta: rango.hasta }, ["fecha"]),
    pTitulos,
    // Los costos viven en Productos y costos (calzado y fundas juntos);
    // yz_costos queda de respaldo.
    mapaCostosUnificado(db, { yzAccountId: accountId }),
    observados(rango.desde, rango.hasta),
  ]);

  const costos = soloCostos(mapaUnificado);
  const cacheCosto = new Map<string, number | null>();
  const costoDe = (sku: string) => {
    let c = cacheCosto.get(sku);
    if (c === undefined) {
      c = costoDeSku(sku, costos);
      cacheCosto.set(sku, c);
    }
    return c;
  };

  const m: Monitor = {
    rango,
    hoy: vacio(),
    ayer: vacio(),
    periodo: vacio(),
    anterior: vacio(),
    porSku: [],
    porDiseno: [],
    porDia: [],
    skusSinCosto: 0,
    pendiente: { ordenesPendientes: obsPeriodo.pendientes },
  };

  for (const f of rHoy) sumarResumen(m.hoy, f, costoDe(f.sku));
  for (const f of rAyer) sumarResumen(m.ayer, f, costoDe(f.sku));
  for (const f of rAnterior) sumarResumen(m.anterior, f, costoDe(f.sku));

  const porSku = new Map<string, FilaVentas>();
  const porDiseno = new Map<string, FilaVentas>();
  const sinCosto = new Set<string>();
  for (const f of rPeriodo) {
    const costoUnit = costoDe(f.sku);
    if (costoUnit == null) sinCosto.add(f.sku);
    sumarResumen(m.periodo, f, costoUnit);

    const diseno = desglosar(f.sku).diseno;
    const fs = porSku.get(f.sku) ?? { ...vacio(), clave: f.sku, titulo: titulos.get(f.sku), diseno, precioPromedio: 0, margen: null, costoUnitario: costoUnit };
    sumarResumen(fs, f, costoUnit);
    porSku.set(f.sku, fs);

    const fd = porDiseno.get(diseno) ?? { ...vacio(), clave: diseno, diseno, precioPromedio: 0, margen: null, costoUnitario: null };
    sumarResumen(fd, f, costoUnit);
    porDiseno.set(diseno, fd);
  }

  const cerrar = (f: FilaVentas): FilaVentas => ({
    ...f,
    precioPromedio: f.unidades ? f.importe / f.unidades : 0,
    margen: f.neto > 0 && f.unidadesSinCosto === 0 ? f.ganancia / f.neto : null,
  });

  m.porSku = [...porSku.values()].map(cerrar).sort((a, b) => b.unidades - a.unidades);
  m.porDiseno = [...porDiseno.values()].map(cerrar).sort((a, b) => b.unidades - a.unidades);
  m.porDia = porDiaFilas.map((d) => ({
    fecha: d.fecha,
    unidades: Number(d.unidades),
    importe: Number(d.importe),
    // Solo el neto real; lo sin depósito leído no se estima.
    neto: Number(d.neto) || 0,
  }));
  m.skusSinCosto = sinCosto.size;
  return m;
}

/** Cuántos SKUs por consulta `.in()`: la lista viaja en la URL. */
const TANDA_TITULOS = 300;

/** El título de cada SKU pedido, leído por tandas (solo los que hacen falta). */
async function titulosDeSkus(db: DB, accountId: string, skus: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unicos = [...new Set(skus)];
  for (const tanda of partirEnTandas(unicos, TANDA_TITULOS)) {
    const { data, error } = await db.from("yz_skus").select("sku, titulo").eq("account_id", accountId).in("sku", tanda);
    if (error) throw new Error(`yz_skus: ${error.message}`);
    for (const f of (data ?? []) as { sku: string; titulo: string | null }[]) out.set(f.sku, f.titulo);
  }
  return out;
}

/** Parte una lista en tandas de `tamano` (pura). */
export function partirEnTandas<T>(lista: T[], tamano: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) out.push(lista.slice(i, i + tamano));
  return out;
}

// ─── Masticado en yz_cache ──────────────────────────────────────────────

/**
 * El monitor se guarda por rango en `yz_cache` («ventas:v1:desde:hasta»).
 * Todo renglón trae las fichas de HOY y AYER, así que cualquier rango se
 * refresca a los 10 minutos (en el fondo; la pantalla sirve lo guardado).
 */
export const TTL_VENTAS_MS = 10 * 60_000;
/** Los rangos que nadie volvió a ver se borran después de esto. */
export const VIDA_VENTAS_MS = 3 * 86_400_000;

export function claveVentas(rango: Rango): string {
  return `ventas:v1:${rango.desde}:${rango.hasta}`;
}

/** ¿El renglón guardado necesita refresco de fondo? (pura) */
export function ventasNecesitaRefresco(generadoEn: string, vigente: boolean, ahora = Date.now()): boolean {
  if (!vigente) return true;
  const generado = Date.parse(generadoEn);
  if (!Number.isFinite(generado)) return true;
  return ahora - generado > TTL_VENTAS_MS;
}

/** Calcula y guarda el monitor del rango (lo que hace el cron y el fondo). */
export async function recalcularMonitorYz(db: DB, accountId: string, rango: Rango): Promise<Monitor> {
  const t0 = Date.now();
  const m = await cargarMonitor(db, accountId, rango);
  await guardarCacheYz(db, accountId, claveVentas(rango), m, Date.now() - t0);
  return m;
}

/**
 * Lo que lee la pantalla: el monitor guardado aunque esté viejo (con su
 * fecha, para `Frescura`); si le toca, se refresca en el fondo con `after()`
 * y el cliente `dbFondo` (admin: con el del usuario el cálculo choca con el
 * límite de 8 s por consulta). Solo sin renglón se calcula en el clic.
 */
export async function obtenerMonitorYz(
  db: DB,
  accountId: string,
  rango: Rango,
  opts: { dbFondo?: DB } = {},
): Promise<{ monitor: Monitor; generadoEn: string | null }> {
  const guardado = await leerCacheYzGuardado<Monitor>(db, accountId, claveVentas(rango));
  if (guardado.estado !== "encontrado") {
    // Sin renglón (o sin poder leerlo): se calcula aquí y se guarda.
    const monitor = await recalcularMonitorYz(db, accountId, rango);
    return { monitor, generadoEn: null };
  }
  const { datos, generadoEn, vigente } = guardado.valor;
  if (ventasNecesitaRefresco(generadoEn, vigente)) {
    const dbFondo = opts.dbFondo ?? db;
    try {
      const { after } = await import("next/server");
      after(async () => {
        try {
          await recalcularMonitorYz(dbFondo, accountId, rango);
        } catch (err) {
          console.error(`ventas fundas ${rango.desde}…${rango.hasta}: refresco de fondo:`, (err as Error).message);
        }
      });
    } catch {
      // Fuera de un request: el guardado sirve igual.
    }
  }
  return { monitor: datos, generadoEn };
}

/** Borra los rangos de ventas que nadie ha vuelto a pedir (los guarda cada filtro de fechas). */
export async function limpiarVentasViejasYz(db: DB, accountId: string): Promise<void> {
  const limite = new Date(Date.now() - VIDA_VENTAS_MS).toISOString();
  const { error } = await db.from("yz_cache").delete().eq("account_id", accountId).like("clave", "ventas:%").lt("generado_en", limite);
  if (error) console.error("yz_cache (ventas viejas):", error.message);
}
