/**
 * Monitor de ventas de Amazon: el mismo panel que el de Mercado Libre —
 * hoy, ayer, el periodo elegido, por modelo y por categoría con ganancia —
 * pero alimentado de `amazon_ventas_diarias`.
 *
 * La ganancia de Amazon es ESTIMADA: venta menos costo del producto. Las
 * comisiones y fletes de Amazon no llegan por los reportes que se
 * sincronizan hoy, así que no se descuentan; la nota de la pantalla lo dice.
 */
import { traerRpcTodo, traerTodo, type DB } from "../datos/repos";
import { modeloUnificado } from "./costos-unificados";
import { conCacheApp } from "./cache-app";
import { configPorProducto } from "./productos";
import { diasDeRango, fechaMx, normalizarRango, type RangoFechas, type ResumenDia } from "./ventas-monitor";

/** De dónde salió la ganancia unificada de un renglón. */
export type FuenteGanancia = "economia" | "liquidado" | "estimada";

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
  /**
   * LA ganancia del modelo, una sola definición (la misma del corte
   * general): neto del SKU Economics (ventas − tarifas − publicidad, por
   * fecha de venta) − costo. Sin economía cae a lo liquidado − costo, y sin
   * nada a venta − costo; `gananciaFuente` dice cuál fue. null = sin costo
   * capturado.
   */
  gananciaNeta: number | null;
  gananciaFuente: FuenteGanancia | null;
  /** gasto de publicidad del periodo por modelo (SKU Economics); null = sin dato */
  publicidad: number | null;
  /** publicidad ÷ unidades netas del MISMO reporte de economía */
  publicidadPorUnidad: number | null;
  /** publicidad como % de la venta del reporte de economía (ACOS) */
  acosPct: number | null;
  /**
   * La economía del modelo en el periodo (SKU Economics, por FECHA DE VENTA):
   * lo que Amazon va a pagar por lo vendido = ventas − tarifas (el `neto` de
   * Amazon ya trae la publicidad restada; aquí se guarda aparte). null = sin dato.
   */
  economia: { unidades: number; ventas: number; tarifas: number; publicidad: number; neto: number } | null;
}

export interface FilaCategoriaAmazon {
  categoria: string;
  unidades: number;
  importe: number;
  ganancia: number | null;
  netoReal: number | null;
  gananciaReal: number | null;
  /** suma de la ganancia unificada de sus modelos (ver FilaModeloAmazon) */
  gananciaNeta: number | null;
  /** unidades de la categoría cuyo modelo NO tiene ganancia calculable (sin costo) */
  unidadesSinGanancia: number;
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
  /** esos cargos por concepto, tal como los describe Amazon (negativo = cargo) */
  otrosCargosDetalle: { concepto: string; monto: number }[];
  /** reservas retenidas/soltadas por Amazon en el periodo: NO son gasto */
  reservas: number;
  /** ganancia real − publicidad − otros cargos: lo que de verdad quedó */
  gananciaFinal: number | null;
  /**
   * Hasta qué fecha hay liquidaciones cargadas (sin importar el rango).
   * Amazon liquida cada ~2 semanas: si el rango elegido es más reciente que
   * esto, el desglose del dinero real sale vacío y hay que decirlo.
   */
  pagosHasta: string | null;
  /**
   * La economía POR PRODUCTO del periodo (SKU Economics vía Data Kiosk):
   * ventas, tarifas, publicidad y neto por día y por SKU — la fuente que el
   * usuario pidió para la ganancia. null = aún no hay datos en el rango.
   */
  economia: {
    unidades: number;
    ventas: number;
    tarifas: number;
    publicidad: number;
    neto: number;
    /** neto − costo de producto (donde hay costo capturado) */
    gananciaFinal: number | null;
    costoProducto: number;
    coberturaCosto: number;
    hasta: string | null;
    cobertura: {
      importe: number;
      unidades: number;
      dias: number;
      diasVenta: number;
      diasCubiertos: number;
      completa: boolean;
    };
  } | null;
  /** publicidad del periodo por modelo, para la columna de la tabla */
  publicidadPorModelo: Map<string, number>;
}

/**
 * Un minuto de caché por instancia, igual que el monitor de MELI: los datos
 * de Amazon solo cambian cuando el cron sincroniza (cada 15-60 minutos).
 */
const cacheMonitorAmz = new Map<string, { en: number; datos: MonitorAmazon }>();
const VIDA_CACHE_MONITOR_MS = 60_000;

/**
 * El monitor masticado desde `app_cache`: los datos solo cambian cuando el
 * cron de Amazon sincroniza (cada 10-60 min) y bajar ~30 mil renglones de
 * venta por render era de lo más caro que quedaba. Un rango que ya CERRÓ
 * (termina antes de hoy, p. ej. un mes pasado del corte general) casi no
 * cambia —solo alguna liquidación tardía— y su renglón vive 6 horas; el
 * cálculo de agosto medía 42 s y con 5 minutos de vida se tiraba a la
 * basura en cada visita. Un rango que incluye hoy vive 5 minutos.
 */
export async function obtenerMonitorAmazon(
  db: DB,
  amazonAccountId: string,
  meliAccountId: string | null,
  rango?: RangoFechas,
): Promise<MonitorAmazon> {
  const r = rango ?? normalizarRango();
  const cerrado = r.hasta < fechaMx(0);
  return conCacheApp(db, amazonAccountId, `monitor:v2:${meliAccountId ?? ""}:${r.desde}:${r.hasta}`, cerrado ? 6 * 3_600_000 : 5 * 60_000, () =>
    cargarMonitorAmazon(db, amazonAccountId, meliAccountId, r),
  );
}

export async function cargarMonitorAmazon(
  db: DB,
  amazonAccountId: string,
  meliAccountId: string | null,
  rango?: RangoFechas,
): Promise<MonitorAmazon> {
  const esFuenteOpcionalAusente = (err: unknown): boolean =>
    err instanceof Error &&
    /does not exist|42P01|42883|PGRST202|schema cache/i.test(err.message);
  const hoy = fechaMx(0);
  const ayer = fechaMx(1);
  const r = rango ?? normalizarRango();

  const claveCache = `${amazonAccountId}|${meliAccountId ?? ""}|${r.desde}|${r.hasta}|${hoy}`;
  const guardado = cacheMonitorAmz.get(claveCache);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_MONITOR_MS) return guardado.datos;
  const dias = diasDeRango(r);
  const prevDesde = new Date(Date.parse(r.desde) - dias * 86_400_000).toISOString().slice(0, 10);
  const prevHasta = new Date(Date.parse(r.desde) - 86_400_000).toISOString().slice(0, 10);

  const [ventas, ventasRecientes, config, pagos, ultimaLiquidacion, economiaFilas, coberturaFilas] = await Promise.all([
    traerTodo<any>(
      db,
      "amazon_ventas_diarias",
      "seller_sku, fecha, unidades, ordenes, importe",
      // Acotado por los DOS lados: sin el tope superior, pedir un mes viejo
      // bajaba también todos los meses posteriores (42 s para agosto).
      (q) => q.eq("account_id", amazonAccountId).gte("fecha", prevDesde).lte("fecha", r.hasta),
    ),
    // Las fichas de Hoy/Ayer se enseñan aunque el rango sea un mes viejo:
    // dos días extra, solo cuando el rango no los incluye.
    r.hasta >= ayer
      ? Promise.resolve([] as any[])
      : traerTodo<any>(
          db,
          "amazon_ventas_diarias",
          "seller_sku, fecha, unidades, ordenes, importe",
          (q) => q.eq("account_id", amazonAccountId).gte("fecha", ayer).lte("fecha", hoy),
        ),
    // El costo y la categoría son los mismos productos físicos: viven con la
    // cuenta de MELI en Productos y costos, calzado y fundas juntos (los SKUs
    // de funda que se venden en Amazon, 437-RmPad-2-navy, amarran por diseño).
    meliAccountId ? configPorProducto(db, meliAccountId) : Promise.resolve(new Map()),
    // El NETO real del reporte de pagos de Amazon (comisiones, envíos e
    // impuestos ya descontados), por día de liquidación. Si la tabla no
    // existe todavía, simplemente no hay dato real y se usa el estimado.
    traerTodo<any>(
      db,
      "amazon_pagos",
      "seller_sku, fecha, neto, unidades",
      (q) => q.eq("account_id", amazonAccountId).gte("fecha", r.desde).lte("fecha", r.hasta),
    ).catch((err) => {
      if (esFuenteOpcionalAusente(err)) return [] as any[];
      throw err;
    }),
    Promise.resolve(
      db
        .from("amazon_pagos")
        .select("fecha")
        .eq("account_id", amazonAccountId)
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle(),
    )
      .then((x: any) => (x?.data?.fecha as string | undefined) ?? null)
      .catch((err) => {
        if (esFuenteOpcionalAusente(err)) return null;
        throw err;
      }),
    // La economía por producto del Data Kiosk, YA SUMADA por SKU en la base
    // (`amazon_economia_por_sku`): por día son ~154 mil renglones en 30 días
    // y la lectura paginada no alcanzaba a terminar, así que la economía se
    // quedaba vacía sin decirlo. Sumada son ~6 mil en un viaje.
    traerRpcTodo<any>(db, "amazon_economia_por_sku", {
      p_account: amazonAccountId,
      p_desde: r.desde,
      p_hasta: r.hasta,
    })
      .then((x) => x.filas)
      .catch((err) => {
        if (esFuenteOpcionalAusente(err)) return [] as any[];
        throw err;
      }),
    traerRpcTodo<any>(db, "amazon_economia_cobertura", {
      p_account: amazonAccountId,
      p_desde: r.desde,
      p_hasta: r.hasta,
    })
      .then((x) => x.filas)
      .catch((err) => {
        if (esFuenteOpcionalAusente(err)) return [] as any[];
        throw err;
      }),
  ]);

  const resumen = (desde: string, hasta: string): ResumenDia => {
    let unidades = 0;
    let importe = 0;
    let ordenes = 0;
    for (const v of [...ventas, ...ventasRecientes]) {
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
    const modelo = modeloUnificado(String(v.seller_sku ?? ""));
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
  let reservas = 0;
  const otrosPorConcepto = new Map<string, number>();
  for (const p of pagos) {
    const skuPago = String(p.seller_sku ?? "");
    if (skuPago.startsWith("(PUBLICIDAD")) {
      publicidad += Number(p.neto) || 0;
      continue;
    }
    if (skuPago.startsWith("(RESERVA")) {
      reservas += Number(p.neto) || 0;
      continue;
    }
    if (skuPago.startsWith("(OTROS CARGOS")) {
      otrosCargos += Number(p.neto) || 0;
      const concepto = skuPago.replace(/^\(OTROS CARGOS\)\s*/, "") || "sin descripción";
      otrosPorConcepto.set(concepto, (otrosPorConcepto.get(concepto) ?? 0) + (Number(p.neto) || 0));
      continue;
    }
    const modelo = modeloUnificado(skuPago);
    const reg = pagosPorModelo.get(modelo) ?? { neto: 0, unidades: 0 };
    reg.neto += Number(p.neto) || 0;
    reg.unidades += p.unidades ?? 0;
    pagosPorModelo.set(modelo, reg);
  }

  // --- Economía por producto (SKU Economics) del periodo -------------------
  const econPorModelo = new Map<
    string,
    { unidades: number; ventas: number; tarifas: number; publicidad: number; neto: number }
  >();
  let econHasta: string | null = null;
  for (const e of economiaFilas) {
    const modelo = modeloUnificado(String(e.seller_sku ?? ""));
    const reg =
      econPorModelo.get(modelo) ?? { unidades: 0, ventas: 0, tarifas: 0, publicidad: 0, neto: 0 };
    reg.unidades += Number(e.unidades) || 0;
    reg.ventas += Number(e.ventas) || 0;
    reg.tarifas += Number(e.tarifas) || 0;
    reg.publicidad += Number(e.publicidad) || 0;
    reg.neto += Number(e.neto) || 0;
    econPorModelo.set(modelo, reg);
    const hastaSku = e.ultima_fecha as string | null;
    if (hastaSku && (!econHasta || hastaSku > econHasta)) econHasta = hastaSku;
  }

  const categorias = new Map<
    string,
    { unidades: number; importe: number; ganancia: number; conCosto: boolean; netoReal: number; gananciaReal: number; conPagos: boolean; gananciaNeta: number; conGanancia: boolean; unidadesSinGanancia: number }
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
  const gananciaNetaPorModelo = new Map<string, { valor: number; fuente: FuenteGanancia }>();

  const todosLosModelos = new Set([...modelos.keys(), ...pagosPorModelo.keys()]);
  for (const modelo of todosLosModelos) {
    const m = modelos.get(modelo) ?? { unidades: 0, unidadesPrev: 0, importe: 0, unidadesHoy: 0 };
    unidadesTotal += m.unidades;
    const cfg = config.get(modelo);
    const categoria = cfg?.categoria ?? "Sin categoría";
    const cat =
      categorias.get(categoria) ??
      { unidades: 0, importe: 0, ganancia: 0, conCosto: false, netoReal: 0, gananciaReal: 0, conPagos: false, gananciaNeta: 0, conGanancia: false, unidadesSinGanancia: 0 };
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

    // LA ganancia unificada del modelo (misma definición que el corte
    // general): el neto del SKU Economics ya trae tarifas Y publicidad
    // restadas, así que neto − costo es la cuenta completa. Sin economía,
    // lo liquidado − costo; sin nada, venta − costo (estimada). Sin costo
    // capturado no hay ganancia calculable: null, nunca cero.
    const eco = econPorModelo.get(modelo);
    if (cfg?.costo != null) {
      let unificada: { valor: number; fuente: FuenteGanancia } | null = null;
      if (eco && (eco.unidades > 0 || eco.ventas !== 0)) {
        unificada = { valor: eco.neto - cfg.costo * eco.unidades, fuente: "economia" };
      } else if (pago) {
        unificada = { valor: pago.neto - cfg.costo * pago.unidades, fuente: "liquidado" };
      } else if (m.unidades > 0) {
        unificada = { valor: m.importe - cfg.costo * m.unidades, fuente: "estimada" };
      }
      if (unificada) {
        gananciaNetaPorModelo.set(modelo, unificada);
        cat.gananciaNeta += unificada.valor;
        cat.conGanancia = true;
      }
    } else {
      cat.unidadesSinGanancia += m.unidades;
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
        gananciaNeta: gananciaNetaPorModelo.get(modelo)?.valor ?? null,
        gananciaFuente: gananciaNetaPorModelo.get(modelo)?.fuente ?? null,
        // Publicidad del SKU Economics, agregada por modelo. El por-unidad y
        // el ACOS usan unidades y ventas del MISMO reporte: mismo
        // denominador, mismos días.
        publicidad: econPorModelo.has(modelo)
          ? (econPorModelo.get(modelo)?.publicidad ?? 0)
          : null,
        publicidadPorUnidad: (() => {
          const e = econPorModelo.get(modelo);
          if (!e || e.unidades <= 0) return null;
          return e.publicidad / e.unidades;
        })(),
        acosPct: (() => {
          const e = econPorModelo.get(modelo);
          if (!e || e.ventas <= 0) return null;
          return (100 * e.publicidad) / e.ventas;
        })(),
        economia: econPorModelo.has(modelo) ? { ...econPorModelo.get(modelo)! } : null,
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
      gananciaNeta: c.conGanancia ? c.gananciaNeta : null,
      unidadesSinGanancia: c.unidadesSinGanancia,
    }))
    .filter((c) => c.unidades > 0 || (c.netoReal ?? 0) !== 0)
    .sort((a, b) => b.unidades - a.unidades);

  const monitor: MonitorAmazon = {
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
    otrosCargosDetalle: [...otrosPorConcepto.entries()]
      .map(([concepto, monto]) => ({ concepto, monto: Math.round(monto * 100) / 100 }))
      .sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto)),
    reservas: Math.round(reservas * 100) / 100,
    gananciaFinal:
      hayPagos && unidadesConCosto > 0 ? gananciaRealTotal + publicidad + otrosCargos : null,
    pagosHasta: ultimaLiquidacion,
    economia: (() => {
      if (!economiaFilas.length) return null;
      let unidadesE = 0;
      let ventasE = 0;
      let tarifasE = 0;
      let publicidadE = 0;
      let netoE = 0;
      let costoE = 0;
      let unidadesConCostoE = 0;
      for (const [modelo, e] of econPorModelo) {
        unidadesE += e.unidades;
        ventasE += e.ventas;
        tarifasE += e.tarifas;
        publicidadE += e.publicidad;
        netoE += e.neto;
        const cfg = config.get(modelo);
        if (cfg?.costo != null) {
          costoE += cfg.costo * e.unidades;
          unidadesConCostoE += e.unidades;
        }
      }
      return {
        unidades: unidadesE,
        ventas: ventasE,
        tarifas: tarifasE,
        publicidad: publicidadE,
        neto: netoE,
        costoProducto: costoE,
        coberturaCosto: unidadesE > 0 ? unidadesConCostoE / unidadesE : 0,
        gananciaFinal: unidadesConCostoE > 0 ? netoE - costoE : null,
        hasta: econHasta,
        cobertura: (() => {
          const c = coberturaFilas[0];
          const importe = Math.min(1, Math.max(0, Number(c?.cobertura_importe) || 0));
          const unidades = Math.min(1, Math.max(0, Number(c?.cobertura_unidades) || 0));
          const diasVenta = Number(c?.dias_venta) || 0;
          const diasCubiertos = Number(c?.dias_cubiertos) || 0;
          const dias = diasVenta > 0 ? Math.min(1, diasCubiertos / diasVenta) : 1;
          return {
            importe,
            unidades,
            dias,
            diasVenta,
            diasCubiertos,
            completa: importe >= 1 && unidades >= 1 && dias >= 1,
          };
        })(),
      };
    })(),
    publicidadPorModelo: new Map(
      [...econPorModelo.entries()].map(([m, e]) => [m, e.publicidad]),
    ),
  };
  cacheMonitorAmz.set(claveCache, { en: Date.now(), datos: monitor });
  return monitor;
}
