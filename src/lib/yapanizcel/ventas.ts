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

interface Venta {
  sku: string;
  fecha: string;
  unidades: number;
  ordenes: number;
  importe: number;
  comision: number;
  neto: number | null;
}

function acumular(t: Totales, v: Venta, costoUnit: number | null): void {
  t.unidades += v.unidades;
  t.ordenes += v.ordenes;
  t.importe += v.importe;
  t.comision += v.comision;
  const netoReal = v.neto != null;
  const neto = netoReal ? Number(v.neto) : v.importe - v.comision;
  t.neto += neto;
  if (!netoReal) t.unidadesEstimadas += v.unidades;
  if (costoUnit == null) {
    t.unidadesSinCosto += v.unidades;
  } else {
    t.costo += costoUnit * v.unidades;
  }
  t.ganancia = t.neto - t.costo;
}

export async function cargarMonitor(db: DB, accountId: string, rango: Rango): Promise<Monitor> {
  const dias = Math.round((Date.parse(rango.hasta) - Date.parse(rango.desde)) / 86_400_000) + 1;
  const anterior: Rango = { hasta: restarDias(rango.desde, 1), desde: restarDias(rango.desde, dias) };
  const hoy = hoyMx();
  const ayer = restarDias(hoy, 1);
  const desdeTodo = [anterior.desde, rango.desde, ayer].sort()[0];
  const hastaTodo = [rango.hasta, hoy].sort().at(-1)!;

  const [ventas, skus, costosFilas] = await Promise.all([
    todo<Venta>(db, "yz_ventas_diarias", "sku, fecha, unidades, ordenes, importe, comision, neto", (q) =>
      q.eq("account_id", accountId).gte("fecha", desdeTodo).lte("fecha", hastaTodo),
    ),
    todo<{ sku: string; titulo: string | null; diseno: string | null }>(db, "yz_skus", "sku, titulo, diseno", (q) => q.eq("account_id", accountId)),
    todo<{ modelo: string; costo: number }>(db, "yz_costos", "modelo, costo", (q) => q.eq("account_id", accountId)),
  ]);

  const costos = new Map(costosFilas.map((c) => [c.modelo, Number(c.costo)]));
  const titulos = new Map(skus.map((s) => [s.sku, s.titulo]));
  const disenoDe = new Map(skus.map((s) => [s.sku, desglosar(s.sku).diseno]));

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

  const porSku = new Map<string, FilaVentas>();
  const porDiseno = new Map<string, FilaVentas>();
  const porDia = new Map<string, DiaVentas>();
  const cacheCosto = new Map<string, number | null>();
  const sinCosto = new Set<string>();

  for (const v of ventas) {
    let costoUnit = cacheCosto.get(v.sku);
    if (costoUnit === undefined) {
      costoUnit = costoDeSku(v.sku, costos);
      cacheCosto.set(v.sku, costoUnit);
    }
    if (costoUnit == null) sinCosto.add(v.sku);

    if (v.fecha === hoy) acumular(m.hoy, v, costoUnit);
    if (v.fecha === ayer) acumular(m.ayer, v, costoUnit);
    if (v.fecha >= anterior.desde && v.fecha <= anterior.hasta) acumular(m.anterior, v, costoUnit);

    if (v.fecha < rango.desde || v.fecha > rango.hasta) continue;
    acumular(m.periodo, v, costoUnit);

    const diseno = disenoDe.get(v.sku) ?? desglosar(v.sku).diseno;
    const fs = porSku.get(v.sku) ?? { ...vacio(), clave: v.sku, titulo: titulos.get(v.sku), diseno, precioPromedio: 0, margen: null, costoUnitario: costoUnit };
    acumular(fs, v, costoUnit);
    porSku.set(v.sku, fs);

    const fd = porDiseno.get(diseno) ?? { ...vacio(), clave: diseno, diseno, precioPromedio: 0, margen: null, costoUnitario: null };
    acumular(fd, v, costoUnit);
    porDiseno.set(diseno, fd);

    const d = porDia.get(v.fecha) ?? { fecha: v.fecha, unidades: 0, importe: 0, neto: 0 };
    d.unidades += v.unidades;
    d.importe += v.importe;
    d.neto += v.neto != null ? Number(v.neto) : v.importe - v.comision;
    porDia.set(v.fecha, d);
  }

  const cerrar = (f: FilaVentas): FilaVentas => ({
    ...f,
    precioPromedio: f.unidades ? f.importe / f.unidades : 0,
    margen: f.neto > 0 && f.unidadesSinCosto === 0 ? f.ganancia / f.neto : null,
  });

  m.porSku = [...porSku.values()].map(cerrar).sort((a, b) => b.unidades - a.unidades);
  m.porDiseno = [...porDiseno.values()].map(cerrar).sort((a, b) => b.unidades - a.unidades);
  m.porDia = [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  m.skusSinCosto = sinCosto.size;
  return m;
}
