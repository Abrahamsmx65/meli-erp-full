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
  /** neto real del reporte de pagos (liquidado en el periodo); null = sin dato */
  netoReal: number | null;
  gananciaReal: number | null;
}

export interface FilaCategoriaAmazon {
  categoria: string;
  unidades: number;
  importe: number;
  ganancia: number | null;
  netoReal: number | null;
  gananciaReal: number | null;
}

export interface MonitorAmazon {
  hoy: ResumenDia;
  ayer: ResumenDia;
  periodo: ResumenDia;
  porModelo: FilaModeloAmazon[];
  porCategoria: FilaCategoriaAmazon[];
  ganancia: number;
  coberturaCosto: number;
  /** Lo depositado por Amazon en el periodo (reporte de pagos); null = sin datos */
  netoReal: number | null;
  /** neto real − costo de las unidades liquidadas; null = sin datos o sin costos */
  gananciaReal: number | null;
  unidadesLiquidadas: number;
  /** gasto de publicidad del periodo según el reporte de pagos (negativo) */
  publicidad: number | null;
  /** otros cargos de cuenta del periodo: almacenaje, suscripción… (negativo) */
  otrosCargos: number | null;
  /** ganancia real − publicidad − otros cargos: lo que de verdad quedó */
  gananciaFinal: number | null;
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

  const [ventas, config, pagos] = await Promise.all([
    traerTodo<any>(
      db,
      "amazon_ventas_diarias",
      "seller_sku, fecha, unidades, ordenes, importe",
      (q) => q.eq("account_id", amazonAccountId).gte("fecha", prevDesde),
    ),
    // El costo y la categoría son los mismos productos físicos: viven con la
    // cuenta de MELI en Productos y costos.
    meliAccountId ? configPorProducto(db, meliAccountId) : Promise.resolve(new Map()),
    // El NETO real del reporte de pagos de Amazon (comisiones, envíos e
    // impuestos ya descontados), por día de liquidación. Si la tabla no
    // existe todavía, simplemente no hay dato real y se usa el estimado.
    traerTodo<any>(
      db,
      "amazon_pagos",
      "seller_sku, fecha, neto, unidades",
      (q) => q.eq("account_id", amazonAccountId).gte("fecha", r.desde).lte("fecha", r.hasta),
    ).catch(() => [] as any[]),
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

  // --- El dinero REAL: lo liquidado por Amazon en el periodo ----------------
  // Los pseudo-SKUs "(PUBLICIDAD)" y "(OTROS CARGOS)" son gastos de CUENTA
  // (no de un producto): se separan para restarlos de la ganancia final.
  const pagosPorModelo = new Map<string, { neto: number; unidades: number }>();
  let publicidad = 0;
  let otrosCargos = 0;
  for (const p of pagos) {
    const skuPago = String(p.seller_sku ?? "");
    if (skuPago === "(PUBLICIDAD)") {
      publicidad += Number(p.neto) || 0;
      continue;
    }
    if (skuPago === "(OTROS CARGOS)") {
      otrosCargos += Number(p.neto) || 0;
      continue;
    }
    const modelo = (desglosarSku(skuPago).modelo ?? skuPago).toUpperCase();
    const reg = pagosPorModelo.get(modelo) ?? { neto: 0, unidades: 0 };
    reg.neto += Number(p.neto) || 0;
    reg.unidades += p.unidades ?? 0;
    pagosPorModelo.set(modelo, reg);
  }

  const categorias = new Map<
    string,
    { unidades: number; importe: number; ganancia: number; conCosto: boolean; netoReal: number; gananciaReal: number; conPagos: boolean }
  >();
  let ganancia = 0;
  let unidadesConCosto = 0;
  let unidadesTotal = 0;
  let netoRealTotal = 0;
  let gananciaRealTotal = 0;
  let unidadesLiquidadas = 0;
  let hayPagos = pagos.length > 0;
  const gananciaPorModelo = new Map<string, number>();
  const gananciaRealPorModelo = new Map<string, number>();

  const todosLosModelos = new Set([...modelos.keys(), ...pagosPorModelo.keys()]);
  for (const modelo of todosLosModelos) {
    const m = modelos.get(modelo) ?? { unidades: 0, unidadesPrev: 0, importe: 0, unidadesHoy: 0 };
    unidadesTotal += m.unidades;
    const cfg = config.get(modelo);
    const categoria = cfg?.categoria ?? "Sin categoría";
    const cat =
      categorias.get(categoria) ??
      { unidades: 0, importe: 0, ganancia: 0, conCosto: false, netoReal: 0, gananciaReal: 0, conPagos: false };
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

    const pago = pagosPorModelo.get(modelo);
    if (pago) {
      netoRealTotal += pago.neto;
      unidadesLiquidadas += pago.unidades;
      cat.netoReal += pago.neto;
      cat.conPagos = true;
      if (cfg?.costo != null) {
        const gr = pago.neto - cfg.costo * pago.unidades;
        gananciaRealTotal += gr;
        gananciaRealPorModelo.set(modelo, gr);
        cat.gananciaReal += gr;
      }
    }
    categorias.set(categoria, cat);
  }

  const porModelo: FilaModeloAmazon[] = [...todosLosModelos]
    .map((modelo) => {
      const m = modelos.get(modelo) ?? { unidades: 0, unidadesPrev: 0, importe: 0, unidadesHoy: 0 };
      return {
        modelo,
        unidades: m.unidades,
        unidadesPrev: m.unidadesPrev,
        importe: m.importe,
        unidadesHoy: m.unidadesHoy,
        ganancia: gananciaPorModelo.has(modelo) ? (gananciaPorModelo.get(modelo) ?? 0) : null,
        netoReal: pagosPorModelo.get(modelo)?.neto ?? null,
        gananciaReal: gananciaRealPorModelo.has(modelo)
          ? (gananciaRealPorModelo.get(modelo) ?? 0)
          : null,
      };
    })
    .filter((f) => f.unidades + f.unidadesPrev > 0 || (f.netoReal ?? 0) !== 0)
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, 150);

  const porCategoria: FilaCategoriaAmazon[] = [...categorias.entries()]
    .map(([categoria, c]) => ({
      categoria,
      unidades: c.unidades,
      importe: c.importe,
      ganancia: c.conCosto ? c.ganancia : null,
      netoReal: c.conPagos ? c.netoReal : null,
      gananciaReal: c.conPagos && c.conCosto ? c.gananciaReal : null,
    }))
    .filter((c) => c.unidades > 0 || (c.netoReal ?? 0) !== 0)
    .sort((a, b) => b.unidades - a.unidades);

  return {
    hoy: resumen(hoy, hoy),
    ayer: resumen(ayer, ayer),
    periodo: resumen(r.desde, r.hasta),
    porModelo,
    porCategoria,
    ganancia,
    coberturaCosto: unidadesTotal > 0 ? unidadesConCosto / unidadesTotal : 0,
    netoReal: hayPagos ? netoRealTotal : null,
    gananciaReal: hayPagos && unidadesConCosto > 0 ? gananciaRealTotal : null,
    unidadesLiquidadas,
    publicidad: hayPagos ? publicidad : null,
    otrosCargos: hayPagos ? otrosCargos : null,
    gananciaFinal:
      hayPagos && unidadesConCosto > 0 ? gananciaRealTotal + publicidad + otrosCargos : null,
  };
}
