/**
 * Reconstrucción del stock disponible día por día.
 *
 * Esta es la pieza que hace que el sistema no se engañe solo: si un SKU
 * estuvo agotado 40 de los últimos 90 días, sus ventas se ven bajas, pero
 * su demanda real no lo es. Para corregirlo primero hay que saber
 * exactamente qué días tuvo stock.
 *
 * Fuentes, en orden de confianza:
 *   1. snapshots diarios que nosotros mismos guardamos (verdad medida)
 *   2. las operaciones de inventario de MELI (entradas, ventas, ajustes),
 *      que nos dejan caminar hacia atrás desde el stock de hoy
 *   3. inferencia a partir del patrón de ventas, cuando no hay nada más
 */
import { aISO, rangoFechas, sumarDias } from "./fechas";
import type {
  DiaStock,
  ISODate,
  OperacionStock,
  OrigenDia,
  SnapshotStock,
  StockFull,
  VentaDiaria,
} from "./types";

interface Entrada {
  skus: string[];
  desde: ISODate;
  hasta: ISODate;
  stockActual: Map<string, StockFull>;
  snapshots: SnapshotStock[];
  operaciones: OperacionStock[];
  ventas: VentaDiaria[];
}

/** Agrupa por SKU y luego por día. */
function agrupar<T extends { sku: string }>(
  filas: T[],
  fechaDe: (f: T) => ISODate,
): Map<string, Map<ISODate, T[]>> {
  const out = new Map<string, Map<ISODate, T[]>>();
  for (const f of filas) {
    let porSku = out.get(f.sku);
    if (!porSku) {
      porSku = new Map();
      out.set(f.sku, porSku);
    }
    const d = fechaDe(f);
    const lista = porSku.get(d);
    if (lista) lista.push(f);
    else porSku.set(d, [f]);
  }
  return out;
}

export function reconstruirStockDiario(e: Entrada): Map<string, DiaStock[]> {
  const fechas = rangoFechas(e.desde, e.hasta);
  // El día del negocio es el de México (UTC-6): con el día UTC, un plan
  // corrido en la tarde-noche usaba "mañana" como hoy.
  const hoy = aISO(new Date(Date.now() - 6 * 3_600_000));

  const snapPorSku = agrupar(e.snapshots, (s) => s.fecha);
  // Las operaciones llegan como timestamptz en UTC: su DÍA es el de México,
  // no el corte de los primeros 10 caracteres (un agotamiento de las 8 pm
  // caía en el día siguiente y descuadraba contra las ventas).
  const opsPorSku = agrupar(e.operaciones, (o) => {
    const t = Date.parse(o.fecha);
    return Number.isFinite(t)
      ? new Date(t - 6 * 3_600_000).toISOString().slice(0, 10)
      : o.fecha.slice(0, 10);
  });
  const ventasPorSku = agrupar(e.ventas, (v) => v.fecha);

  const salida = new Map<string, DiaStock[]>();

  for (const sku of e.skus) {
    const snaps: Map<ISODate, SnapshotStock[]> = snapPorSku.get(sku) ?? new Map();
    const ops: Map<ISODate, OperacionStock[]> = opsPorSku.get(sku) ?? new Map();
    const ventasDia: Map<ISODate, VentaDiaria[]> = ventasPorSku.get(sku) ?? new Map();

    const unidadesDe = (f: ISODate) =>
      (ventasDia.get(f) ?? []).reduce((a, v) => a + (v.unidades || 0), 0);

    // --- Anclaje -----------------------------------------------------------
    // Punto de partida para caminar hacia atrás: el stock de hoy si la ventana
    // llega hasta hoy; si no, el snapshot más reciente que tengamos.
    let ancla: number | null = null;
    if (e.hasta >= hoy) {
      ancla = e.stockActual.get(sku)?.disponible ?? null;
    }
    if (ancla === null) {
      for (let i = fechas.length - 1; i >= 0; i--) {
        const s = snaps.get(fechas[i])?.[0];
        if (s) {
          ancla = s.disponible;
          break;
        }
      }
    }

    const hayHistorial = ops.size > 0 || snaps.size > 0;

    // El primer día con evidencia real (foto o movimiento). Antes de él no
    // se sabe nada: extender el nivel hacia el pasado inventaba "stock con
    // cero ventas" en SKUs nuevos (los días previos al lanzamiento) y
    // diluía su demanda a una fracción de la real.
    let primerDato: ISODate | null = null;
    for (const f of fechas) {
      if (snaps.has(f) || ops.has(f)) {
        primerDato = f;
        break;
      }
    }

    // --- Paso 1: nivel al CIERRE de cada día, caminando hacia atrás ---------
    const fin = new Map<ISODate, number>();
    const origen = new Map<ISODate, OrigenDia>();

    let corriendo = ancla;
    for (let i = fechas.length - 1; i >= 0; i--) {
      const f = fechas[i];
      if (primerDato !== null && f < primerDato) {
        // Prehistoria sin datos: no cuenta como "con stock" ni como agotado
        // con venta — el cálculo de fracciones la deja fuera.
        origen.set(f, "desconocido");
        corriendo = null;
        continue;
      }
      const snap = snaps.get(f)?.[0];
      const opsDia = (ops.get(f) ?? []).slice().sort((a, b) => a.fecha.localeCompare(b.fecha));

      let cierre: number | null;
      let org: OrigenDia;

      // Los movimientos de MELI mandan sobre nuestras fotos.
      //
      // Una foto se toma a la hora que corre la sincronización (digamos las
      // 7am) y guardarla como "el stock del día" la deja corta por medio día
      // de ventas. Un movimiento trae la hora exacta, así que el último del
      // día es el cierre real. La foto solo sirve cuando ese día no hubo
      // ningún movimiento: si nada se movió, la lectura de la mañana vale
      // igual que la de la noche.
      if (opsDia.length && opsDia[opsDia.length - 1].resultadoDisponible != null) {
        cierre = opsDia[opsDia.length - 1].resultadoDisponible!;
        org = "operaciones";
      } else if (snap && snap.origen !== "reconstruido") {
        cierre = snap.disponible;
        org = "snapshot";
      } else if (corriendo !== null) {
        cierre = corriendo;
        org = hayHistorial ? "operaciones" : "desconocido";
      } else {
        cierre = null;
        org = "desconocido";
      }

      if (cierre !== null) fin.set(f, Math.max(0, cierre));
      origen.set(f, org);

      // Retroceder un día: cierre(d-1) = cierre(d) - (movimiento neto del día d)
      const neto = opsDia.reduce((a, o) => {
        if (o.deltaDisponible != null) return a + o.deltaDisponible;
        return a;
      }, 0);

      if (cierre !== null) {
        if (opsDia.length && opsDia.some((o) => o.deltaDisponible != null)) {
          corriendo = Math.max(0, cierre - neto);
        } else if (opsDia.length) {
          // Hay operaciones pero sin deltas: usa las ventas como proxy del consumo.
          corriendo = Math.max(0, cierre + unidadesDe(f));
        } else {
          corriendo = cierre;
        }
      }
    }

    // --- Paso 2: convertir a inicio/fin por día ----------------------------
    const dias: DiaStock[] = fechas.map((f, i) => {
      const cierre = fin.get(f) ?? 0;
      const cierreAyer = i > 0 ? fin.get(fechas[i - 1]) : undefined;
      const u = unidadesDe(f);
      // Si no sabemos el cierre de ayer, deducimos el inicio de hoy del cierre + lo vendido.
      const inicio = cierreAyer ?? Math.max(cierre, cierre + u);
      return {
        fecha: f,
        inicio,
        fin: cierre,
        unidades: u,
        fraccionConStock: 0,
        origen: origen.get(f) ?? "desconocido",
      };
    });

    // --- Paso 3: sin historial, inferir agotamientos del patrón de ventas ---
    if (!hayHistorial && ancla === null) {
      inferirPorVentas(dias);
    }

    salida.set(sku, dias);
  }

  return salida;
}

/**
 * Plan B: cuando no hay ni snapshots ni operaciones, un día se marca como
 * agotado si no vendió nada Y el SKU sí venía vendiendo alrededor.
 * Es una aproximación: sirve para arrancar, no para decidir a ciegas.
 */
function inferirPorVentas(dias: DiaStock[]): void {
  const n = dias.length;
  const VENTANA = 10;
  for (let i = 0; i < n; i++) {
    if (dias[i].unidades > 0) {
      // Vendió: seguro tuvo stock (fin > 0 evita contarlo como "se agotó").
      dias[i].fin = Math.max(dias[i].fin, 1);
      dias[i].origen = "inferido";
      continue;
    }
    let vecinos = 0;
    let conVenta = 0;
    for (let j = Math.max(0, i - VENTANA); j <= Math.min(n - 1, i + VENTANA); j++) {
      if (j === i) continue;
      vecinos++;
      if (dias[j].unidades > 0) conVenta++;
    }
    // Vendía la mayor parte de los días de alrededor pero este día no:
    // probablemente agotado. Si no, se marca CON stock (inicio y fin > 0):
    // antes esta rama dejaba 0/0 y todo día sin venta contaba como agotado,
    // inflando la demanda de los SKUs sin historial hasta 3 veces.
    const probableAgotado = vecinos > 0 && conVenta / vecinos >= 0.6;
    dias[i].inicio = probableAgotado ? 0 : Math.max(dias[i].inicio, 1);
    dias[i].fin = probableAgotado ? 0 : Math.max(dias[i].fin, 1);
    dias[i].origen = "inferido";
  }
}

/**
 * Calcula qué fracción de cada día el SKU realmente tuvo stock.
 *
 * Un día que arrancó con 4 piezas y vende 20 al día no fue un día completo
 * de venta: fue como un quinto de día. Contarlo como día entero subestima
 * la demanda. Por eso la fracción se estima con la tasa de venta, y como la
 * tasa depende de la fracción, se itera un par de veces hasta que converge.
 *
 * Muta `dias` en el lugar y devuelve la tasa diaria corregida.
 */
export function calcularFraccionesConStock(dias: DiaStock[], iteraciones = 3): number {
  const unidades = dias.reduce((a, d) => a + d.unidades, 0);
  if (dias.length === 0) return 0;

  // Arranque: binario. Tuvo stock si arrancó con algo o si alcanzó a vender.
  for (const d of dias) {
    d.fraccionConStock = d.inicio > 0 || d.unidades > 0 ? 1 : 0;
  }

  let tasa = unidades / Math.max(1, dias.reduce((a, d) => a + d.fraccionConStock, 0));

  for (let it = 0; it < iteraciones; it++) {
    if (tasa <= 0) break;
    for (const d of dias) {
      if (d.inicio <= 0 && d.unidades <= 0) {
        d.fraccionConStock = 0;                       // agotado todo el día
      } else if (d.inicio > 0 && d.fin > 0) {
        d.fraccionConStock = 1;                       // nunca se quedó sin nada
      } else if (d.inicio > 0 && d.fin <= 0) {
        // Arrancó con stock y se agotó: duró lo que aguantó el inventario.
        d.fraccionConStock = clamp(d.inicio / tasa, 0.05, 1);
      } else {
        // Arrancó en cero pero vendió: llegó reposición a media jornada.
        d.fraccionConStock = clamp(d.unidades / tasa, 0.05, 1);
      }
    }
    const efectivos = dias.reduce((a, d) => a + d.fraccionConStock, 0);
    const nueva = unidades / Math.max(0.25, efectivos);
    if (Math.abs(nueva - tasa) < 1e-4) {
      tasa = nueva;
      break;
    }
    tasa = nueva;
  }

  return tasa;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
