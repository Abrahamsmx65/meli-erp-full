/**
 * Conciliación de MELI: el reporte de VENTAS de Mercado Libre (Ventas →
 * Descargar reporte, Excel "Ventas MX") contra lo que el ERP guardó por
 * orden desde el pago real de Mercado Pago (`ordenes_neto`).
 *
 * El reporte trae una fila por VENTA con dinero (una orden suelta o un
 * PAQUETE de varias órdenes, con el id del paquete en «# de venta») y
 * debajo las filas de sus productos (sin dinero). Sus columnas:
 *   Ingresos por productos      = lo que pagó el comprador por los productos
 *   Cargo por venta e impuestos = comisión + ISR + IVA retenidos (negativo)
 *   Ingresos por envío          = lo que el comprador pagó de envío
 *   Costos de envío             = lo que cobra MELI por el envío (negativo)
 *   Anulaciones y reembolsos    = devoluciones (negativo)
 *   Total                       = lo que MELI te deja: el NETO
 * Verificado con el paquete 2000014806795251 (239.38 − 57.56 − 76 = 105.82,
 * igual a la suma de los netos de sus dos órdenes en el ERP) y con la
 * reventa 2000018220538232 (ingresos = total = 213.14, sin cargos).
 *
 * Módulo PURO: el navegador lee el Excel con ExcelJS y manda solo las
 * ventas compactas en gzip (el archivo del mes pesa 15 MB). El cruce con
 * la base vive en `conciliar-ventas-db.ts`.
 */

export interface VentaReporte {
  /** «# de venta»: id de la orden o del paquete */
  venta: string;
  /** YYYY-MM-DD (hora de México, como la trae el reporte) */
  fecha: string | null;
  estado: string;
  /** "Venta directa" | "Reventa" */
  modelo: string;
  ingresos: number;
  cargo: number;
  ingresosEnvio: number;
  costoEnvio: number;
  envioCambio: number;
  diferenciasMedidas: number;
  descuentos: number;
  anulaciones: number;
  total: number;
  /** las órdenes/productos listados debajo (ids de orden y SKUs) */
  ordenes: string[];
  skus: string[];
  unidades: number;
}

const MESES: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

/** "31 de agosto de 2026 23:59 hs." → "2026-08-31" */
export function fechaDeVentaMeli(texto: string): string | null {
  const m = texto.trim().match(/^(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

const numero = (x: string | undefined): number | null => {
  const t = (x ?? "").replace(/[,$\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Lee las filas (ya en texto) del Excel "Ventas MX" y arma las ventas. */
export function leerReporteVentas(filas: string[][]): VentaReporte[] {
  const iEnc = filas.findIndex((f) => (f[0] ?? "").trim().toLowerCase() === "# de venta");
  if (iEnc < 0) throw new Error('No encontré el encabezado «# de venta» del reporte de Ventas de Mercado Libre.');
  const enc = filas[iEnc].map((h) => (h ?? "").trim().toLowerCase());
  const col = (...prefijos: string[]): number => {
    for (const p of prefijos) {
      const i = enc.findIndex((h) => h.startsWith(p));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    venta: col("# de venta"),
    fecha: col("fecha de venta"),
    estado: col("estado"),
    modelo: col("modelo de venta"),
    unidades: col("unidades"),
    ingresos: col("ingresos por productos"),
    cargo: col("cargo por venta e impuestos"),
    ingresosEnvio: col("ingresos por envío"),
    costoEnvio: col("costos de envío"),
    envioCambio: col("costo de envío por cambio"),
    diferenciasMedidas: col("cargo por diferencias en medidas"),
    descuentos: col("descuentos y bonificaciones"),
    anulaciones: col("anulaciones y reembolsos"),
    total: col("total"),
    sku: col("sku"),
  };
  if (c.total < 0 || c.ingresos < 0) throw new Error('Al reporte le faltan las columnas «Ingresos por productos» o «Total».');

  const ventas: VentaReporte[] = [];
  let actual: VentaReporte | null = null;
  for (const f of filas.slice(iEnc + 1)) {
    const id = (f[c.venta] ?? "").trim();
    if (!id) continue;
    const total = numero(f[c.total]);
    if (total != null) {
      actual = {
        venta: id,
        fecha: c.fecha >= 0 ? fechaDeVentaMeli(f[c.fecha] ?? "") : null,
        estado: (f[c.estado] ?? "").trim(),
        modelo: (f[c.modelo] ?? "").trim(),
        ingresos: numero(f[c.ingresos]) ?? 0,
        cargo: numero(f[c.cargo]) ?? 0,
        ingresosEnvio: numero(f[c.ingresosEnvio]) ?? 0,
        costoEnvio: numero(f[c.costoEnvio]) ?? 0,
        envioCambio: numero(f[c.envioCambio]) ?? 0,
        diferenciasMedidas: numero(f[c.diferenciasMedidas]) ?? 0,
        descuentos: numero(f[c.descuentos]) ?? 0,
        anulaciones: numero(f[c.anulaciones]) ?? 0,
        total,
        ordenes: [],
        skus: [],
        unidades: 0,
      };
      ventas.push(actual);
      // Una orden suelta trae su producto en la misma fila.
      const sku = (f[c.sku] ?? "").trim();
      if (sku) {
        actual.skus.push(sku);
        actual.unidades += numero(f[c.unidades]) ?? 0;
      }
      continue;
    }
    // Fila de producto: pertenece a la última venta con dinero.
    if (!actual) continue;
    if (id !== actual.venta && !actual.ordenes.includes(id)) actual.ordenes.push(id);
    const sku = (f[c.sku] ?? "").trim();
    if (sku) actual.skus.push(sku);
    actual.unidades += numero(f[c.unidades]) ?? 0;
  }
  return ventas;
}

export interface VentaErp {
  venta: string;
  ordenes: number;
  fecha: string;
  estados: string;
  tipo_venta: string | null;
  total: number;
  comision: number;
  envio: number;
  isr: number;
  iva: number;
  otros: number;
  sin_desglosar: number;
  neto: number;
  sin_neto: number;
  reembolsado: number;
  con_pago_real: number;
}

export interface DiferenciaVenta {
  venta: string;
  fecha: string | null;
  estado: string;
  modelo: string;
  motivo: "solo_reporte" | "solo_erp" | "neto" | "cargos";
  reporte: { ingresos: number; cargos: number; envio: number; anulaciones: number; total: number } | null;
  erp: { total: number; cargos: number; envio: number; reembolsado: number; neto: number } | null;
  diferencia: number;
}

export interface InformeVentasMeli {
  rango: { desde: string; hasta: string };
  ventasReporte: number;
  ventasErp: number;
  /** ventas del reporte que el ERP ya tiene con pago real: las comparables */
  comparables: number;
  sinPagoReal: number;
  cuadran: number;
  distintas: number;
  soloReporte: number;
  soloErp: number;
  canceladasReporte: number;
  /** sumas sobre las ventas COMPARABLES */
  sumas: {
    ingresos: number;
    total: number;
    cargosReporte: number;
    cargosErp: number;
    envioReporte: number;
    envioErp: number;
    anulacionesReporte: number;
    reembolsadoErp: number;
    netoReporte: number;
    netoErp: number;
  };
  /** sumas de TODO el reporte (para el total del mes) */
  reporteCompleto: { ingresos: number; cargo: number; envio: number; anulaciones: number; total: number; reventa: number };
  porEstadoDistintas: { estado: string; ventas: number; diferencia: number }[];
  ejemplos: DiferenciaVenta[];
  avisos: string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const esCancelada = (v: VentaReporte) => /cancelad|cancelaste/i.test(v.estado);

/** Cruce puro. */
export function conciliarVentas(reporte: VentaReporte[], erp: VentaErp[]): InformeVentasMeli {
  const fechas = reporte.map((v) => v.fecha).filter((f): f is string => Boolean(f)).sort();
  const rango = { desde: fechas[0] ?? "", hasta: fechas[fechas.length - 1] ?? "" };
  const avisos: string[] = [];
  const porId = new Map(erp.map((e) => [e.venta, e]));
  const vistas = new Set<string>();

  let comparables = 0;
  let sinPagoReal = 0;
  let cuadran = 0;
  let distintas = 0;
  let soloReporte = 0;
  let canceladasReporte = 0;
  const sumas = { ingresos: 0, total: 0, cargosReporte: 0, cargosErp: 0, envioReporte: 0, envioErp: 0, anulacionesReporte: 0, reembolsadoErp: 0, netoReporte: 0, netoErp: 0 };
  const completo = { ingresos: 0, cargo: 0, envio: 0, anulaciones: 0, total: 0, reventa: 0 };
  const diferencias: DiferenciaVenta[] = [];
  const porEstado = new Map<string, { ventas: number; diferencia: number }>();

  for (const v of reporte) {
    completo.ingresos += v.ingresos;
    completo.cargo += v.cargo;
    completo.envio += v.ingresosEnvio + v.costoEnvio + v.envioCambio + v.diferenciasMedidas;
    completo.anulaciones += v.anulaciones;
    completo.total += v.total;
    if (/reventa/i.test(v.modelo)) completo.reventa++;
    if (esCancelada(v)) canceladasReporte++;

    // El id del reporte puede ser el paquete o una orden; si no está como
    // venta, se busca por alguna de sus órdenes listadas.
    let e = porId.get(v.venta) ?? null;
    if (!e) for (const o of v.ordenes) if (porId.has(o)) { e = porId.get(o)!; break; }
    if (!e) {
      soloReporte++;
      if (!esCancelada(v)) diferencias.push({ venta: v.venta, fecha: v.fecha, estado: v.estado, modelo: v.modelo, motivo: "solo_reporte", reporte: { ingresos: v.ingresos, cargos: v.cargo, envio: v.ingresosEnvio + v.costoEnvio + v.envioCambio + v.diferenciasMedidas, anulaciones: v.anulaciones, total: v.total }, erp: null, diferencia: r2(v.total) });
      continue;
    }
    vistas.add(e.venta);
    if (e.con_pago_real < e.ordenes || e.sin_neto > 0) {
      sinPagoReal++;
      continue;
    }
    comparables++;
    const esReventa = /reventa/i.test(v.modelo) || e.tipo_venta === "reventa";
    const cargosErp = esReventa ? 0 : r2(-(e.comision + e.isr + e.iva + e.otros + e.sin_desglosar));
    const envioReporte = r2(v.ingresosEnvio + v.costoEnvio + v.envioCambio + v.diferenciasMedidas);
    const envioErp = esReventa ? 0 : r2(-e.envio);
    sumas.ingresos += v.ingresos;
    sumas.total += e.total;
    sumas.cargosReporte += v.cargo;
    sumas.cargosErp += cargosErp;
    sumas.envioReporte += envioReporte;
    sumas.envioErp += envioErp;
    sumas.anulacionesReporte += v.anulaciones;
    sumas.reembolsadoErp += -e.reembolsado;
    sumas.netoReporte += v.total;
    sumas.netoErp += e.neto;

    const dNeto = r2(v.total - e.neto);
    const dCargos = esReventa ? 0 : r2(v.cargo - cargosErp);
    if (Math.abs(dNeto) <= 0.01 && Math.abs(dCargos) <= 0.01) {
      cuadran++;
      continue;
    }
    distintas++;
    const pe = porEstado.get(v.estado) ?? { ventas: 0, diferencia: 0 };
    pe.ventas++;
    pe.diferencia += dNeto;
    porEstado.set(v.estado, pe);
    diferencias.push({
      venta: v.venta,
      fecha: v.fecha,
      estado: v.estado,
      modelo: v.modelo,
      motivo: Math.abs(dNeto) > 0.01 ? "neto" : "cargos",
      reporte: { ingresos: v.ingresos, cargos: v.cargo, envio: envioReporte, anulaciones: v.anulaciones, total: v.total },
      erp: { total: e.total, cargos: cargosErp, envio: envioErp, reembolsado: r2(-e.reembolsado), neto: e.neto },
      diferencia: Math.abs(dNeto) > 0.01 ? dNeto : dCargos,
    });
  }

  let soloErp = 0;
  for (const e of erp) {
    if (vistas.has(e.venta)) continue;
    if (rango.desde && rango.hasta && (e.fecha < rango.desde || e.fecha > rango.hasta)) continue;
    if (/cancelled/.test(e.estados) && e.ordenes === 1) continue;
    soloErp++;
    diferencias.push({ venta: e.venta, fecha: e.fecha, estado: e.estados, modelo: e.tipo_venta ?? "", motivo: "solo_erp", reporte: null, erp: { total: e.total, cargos: r2(-(e.comision + e.isr + e.iva)), envio: r2(-e.envio), reembolsado: r2(-e.reembolsado), neto: e.neto }, diferencia: r2(-e.neto) });
  }
  diferencias.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));

  if (sinPagoReal) avisos.push(`${sinPagoReal.toLocaleString("es-MX")} ventas del reporte todavía no tienen el pago real leído en el ERP (la recarga sigue): no se compararon.`);
  if (soloReporte) avisos.push(`${soloReporte.toLocaleString("es-MX")} ventas del reporte no están en el ERP (${canceladasReporte.toLocaleString("es-MX")} del reporte son canceladas).`);
  if (soloErp) avisos.push(`${soloErp.toLocaleString("es-MX")} ventas del ERP en el rango no aparecen en el reporte.`);

  const s = Object.fromEntries(Object.entries(sumas).map(([k, v]) => [k, r2(v)])) as typeof sumas;
  return {
    rango,
    ventasReporte: reporte.length,
    ventasErp: erp.length,
    comparables,
    sinPagoReal,
    cuadran,
    distintas,
    soloReporte,
    soloErp,
    canceladasReporte,
    sumas: s,
    reporteCompleto: { ingresos: r2(completo.ingresos), cargo: r2(completo.cargo), envio: r2(completo.envio), anulaciones: r2(completo.anulaciones), total: r2(completo.total), reventa: completo.reventa },
    porEstadoDistintas: [...porEstado.entries()].map(([estado, x]) => ({ estado, ventas: x.ventas, diferencia: r2(x.diferencia) })).sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia)),
    ejemplos: diferencias.slice(0, 80),
    avisos,
  };
}
