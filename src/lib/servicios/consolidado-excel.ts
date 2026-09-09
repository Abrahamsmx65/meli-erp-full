/**
 * Excel del corte general: por canal, total, por categoría, por modelo y
 * avisos, con números como números.
 */
import ExcelJS from "exceljs";
import { nombreDelPeriodo } from "./corte-meli";
import { NOMBRE_CANAL, type Consolidado } from "./consolidado";

const MONEDA = '"$"#,##0.00';

export async function excelDelConsolidado(cns: Consolidado): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";

  const encabezado = (hoja: ExcelJS.Worksheet, columnas: { header: string; key: string; width?: number; moneda?: boolean; pct?: boolean }[]) => {
    hoja.columns = columnas.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
    hoja.getRow(1).font = { bold: true };
    hoja.views = [{ state: "frozen", ySplit: 1 }];
    for (const c of columnas) {
      if (c.moneda) hoja.getColumn(c.key).numFmt = MONEDA;
      if (c.pct) hoja.getColumn(c.key).numFmt = "0.0%";
    }
  };

  // --- Resumen: una columna por canal y el total ---------------------------
  const resumen = wb.addWorksheet("Resumen");
  const columnas = [{ header: `Corte general ${nombreDelPeriodo(cns.periodo)}`, key: "concepto", width: 46 }, ...cns.canales.map((k) => ({ header: k.nombre, key: k.canal, width: 20 })), { header: "TOTAL", key: "total", width: 20 }];
  resumen.columns = columnas;
  resumen.getRow(1).font = { bold: true };
  for (const k of cns.canales) resumen.getColumn(k.canal).numFmt = MONEDA;
  resumen.getColumn("total").numFmt = MONEDA;
  const fila = (concepto: string, porCanal: (k: Consolidado["canales"][number]) => number | null, total: number | null, fmt?: string) => {
    const r = resumen.addRow({ concepto, ...Object.fromEntries(cns.canales.map((k) => [k.canal, porCanal(k)])), total });
    if (fmt) for (const cell of [...cns.canales.map((k) => k.canal), "total"]) r.getCell(cell).numFmt = fmt;
    return r;
  };
  fila("Unidades vendidas", (k) => k.unidades, cns.total.unidades, "#,##0");
  fila("Órdenes", (k) => k.ordenes, cns.total.ordenes, "#,##0");
  fila("Venta bruta", (k) => k.ventaBruta, cns.total.ventaBruta);
  const detalle = (k: Consolidado["canales"][number], campo: keyof Consolidado["canales"][number]["desglosePlataforma"]) =>
    k.desgloseDisponible === false ? null : -k.desglosePlataforma[campo];
  const totalDetalle = (campo: "comision" | "envio" | "isr" | "iva" | "otros" | "ajusteLiquidacion") =>
    cns.total.desgloseDisponible === false ? null : -cns.total[campo];
  fila("Comisión", (k) => detalle(k, "comision"), totalDetalle("comision"));
  fila("Envío", (k) => detalle(k, "envio"), totalDetalle("envio"));
  fila("Retención ISR", (k) => detalle(k, "isr"), totalDetalle("isr"));
  fila("Retención IVA", (k) => detalle(k, "iva"), totalDetalle("iva"));
  fila("Otros cargos", (k) => detalle(k, "otros"), totalDetalle("otros"));
  fila("Ajuste posterior de liquidación", (k) => detalle(k, "ajusteLiquidacion"), totalDetalle("ajusteLiquidacion"));
  if (cns.total.desgloseDisponible === false) {
    resumen.addRow({ concepto: "Desglose no disponible: este corte fue guardado antes de separar comisión, envío e impuestos." });
  }
  fila("Reembolsos ya reflejados en el neto", (k) => k.devolucionesIncluidasEnNeto ?? 0, cns.total.devolucionesIncluidasEnNeto);
  fila("Deducciones de plataforma", (k) => -k.descuentosPlataforma, -cns.total.descuentosPlataforma);
  fila("Neto depositado", (k) => k.neto, cns.total.neto);
  fila("Costo de producto", (k) => -k.costoProducto, -cns.total.costoProducto);
  fila("Utilidad bruta", (k) => k.utilidadBruta, cns.total.neto - cns.total.costoProducto).font = { bold: true };
  fila("Publicidad por modelo", (k) => -k.adsPorModelo, -(cns.total.publicidad - cns.canales.reduce((a, k) => a + k.adsGenerales, 0)));
  fila("Gastos generales de la plataforma", (k) => -k.gastosGenerales, -cns.total.gastosGenerales);
  fila("  Gasto general por unidad", (k) => k.cargoPorUnidad, null);
  fila("UTILIDAD ANTES DE GASTOS EMPRESARIALES", (k) => k.utilidadNeta, cns.total.utilidadAntesGastosEmpresariales).font = { bold: true };
  fila("GASTOS EMPRESARIALES", () => null, -cns.total.gastosEmpresariales);
  fila("UTILIDAD NETA DESPUÉS DE GASTOS EMPRESARIALES", () => null, cns.total.utilidadNeta).font = { bold: true, size: 12 };
  fila("Margen sobre la venta", (k) => k.margen, cns.total.margenSobreVenta, "0.0%");
  fila("Ganancia por unidad", (k) => k.gananciaPorUnidad, cns.total.gananciaPorUnidad);
  fila("Exacto", (k) => (k.exacto ? 1 : 0), cns.exacto ? 1 : 0, "0");
  resumen.addRow({});
  resumen.addRow({ concepto: "Gastos generales por concepto (se dividen entre las unidades vendidas en cada plataforma)" }).font = { bold: true };
  for (const k of cns.canales) for (const g of k.gastos) resumen.addRow({ concepto: `${k.nombre} · ${g.concepto}`, [k.canal]: g.monto });
  resumen.addRow({});
  resumen.addRow({ concepto: "Gastos empresariales (se descuentan una sola vez del total)" }).font = { bold: true };
  for (const g of cns.gastosEmpresariales ?? []) resumen.addRow({ concepto: `${g.fecha} · ${g.categoria} · ${g.concepto}`, total: -g.monto });

  // --- Por categoría --------------------------------------------------------
  const cats = wb.addWorksheet("Por categoría");
  encabezado(cats, [
    { header: "Categoría", key: "categoria", width: 22 },
    { header: "Unidades", key: "unidades", width: 10 },
    { header: "Venta", key: "importe", moneda: true },
    { header: "Comisión", key: "comision", moneda: true },
    { header: "Envío", key: "envio", moneda: true },
    { header: "ISR", key: "isr", moneda: true },
    { header: "IVA", key: "iva", moneda: true },
    { header: "Otros", key: "otros", moneda: true },
    { header: "Neto", key: "neto", moneda: true },
    { header: "Costo", key: "costo", moneda: true },
    { header: "Publicidad", key: "ads", moneda: true },
    { header: "Gastos generales", key: "cargoGeneral", moneda: true },
    { header: "Ganancia", key: "ganancia", moneda: true },
    ...cns.canales.map((k) => ({ header: `${NOMBRE_CANAL[k.canal]} · unidades`, key: `u_${k.canal}`, width: 22 })),
    ...cns.canales.map((k) => ({ header: `${NOMBRE_CANAL[k.canal]} · ganancia`, key: `g_${k.canal}`, width: 22, moneda: true })),
  ]);
  for (const k of cns.porCategoria) {
    cats.addRow({
      ...k,
      costo: k.costo ?? null,
      ganancia: k.ganancia ?? null,
      ...Object.fromEntries(cns.canales.map((c) => [`u_${c.canal}`, k.porCanal[c.canal]?.unidades ?? 0])),
      ...Object.fromEntries(cns.canales.map((c) => [`g_${c.canal}`, k.porCanal[c.canal]?.ganancia ?? null])),
    });
  }

  // --- Por modelo -----------------------------------------------------------
  const modelos = wb.addWorksheet("Por modelo");
  encabezado(modelos, [
    { header: "Modelo", key: "modelo", width: 18 },
    { header: "Categoría", key: "categoria", width: 18 },
    { header: "Canales", key: "canales", width: 30 },
    { header: "Unidades", key: "unidades", width: 10 },
    { header: "Venta", key: "importe", moneda: true },
    { header: "Comisión", key: "comision", moneda: true },
    { header: "Envío", key: "envio", moneda: true },
    { header: "ISR", key: "isr", moneda: true },
    { header: "IVA", key: "iva", moneda: true },
    { header: "Otros", key: "otros", moneda: true },
    { header: "Neto", key: "neto", moneda: true },
    { header: "Costo", key: "costo", moneda: true },
    { header: "Publicidad", key: "ads", moneda: true },
    { header: "Gastos generales", key: "cargoGeneral", moneda: true },
    { header: "Ganancia", key: "ganancia", moneda: true },
  ]);
  for (const m of cns.porModelo) modelos.addRow({ ...m, canales: m.canales.map((x) => NOMBRE_CANAL[x]).join(", "), costo: m.costo ?? null, ganancia: m.ganancia ?? null });

  // --- Por canal y modelo -------------------------------------------------
  for (const k of cns.canales) {
    const hoja = wb.addWorksheet(k.nombre.slice(0, 31));
    encabezado(hoja, [
      { header: "Modelo", key: "modelo", width: 18 },
      { header: "Categoría", key: "categoria", width: 18 },
      { header: "Unidades", key: "unidades", width: 10 },
      { header: "Venta", key: "importe", moneda: true },
      { header: "Comisión", key: "comision", moneda: true },
      { header: "Envío", key: "envio", moneda: true },
      { header: "ISR", key: "isr", moneda: true },
      { header: "IVA", key: "iva", moneda: true },
      { header: "Otros", key: "otros", moneda: true },
      { header: "Neto", key: "neto", moneda: true },
      { header: "Costo", key: "costo", moneda: true },
      { header: "Publicidad", key: "ads", moneda: true },
      { header: "Gastos generales", key: "cargoGeneral", moneda: true },
      { header: "Ganancia", key: "ganancia", moneda: true },
    ]);
    for (const m of k.porModelo) hoja.addRow({ ...m, costo: m.costo ?? null, ganancia: m.ganancia ?? null });
  }

  const avisos = wb.addWorksheet("Avisos");
  avisos.columns = [{ header: "Qué le falta al corte para ser exacto", key: "aviso", width: 130 }];
  avisos.getRow(1).font = { bold: true };
  if (!cns.avisos.length) avisos.addRow({ aviso: "Corte exacto: nada pendiente." });
  for (const a of cns.avisos) avisos.addRow({ aviso: a });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
