/**
 * Excel del corte mensual: toda la información del estado de resultados en
 * hojas separadas (resumen, por modelo, por categoría, por día, gastos,
 * cargos facturados y avisos), con números como números para poder sumar
 * y filtrar en Excel.
 */
import ExcelJS from "exceljs";
import { nombreDelPeriodo, type EstadoResultados } from "./corte-meli";
import { puenteVentaANeto } from "./corte-meli-cascada";

const MONEDA = '"$"#,##0.00';

export async function excelDelCorte(e: EstadoResultados, opts?: { negocio?: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";
  wb.created = new Date(e.generadoEn);
  const negocio = opts?.negocio ?? "Mercado Libre";

  const encabezado = (hoja: ExcelJS.Worksheet, columnas: { header: string; key: string; width?: number; moneda?: boolean; pct?: boolean }[]) => {
    hoja.columns = columnas.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
    hoja.getRow(1).font = { bold: true };
    hoja.views = [{ state: "frozen", ySplit: 1 }];
    for (const c of columnas) {
      if (c.moneda) hoja.getColumn(c.key).numFmt = MONEDA;
      if (c.pct) hoja.getColumn(c.key).numFmt = "0.0%";
    }
  };

  // --- Resumen ----------------------------------------------------------
  const resumen = wb.addWorksheet("Resumen");
  resumen.columns = [
    { header: "Concepto", key: "concepto", width: 44 },
    { header: "Monto", key: "monto", width: 18 },
    { header: "Nota", key: "nota", width: 70 },
  ];
  resumen.getRow(1).font = { bold: true };
  resumen.getColumn("monto").numFmt = MONEDA;
  const puente = puenteVentaANeto(e);
  const filas: [string, number | string | null, string][] = [
    [`Corte ${nombreDelPeriodo(e.periodo)} · ${negocio}`, null, `${e.desde} a ${e.hasta} · ${e.dias} días · ${e.revision.exacto ? "corte exacto" : "con pendientes (ver Avisos)"}`],
    ["Pares vendidos", e.unidades, ""],
    ["Órdenes", e.ordenes, ""],
    ["Venta bruta", puente.ventaBruta, "precio × pares de las órdenes pagadas"],
    ["Comisión de MELI", -puente.comision, `sale fee de cada orden${e.reventa?.ordenes ? `; ${e.reventa.ordenes} ventas en reventa por $${e.reventa.importe.toFixed(2)} ya vienen netas` : ""}`],
    ["Envío", -puente.envio, "cargo de envío asociado a las ventas"],
    ["Retención ISR", -puente.isr, "impuesto adelantado enterado por MELI al SAT"],
    ["Retención IVA", -puente.iva, "impuesto adelantado enterado por MELI al SAT"],
    ["Otros cargos", -puente.otros, e.cargosSinDesglosar ? `incluye $${e.cargosSinDesglosar.toFixed(2)} sin concepto por operación` : "otros descuentos incluidos en el depósito"],
    ["Ajuste posterior de liquidación", -puente.ajusteLiquidacion, "cambio del saldo de Mercado Pago después del depósito original"],
    ["Reembolsos ya reflejados en el neto", -puente.devolucionesIncluidasEnNeto, "Mercado Pago ya redujo el saldo actual; este renglón cuadra la cascada"],
    ["Neto depositado por Mercado Pago", puente.netoDepositado, e.netoEstimado > 0 ? `${e.netoEstimado.toFixed(2)} estimado (sin depósito real aún)` : "depósito real de todas las órdenes"],
    ["Devoluciones", -e.devoluciones.monto, `${e.devoluciones.ordenes} órdenes; ${e.devoluciones.incluidoEnNeto ?? 0} ya está reflejado en el neto`],
    ["Costo recuperado de devoluciones", e.devoluciones.costoRecuperado, `${e.devoluciones.unidades} pares que regresan al stock${e.devoluciones.costoEstimado ? ` (${e.devoluciones.costoEstimado.toFixed(2)} estimado)` : ""}`],
    ["Costo de producto", -e.costoProducto, `${e.unidadesConCosto} de ${e.unidades} pares con costo capturado`],
    ["Utilidad bruta", e.utilidadBruta, ""],
    ["Publicidad", -e.publicidad.total, `Product Ads ${e.publicidad.ads.toFixed(2)} + a mano ${e.publicidad.manual.toFixed(2)}`],
    ["Gastos de Full", -e.full.total, `facturado por MELI ${e.full.cargosMeli.toFixed(2)} + a mano ${e.full.manual.toFixed(2)}`],
    ["Otros gastos", -e.otros.total, `otros cargos de MELI ${e.otros.cargosMeli.toFixed(2)} + a mano ${e.otros.manual.toFixed(2)}`],
    ["UTILIDAD NETA", e.utilidadNeta, ""],
    ["Margen sobre la venta", e.margenSobreVenta, ""],
    ["Margen sobre el neto", e.margenSobreNeto, ""],
    ["Ganancia por par", e.gananciaPorPar, ""],
    ["Órdenes canceladas (fuera del corte)", e.cancelaciones.ordenes, `por $${e.cancelaciones.importe.toFixed(2)}`],
    ["Órdenes revisadas contra devoluciones", e.revision.revisadas, `de ${e.revision.ordenes}; ${e.revision.pendientes} pendientes`],
    ["Generado", e.generadoEn, e.cuenta ?? ""],
  ];
  for (const [concepto, monto, nota] of filas) resumen.addRow({ concepto, monto, nota });
  const filaDe = (concepto: string) => resumen.getColumn("concepto").values.findIndex((v) => v === concepto);
  for (const concepto of ["Margen sobre la venta", "Margen sobre el neto"]) {
    resumen.getRow(filaDe(concepto)).getCell("monto").numFmt = "0.0%";
  }
  for (const concepto of ["Pares vendidos", "Órdenes", "Órdenes canceladas (fuera del corte)", "Órdenes revisadas contra devoluciones"]) {
    resumen.getRow(filaDe(concepto)).getCell("monto").numFmt = "#,##0";
  }
  resumen.getRow(2).font = { bold: true, size: 13 };
  for (const concepto of ["Neto depositado por Mercado Pago", "Utilidad bruta", "UTILIDAD NETA"]) {
    resumen.getRow(filaDe(concepto)).font = { bold: true };
  }

  // --- Por modelo ---------------------------------------------------------
  const modelos = wb.addWorksheet("Por modelo");
  encabezado(modelos, [
    { header: "Modelo", key: "modelo", width: 18 },
    { header: "Categoría", key: "categoria", width: 18 },
    { header: "Pares", key: "unidades", width: 10 },
    { header: "Venta", key: "importe", moneda: true },
    { header: "Comisión", key: "comision", moneda: true },
    { header: "Envío", key: "envio", moneda: true },
    { header: "ISR", key: "isr", moneda: true },
    { header: "IVA", key: "iva", moneda: true },
    { header: "Otros cargos", key: "otrosCargos", moneda: true },
    { header: "Neto", key: "neto", moneda: true },
    { header: "Costo", key: "costo", moneda: true },
    { header: "Publicidad", key: "publicidad", moneda: true },
    { header: "Ganancia", key: "ganancia", moneda: true },
  ]);
  for (const m of e.porModelo) modelos.addRow({ ...m, categoria: m.categoria ?? "", costo: m.costo ?? null, ganancia: m.ganancia ?? null });

  // --- Por categoría --------------------------------------------------------
  const cats = wb.addWorksheet("Por categoría");
  encabezado(cats, [
    { header: "Categoría", key: "categoria", width: 22 },
    { header: "Pares", key: "unidades", width: 10 },
    { header: "Venta", key: "importe", moneda: true },
    { header: "Comisión", key: "comision", moneda: true },
    { header: "Envío", key: "envio", moneda: true },
    { header: "ISR", key: "isr", moneda: true },
    { header: "IVA", key: "iva", moneda: true },
    { header: "Otros cargos", key: "otrosCargos", moneda: true },
    { header: "Neto", key: "neto", moneda: true },
    { header: "Costo", key: "costo", moneda: true },
    { header: "Publicidad", key: "publicidad", moneda: true },
    { header: "Ganancia", key: "ganancia", moneda: true },
  ]);
  for (const k of e.porCategoria) cats.addRow({ ...k, costo: k.costo ?? null, ganancia: k.ganancia ?? null });

  // --- Por día --------------------------------------------------------------
  const dias = wb.addWorksheet("Por día");
  encabezado(dias, [
    { header: "Día", key: "fecha", width: 12 },
    { header: "Pares", key: "unidades", width: 10 },
    { header: "Órdenes", key: "ordenes", width: 10 },
    { header: "Venta", key: "importe", moneda: true },
    { header: "Neto", key: "neto", moneda: true },
    { header: "Neto real", key: "real", width: 10 },
  ]);
  for (const d of e.porDia) dias.addRow({ ...d, real: d.real ? "sí" : "estimado" });

  // --- Gastos y cargos ------------------------------------------------------
  const gastos = wb.addWorksheet("Gastos a mano");
  encabezado(gastos, [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Concepto", key: "concepto", width: 40 },
    { header: "Tipo", key: "categoria", width: 14 },
    { header: "Monto", key: "monto", moneda: true },
  ]);
  for (const g of e.gastosManuales) gastos.addRow(g);

  const cargos = wb.addWorksheet("Facturado por MELI");
  encabezado(cargos, [
    { header: "Tipo de cargo", key: "tipo", width: 40 },
    { header: "Clase", key: "clase", width: 16 },
    { header: "Renglones", key: "renglones", width: 12 },
    { header: "Monto", key: "monto", moneda: true },
  ]);
  for (const k of e.cargosPorTipo) cargos.addRow(k);

  const avisos = wb.addWorksheet("Avisos");
  avisos.columns = [{ header: "Qué le falta al corte para ser exacto", key: "aviso", width: 120 }];
  avisos.getRow(1).font = { bold: true };
  if (e.avisos.length === 0) avisos.addRow({ aviso: "Corte exacto: nada pendiente." });
  for (const a of e.avisos) avisos.addRow({ aviso: a });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
