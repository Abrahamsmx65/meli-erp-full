/**
 * Monitor de ventas con costos y ganancia.
 *
 * Por SKU y por diseño, en el periodo elegido: unidades, importe de lista,
 * comisión de MELI, neto real depositado (cuando ya se sabe), costo y
 * ganancia. La ganancia se calcula sobre el NETO cuando existe; si un día
 * todavía no tiene neto (los cargos llegan diferidos), se estima con
 * importe − comisión y se marca como estimado.
 */
import type { DB } from "../datos/repos";
import { mapaCostosUnificado, soloCostos } from "../servicios/costos-unificados";
import { costoDeSku } from "./costos";
import { hoyMx, restarDias, todo } from "./db";
import { desglosar } from "./sku";

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
  /** Unidades cuyo neto todavía no se sabe (se estimó). */
  unidadesEstimadas: number;
  /** Unidades sin costo cargado (la ganancia no las cuenta como costo 0). */
  unidadesSinCosto: number;
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
}

function vacio(): Totales {
  return { unidades: 0, ordenes: 0, importe: 0, comision: 0, neto: 0, costo: 0, ganancia: 0, unidadesEstimadas: 0, unidadesSinCosto: 0 };
}

interface FilaResumen {
  sku: string;
  unidades: number;
  ordenes: number;
  importe: number;
  comision: number;
  neto: number;
  unidades_sin_neto: number;
}

async function rpcTodo<T>(db: DB, fn: string, args: Record<string, unknown>): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.rpc(fn, args).range(desde, desde + 999);
    if (error) throw new Error(`${fn}: ${error.message}`);
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < 1000) break;
  }
  return out;
}

function sumarResumen(t: Totales, f: FilaResumen, costoUnit: number | null): void {
  t.unidades += Number(f.unidades);
  t.ordenes += Number(f.ordenes);
  t.importe += Number(f.importe);
  t.comision += Number(f.comision);
  t.neto += Number(f.neto);
  t.unidadesEstimadas += Number(f.unidades_sin_neto ?? 0);
  if (costoUnit == null) t.unidadesSinCosto += Number(f.unidades);
  else t.costo += costoUnit * Number(f.unidades);
  t.ganancia = t.neto - t.costo;
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
    rpcTodo<FilaResumen>(db, "yz_ventas_resumen", { p_account: accountId, p_desde: desde, p_hasta: hasta });

  const [rPeriodo, rAnterior, rHoy, rAyer, porDiaFilas, skus, mapaUnificado] = await Promise.all([
    resumen(rango.desde, rango.hasta),
    resumen(anterior.desde, anterior.hasta),
    resumen(hoy, hoy),
    resumen(ayer, ayer),
    rpcTodo<{ fecha: string; unidades: number; importe: number; neto: number }>(db, "yz_ventas_por_dia", { p_account: accountId, p_desde: rango.desde, p_hasta: rango.hasta }),
    todo<{ sku: string; titulo: string | null }>(db, "yz_skus", "sku, titulo", (q) => q.eq("account_id", accountId)),
    // Los costos viven en Productos y costos (calzado y fundas juntos);
    // yz_costos queda de respaldo.
    mapaCostosUnificado(db, { yzAccountId: accountId }),
  ]);

  const costos = soloCostos(mapaUnificado);
  const titulos = new Map(skus.map((s) => [s.sku, s.titulo]));
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
  m.porDia = porDiaFilas.map((d) => ({ fecha: d.fecha, unidades: Number(d.unidades), importe: Number(d.importe), neto: Number(d.neto) }));
  m.skusSinCosto = sinCosto.size;
  return m;
}
