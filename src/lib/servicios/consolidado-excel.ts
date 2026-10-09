/**
 * Excel del corte general: por canal, total, cada peso, por categoría, por
 * modelo y qué falta, con números como números.
 *
 * Con los MISMOS tonos que la pantalla (pedido del dueño, 9-oct-2026: «que
 * el Excel tenga los tonos de colores nuevos que hicimos en la página»):
 * encabezados en el café oscuro de la marca, los bloques del estado de
 * resultados agrupados en gris claro como en «Por canal», la utilidad en
 * verde o rojo, renglones intercalados y la pestaña «Cada peso» con los
 * colores de la gráfica. Los colores salen de `globals.css`.
 */
import ExcelJS from "exceljs";
import { nombreDelPeriodo } from "./corte-meli";
import { NOMBRE_CANAL, adsPorModeloTotal, repartosPorUnidad, type Consolidado } from "./consolidado";
import { CANAL_CORTO, avisosParaMostrar, estadoDelCorte, repartoDelPeso } from "./consolidado-informe";

const MONEDA = '"$"#,##0.00;-"$"#,##0.00';

/** Los tokens de `globals.css`, en ARGB para ExcelJS. */
const COLOR = {
  marca: "FF2B2119",
  acento: "FF8B6640",
  acentoSuave: "FFF5EDE3",
  superficie2: "FFFAF7F2",
  borde: "FFE9E1D6",
  tinta: "FF2A2019",
  tinta2: "FF5E5146",
  tenue: "FF998A7B",
  exito: "FF00854A",
  bienSuave: "FFE9F7EF",
  critico: "FFC4182B",
  criticoSuave: "FFFDEEF0",
  alerta: "FF8A6100",
  alertaSuave: "FFFDF6E3",
  blanco: "FFFFFFFF",
  // gráficas: a dónde se va cada peso (tonos tierra de la marca)
  plataforma: "FFD9C7B2",
  producto: "FF8B6640",
  publicidad: "FFD3A52E",
  gastos: "FFB5523B",
  utilidad: "FF2F9C63",
} as const;

const relleno = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const bordeAbajo: Partial<ExcelJS.Borders> = { bottom: { style: "thin", color: { argb: COLOR.borde } } };

/** El encabezado de una tabla: café oscuro de la marca con letra blanca. */
function pintarEncabezado(fila: ExcelJS.Row): void {
  fila.height = 22;
  fila.eachCell((celda) => {
    celda.fill = relleno(COLOR.marca);
    celda.font = { bold: true, color: { argb: COLOR.blanco } };
    celda.alignment = { vertical: "middle", wrapText: true };
  });
}

/** Verde si gana, rojo si pierde (la columna de la ganancia). */
function colorPorSigno(celda: ExcelJS.Cell, negrita = true): void {
  const v = Number(celda.value);
  if (celda.value == null || !Number.isFinite(v)) return;
  celda.font = { bold: negrita, color: { argb: v < 0 ? COLOR.critico : COLOR.exito } };
}

export async function excelDelConsolidado(cns: Consolidado): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";

  const encabezado = (hoja: ExcelJS.Worksheet, columnas: { header: string; key: string; width?: number; moneda?: boolean; pct?: boolean }[]) => {
    hoja.columns = columnas.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
    pintarEncabezado(hoja.getRow(1));
    hoja.views = [{ state: "frozen", ySplit: 1 }];
    for (const c of columnas) {
      if (c.moneda) hoja.getColumn(c.key).numFmt = MONEDA;
      if (c.pct) hoja.getColumn(c.key).numFmt = "0.0%";
    }
  };
  /** Renglones intercalados y la ganancia con su color, como las tablas de la página. */
  const pintarTabla = (hoja: ExcelJS.Worksheet, columnaGanancia?: string) => {
    hoja.eachRow((fila, n) => {
      if (n === 1) return;
      if (n % 2 === 0) fila.eachCell({ includeEmpty: true }, (celda) => (celda.fill = relleno(COLOR.superficie2)));
      fila.eachCell({ includeEmpty: true }, (celda) => (celda.border = bordeAbajo));
      if (columnaGanancia) colorPorSigno(fila.getCell(columnaGanancia));
    });
    if (hoja.rowCount > 1) hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
  };

  // --- Resumen: una columna por canal y el total ---------------------------
  const resumen = wb.addWorksheet("Resumen", { properties: { tabColor: { argb: COLOR.marca } } });
  const columnas = [{ header: `Estado de resultados ${nombreDelPeriodo(cns.periodo)}`, key: "concepto", width: 46 }, ...cns.canales.map((k) => ({ header: k.nombre, key: k.canal, width: 20 })), { header: "TOTAL", key: "total", width: 20 }];
  resumen.columns = columnas;
  pintarEncabezado(resumen.getRow(1));
  resumen.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  for (const k of cns.canales) resumen.getColumn(k.canal).numFmt = MONEDA;
  resumen.getColumn("total").numFmt = MONEDA;
  const ancho = cns.canales.length + 2;
  const grupo = (titulo: string) => {
    const r = resumen.addRow({ concepto: titulo.toUpperCase() });
    for (let i = 1; i <= ancho; i++) {
      const celda = r.getCell(i);
      celda.fill = relleno(COLOR.superficie2);
      celda.font = { bold: true, size: 9, color: { argb: COLOR.tenue } };
    }
  };
  const fila = (concepto: string, porCanal: (k: Consolidado["canales"][number]) => number | null, total: number | null, fmt?: string) => {
    const r = resumen.addRow({ concepto, ...Object.fromEntries(cns.canales.map((k) => [k.canal, porCanal(k)])), total });
    if (fmt) for (const cell of [...cns.canales.map((k) => k.canal), "total"]) r.getCell(cell).numFmt = fmt;
    r.eachCell({ includeEmpty: true }, (celda) => (celda.border = bordeAbajo));
    r.getCell("total").font = { bold: true };
    return r;
  };
  /** Un renglón de resultado: fondo arena claro y cada cifra en verde o rojo. */
  const resultado = (r: ExcelJS.Row, grande = false) => {
    for (let i = 1; i <= ancho; i++) {
      const celda = r.getCell(i);
      celda.fill = relleno(COLOR.acentoSuave);
      if (i === 1) celda.font = { bold: true, size: grande ? 12 : 11, color: { argb: COLOR.tinta } };
      else colorPorSigno(celda);
      if (grande && i > 1 && celda.value != null) celda.font = { ...celda.font, size: 12 };
    }
    return r;
  };

  grupo("Venta");
  fila("Unidades vendidas", (k) => k.unidades, cns.total.unidades, "#,##0");
  fila("Órdenes", (k) => k.ordenes, cns.total.ordenes, "#,##0");
  fila("Venta bruta", (k) => k.ventaBruta, cns.total.ventaBruta).font = { bold: true };
  grupo("Se quedó la plataforma");
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
  fila("Neto depositado", (k) => k.neto, cns.total.neto).font = { bold: true };
  grupo("Costos y gastos");
  fila("Costo de producto", (k) => -k.costoProducto, -cns.total.costoProducto);
  fila("Utilidad bruta", (k) => k.utilidadBruta, cns.total.neto - cns.total.costoProducto).font = { bold: true };
  const repartos = repartosPorUnidad(cns);
  fila("Publicidad por modelo", (k) => -k.adsPorModelo, -adsPorModeloTotal(cns));
  fila("Gastos generales de la plataforma", (k) => -k.gastosGenerales, -cns.total.gastosGenerales);
  grupo("Resultado");
  resultado(fila("UTILIDAD ANTES DE GASTOS EMPRESARIALES", (k) => k.utilidadNeta, cns.total.utilidadAntesGastosEmpresariales));
  fila("GASTOS EMPRESARIALES", () => null, -cns.total.gastosEmpresariales);
  resultado(fila("UTILIDAD NETA DESPUÉS DE GASTOS EMPRESARIALES", () => null, cns.total.utilidadNeta), true);
  fila("Margen sobre la venta con neto leído", (k) => k.margen, cns.total.margenSobreVenta, "0.0%");
  fila("Ganancia por unidad", (k) => k.gananciaPorUnidad, cns.total.gananciaPorUnidad);
  grupo("Por unidad vendida");
  fila("  Publicidad por unidad", (k) => repartos.canal[k.canal]?.publicidad ?? null, repartos.total.publicidad);
  fila("  Gasto general por unidad", (k) => repartos.canal[k.canal]?.general ?? null, repartos.total.general);
  fila("  Publicidad + gastos generales por unidad", (k) => repartos.canal[k.canal]?.ambos ?? null, repartos.total.ambos);
  const estado = estadoDelCorte(cns);
  const filaEstado = resumen.addRow({ concepto: `Estado: ${estado.etiqueta}. ${estado.explicacion}` });
  filaEstado.getCell(1).font = { bold: true, color: { argb: estado.estado === "definitivo" ? COLOR.exito : estado.estado === "preliminar" ? COLOR.acento : COLOR.alerta } };
  fila("Exacto", (k) => (k.exacto ? 1 : 0), cns.exacto ? 1 : 0, "0");
  resumen.addRow({}).getCell(1).value = "El detalle de los gastos generales está en la hoja «Gastos generales».";
  resumen.addRow({});
  const tituloEmpresa = resumen.addRow({ concepto: "Gastos empresariales (se descuentan una sola vez del total)" });
  tituloEmpresa.font = { bold: true, color: { argb: COLOR.acento } };
  for (const g of cns.gastosEmpresariales ?? []) resumen.addRow({ concepto: `${g.fecha} · ${g.categoria} · ${g.concepto}`, total: -g.monto });

  // --- Gastos generales: su propia hoja, como su pestaña en la página ------
  const gastos = wb.addWorksheet("Gastos generales", { properties: { tabColor: { argb: COLOR.gastos } } });
  gastos.columns = [
    { header: "Canal", key: "canal", width: 24 },
    { header: "Concepto", key: "concepto", width: 64 },
    { header: "Monto", key: "monto", width: 18 },
    { header: "Por unidad", key: "porUnidad", width: 14 },
  ];
  pintarEncabezado(gastos.getRow(1));
  gastos.views = [{ state: "frozen", ySplit: 1 }];
  gastos.getColumn("monto").numFmt = MONEDA;
  gastos.getColumn("porUnidad").numFmt = MONEDA;
  for (const k of cns.canales) {
    if (!k.gastos.length) continue;
    for (const g of [...k.gastos].sort((a, b) => b.monto - a.monto)) {
      const r = gastos.addRow({ canal: CANAL_CORTO[k.canal], concepto: g.concepto, monto: g.monto, porUnidad: k.unidades ? Math.round((g.monto / k.unidades) * 100) / 100 : null });
      r.eachCell({ includeEmpty: true }, (celda) => (celda.border = bordeAbajo));
    }
    const sub = gastos.addRow({ canal: CANAL_CORTO[k.canal], concepto: `Total ${CANAL_CORTO[k.canal]} (${k.unidades.toLocaleString("es-MX")} unidades)`, monto: k.gastosGenerales, porUnidad: repartos.canal[k.canal]?.general ?? null });
    sub.eachCell({ includeEmpty: true }, (celda) => {
      celda.fill = relleno(COLOR.superficie2);
      celda.font = { bold: true };
      celda.border = bordeAbajo;
    });
  }
  const totalGastos = gastos.addRow({ canal: "Todos", concepto: "Total gastos generales", monto: cns.total.gastosGenerales, porUnidad: repartos.total.general });
  totalGastos.eachCell({ includeEmpty: true }, (celda) => {
    celda.fill = relleno(COLOR.acentoSuave);
    celda.font = { bold: true, color: { argb: COLOR.tinta } };
  });

  // --- Cada peso: de cada $100 de venta, con los colores de la gráfica -----
  const peso = wb.addWorksheet("Cada peso", { properties: { tabColor: { argb: COLOR.utilidad } } });
  const destinos = [
    { key: "plataforma", header: "Plataforma", color: COLOR.plataforma, letra: COLOR.tinta },
    { key: "costo", header: "Producto", color: COLOR.producto, letra: COLOR.blanco },
    { key: "publicidad", header: "Publicidad", color: COLOR.publicidad, letra: COLOR.tinta },
    { key: "gastos", header: "Gastos de plataforma", color: COLOR.gastos, letra: COLOR.blanco },
    { key: "utilidad", header: "Utilidad", color: COLOR.utilidad, letra: COLOR.blanco },
  ] as const;
  peso.columns = [
    { header: "De cada $100 de venta", key: "nombre", width: 26 },
    { header: "Venta", key: "venta", width: 18 },
    ...destinos.map((d) => ({ header: d.header, key: d.key, width: 18 })),
  ];
  pintarEncabezado(peso.getRow(1));
  destinos.forEach((d, i) => {
    const celda = peso.getRow(1).getCell(i + 3);
    celda.fill = relleno(d.color);
    celda.font = { bold: true, color: { argb: d.letra } };
  });
  peso.getColumn("venta").numFmt = MONEDA;
  for (const d of destinos) peso.getColumn(d.key).numFmt = '"$"0.00';
  for (const r of repartoDelPeso(cns)) {
    const f = peso.addRow({ nombre: r.nombre, venta: r.venta, ...Object.fromEntries(destinos.map((d) => [d.key, Math.round(r[d.key] * 10_000) / 100])) });
    f.eachCell({ includeEmpty: true }, (celda) => (celda.border = bordeAbajo));
    if (r.canal === "total") f.eachCell((celda) => (celda.font = { ...celda.font, bold: true }));
    colorPorSigno(f.getCell("utilidad"));
  }
  peso.addRow({});
  peso.addRow({ nombre: "Pesos de cada $100 de venta: plataforma = comisión, envío, retenciones y otros cargos; producto = costo; gastos = Full, FBA, devoluciones y demás cargos de la plataforma." }).getCell(1).font = { italic: true, color: { argb: COLOR.tenue } };

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
    { header: "Margen", key: "margen", width: 10, pct: true },
    ...cns.canales.map((k) => ({ header: `${NOMBRE_CANAL[k.canal]} · unidades`, key: `u_${k.canal}`, width: 22 })),
    ...cns.canales.map((k) => ({ header: `${NOMBRE_CANAL[k.canal]} · ganancia`, key: `g_${k.canal}`, width: 22, moneda: true })),
  ]);
  for (const k of [...cns.porCategoria].sort((a, b) => (b.ganancia ?? -Infinity) - (a.ganancia ?? -Infinity))) {
    cats.addRow({
      ...k,
      costo: k.costo ?? null,
      ganancia: k.ganancia ?? null,
      margen: k.ganancia != null && k.importe ? k.ganancia / k.importe : null,
      ...Object.fromEntries(cns.canales.map((c) => [`u_${c.canal}`, k.porCanal[c.canal]?.unidades ?? 0])),
      ...Object.fromEntries(cns.canales.map((c) => [`g_${c.canal}`, k.porCanal[c.canal]?.ganancia ?? null])),
    });
  }
  pintarTabla(cats, "ganancia");

  // --- Por modelo -----------------------------------------------------------
  const columnasModelo = [
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
    { header: "Margen", key: "margen", width: 10, pct: true },
    { header: "Por unidad", key: "porUnidad", width: 12, moneda: true },
  ];
  const extras = (m: { ganancia: number | null; importe: number; unidades: number }) => ({
    margen: m.ganancia != null && m.importe ? m.ganancia / m.importe : null,
    porUnidad: m.ganancia != null && m.unidades ? Math.round((m.ganancia / m.unidades) * 100) / 100 : null,
  });
  const porGanancia = <T extends { ganancia: number | null }>(xs: T[]) => [...xs].sort((a, b) => (b.ganancia ?? -Infinity) - (a.ganancia ?? -Infinity));
  /** Un modelo sin costo se marca en ámbar: su ganancia no se calcula. */
  const marcarSinCosto = (hoja: ExcelJS.Worksheet) => {
    hoja.eachRow((fila, n) => {
      if (n === 1 || fila.getCell("costo").value != null) return;
      fila.getCell("costo").value = "sin costo";
      fila.getCell("costo").font = { color: { argb: COLOR.alerta }, bold: true };
      fila.getCell("costo").fill = relleno(COLOR.alertaSuave);
    });
  };
  const modelos = wb.addWorksheet("Por modelo");
  encabezado(modelos, [
    { header: "Modelo", key: "modelo", width: 18 },
    { header: "Categoría", key: "categoria", width: 18 },
    { header: "Canales", key: "canales", width: 30 },
    ...columnasModelo,
  ]);
  for (const m of porGanancia(cns.porModelo)) modelos.addRow({ ...m, ...extras(m), canales: m.canales.map((x) => CANAL_CORTO[x] ?? NOMBRE_CANAL[x]).join(", "), costo: m.costo ?? null, ganancia: m.ganancia ?? null });
  pintarTabla(modelos, "ganancia");
  marcarSinCosto(modelos);

  // --- Por canal y modelo -------------------------------------------------
  for (const k of cns.canales) {
    const hoja = wb.addWorksheet(k.nombre.slice(0, 31));
    encabezado(hoja, [{ header: "Modelo", key: "modelo", width: 18 }, { header: "Categoría", key: "categoria", width: 18 }, ...columnasModelo]);
    for (const m of porGanancia(k.porModelo)) hoja.addRow({ ...m, ...extras(m), costo: m.costo ?? null, ganancia: m.ganancia ?? null });
    pintarTabla(hoja, "ganancia");
    marcarSinCosto(hoja);
  }

  // --- Qué falta: como la pestaña de la página ------------------------------
  const avisos = wb.addWorksheet("Qué falta", { properties: { tabColor: { argb: estado.acciones ? COLOR.alerta : COLOR.exito } } });
  avisos.columns = [
    { header: "Tipo", key: "tipo", width: 16 },
    { header: "Canal", key: "origen", width: 24 },
    { header: "Qué le falta al corte para ser exacto", key: "aviso", width: 120 },
  ];
  pintarEncabezado(avisos.getRow(1));
  const v = avisosParaMostrar(cns);
  const agregar = (tipo: string, origen: string, texto: string, letra: string, fondo: string) => {
    const r = avisos.addRow({ tipo, origen, aviso: texto });
    r.getCell("aviso").alignment = { wrapText: true, vertical: "top" };
    r.getCell("tipo").font = { bold: true, color: { argb: letra } };
    r.getCell("tipo").fill = relleno(fondo);
    r.eachCell({ includeEmpty: true }, (celda) => (celda.border = bordeAbajo));
  };
  for (const s of v.sinCosto) agregar("Pide acción", s.nombre, `${s.unidades} unidades de ${s.modelos.length} modelo(s) sin costo (${s.modelos.slice(0, 12).join(", ")}): su neto (${s.neto.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}) entra a la utilidad sin restarle costo.`, COLOR.critico, COLOR.criticoSuave);
  for (const a of v.acciones) agregar("Pide acción", a.origen, a.texto, COLOR.critico, COLOR.criticoSuave);
  for (const a of v.pendientes) agregar("Llega solo", a.origen, a.texto, COLOR.alerta, COLOR.alertaSuave);
  for (const a of v.notas) agregar("Nota", a.origen, a.texto, COLOR.tinta2, COLOR.superficie2);
  if (!cns.avisos.length) avisos.addRow({ tipo: "Listo", aviso: "Corte exacto: nada pendiente." });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
