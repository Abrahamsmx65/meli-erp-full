/**
 * Monitor de ventas de Amazon: el mismo panel que el de Mercado Libre —
 * hoy, ayer, el periodo elegido, por modelo y por categoría con ganancia —
 * pero alimentado de `amazon_ventas_diarias`.
 *
 * La ganancia de Amazon es ESTIMADA: venta menos costo del producto. Las
 * comisiones y fletes de Amazon no llegan por los reportes que se
 * sincronizan hoy, así que no se descuentan; la nota de la pantalla lo dice.
 */
import { traerTodo, type DB } from "../datos/repos";
import { desglosarSku } from "./sync";
import { configPorProducto } from "./productos";
import { diasDeRango, fechaMx, normalizarRango, type RangoFechas, type ResumenDia } from "./ventas-monitor";

export interface FilaModeloAmazon {
  modelo: string;
  unidades: number;
  unidadesPrev: number;
  importe: number;
  unidadesHoy: number;
  ganancia: number | null;
}

export interface FilaCategoriaAmazon {
  categoria: string;
  unidades: number;
  importe: number;
  ganancia: number | null;
}

export interface MonitorAmazon {
  hoy: ResumenDia;
  ayer: ResumenDia;
  periodo: ResumenDia;
  porModelo: FilaModeloAmazon[];
  porCategoria: FilaCategoriaAmazon[];
  ganancia: number;
  coberturaCosto: number;
}

export async function cargarMonitorAmazon(
  db: DB,
  amazonAccountId: string,
  meliAccountId: string | null,
  rango?: RangoFechas,
): Promise<MonitorAmazon> {
  const hoy = fechaMx(0);
  const ayer = fechaMx(1);
  const r = rango ?? normalizarRango();
  const dias = diasDeRango(r);
  const prevDesde = new Date(Date.parse(r.desde) - dias * 86_400_000).toISOString().slice(0, 10);
  const prevHasta = new Date(Date.parse(r.desde) - 86_400_000).toISOString().slice(0, 10);

  const [ventas, config] = await Promise.all([
    traerTodo<any>(
      db,
      "amazon_ventas_diarias",
      "seller_sku, fecha, unidades, ordenes, importe",
      (q) => q.eq("account_id", amazonAccountId).gte("fecha", prevDesde),
    ),
    // El costo y la categoría son los mismos productos físicos: viven con la
    // cuenta de MELI en Productos y costos.
    meliAccountId ? configPorProducto(db, meliAccountId) : Promise.resolve(new Map()),
  ]);

  const resumen = (desde: string, hasta: string): ResumenDia => {
    let unidades = 0;
    let importe = 0;
    let ordenes = 0;
    for (const v of ventas) {
      if (v.fecha < desde || v.fecha > hasta) continue;
      unidades += v.unidades ?? 0;
      importe += v.importe ?? 0;
      ordenes += v.ordenes ?? 0;
    }
    return { unidades, importe, ordenes };
  };

  const modelos = new Map<
    string,
    { unidades: number; unidadesPrev: number; importe: number; unidadesHoy: number }
  >();

  for (const v of ventas) {
    const modelo = (desglosarSku(String(v.seller_sku ?? "")).modelo ?? String(v.seller_sku ?? "")).toUpperCase();
    const m = modelos.get(modelo) ?? { unidades: 0, unidadesPrev: 0, importe: 0, unidadesHoy: 0 };
    if (v.fecha >= r.desde && v.fecha <= r.hasta) {
      m.unidades += v.unidades ?? 0;
      m.importe += v.importe ?? 0;
      if (v.fecha === hoy) m.unidadesHoy += v.unidades ?? 0;
    } else if (v.fecha >= prevDesde && v.fecha <= prevHasta) {
      m.unidadesPrev += v.unidades ?? 0;
    }
    modelos.set(modelo, m);
  }

  const categorias = new Map<
    string,
    { unidades: number; importe: number; ganancia: number; conCosto: boolean }
  >();
  let ganancia = 0;
  let unidadesConCosto = 0;
  let unidadesTotal = 0;
  const gananciaPorModelo = new Map<string, number>();

  for (const [modelo, m] of modelos) {
    unidadesTotal += m.unidades;
    const cfg = config.get(modelo);
    const categoria = cfg?.categoria ?? "Sin categoría";
    const cat = categorias.get(categoria) ?? { unidades: 0, importe: 0, ganancia: 0, conCosto: false };
    cat.unidades += m.unidades;
    cat.importe += m.importe;

    if (cfg?.costo != null && m.unidades > 0) {
      const g = m.importe - cfg.costo * m.unidades;
      ganancia += g;
      unidadesConCosto += m.unidades;
      gananciaPorModelo.set(modelo, g);
      cat.ganancia += g;
      cat.conCosto = true;
    }
    categorias.set(categoria, cat);
  }

  const porModelo: FilaModeloAmazon[] = [...modelos.entries()]
    .map(([modelo, m]) => ({
      modelo,
      unidades: m.unidades,
      unidadesPrev: m.unidadesPrev,
      importe: m.importe,
      unidadesHoy: m.unidadesHoy,
      ganancia: gananciaPorModelo.has(modelo) ? (gananciaPorModelo.get(modelo) ?? 0) : null,
    }))
    .filter((f) => f.unidades + f.unidadesPrev > 0)
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, 150);

  const porCategoria: FilaCategoriaAmazon[] = [...categorias.entries()]
    .map(([categoria, c]) => ({
      categoria,
      unidades: c.unidades,
      importe: c.importe,
      ganancia: c.conCosto ? c.ganancia : null,
    }))
    .filter((c) => c.unidades > 0)
    .sort((a, b) => b.unidades - a.unidades);

  return {
    hoy: resumen(hoy, hoy),
    ayer: resumen(ayer, ayer),
    periodo: resumen(r.desde, r.hasta),
    porModelo,
    porCategoria,
    ganancia,
    coberturaCosto: unidadesTotal > 0 ? unidadesConCosto / unidadesTotal : 0,
  };
}
