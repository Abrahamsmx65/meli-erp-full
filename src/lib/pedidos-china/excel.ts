/**
 * El Excel del pedido EN EL FORMATO DE LA FÁBRICA (ver `fabricas.ts`).
 *
 * Una regla manda sobre el dibujo: lo que se genera lo tiene que poder leer
 * `importarProforma` y dar exactamente los mismos renglones, porque es el
 * mismo archivo que la fábrica regresa firmado y se vuelve a subir. Las
 * pruebas lo verifican formato por formato (`excel.test.ts`).
 *
 * Motor puro: recibe el pedido ya armado y devuelve el .xlsx.
 */
import ExcelJS from "exceljs";
import type { Moneda } from "../importar/proforma";
import { COMPRADOR, type PerfilFabrica } from "./fabricas";

export interface RenglonPI {
  modelo: string;
  descripcion: string;
  color: string;
  /** talla de la caja unitalla; null = caja de corrida */
  unitalla: string | null;
  /** corrida: pares de cada talla en UNA caja (vacío en unitalla) */
  corrida: Record<string, number>;
  paresPorCaja: number;
  cajas: number;
  /** precio por par */
  precio: number | null;
  /** corrida con precio distinto por talla */
  preciosTalla?: Record<string, number> | null;
  /** medidas de UNA caja, en cm */
  medidas?: { largoCm: number; anchoCm: number; altoCm: number } | null;
  /** m³ de UNA caja */
  cbmCaja: number | null;
}

export interface PedidoPI {
  pedido: string;
  /** AAAA-MM-DD */
  fecha: string;
  perfil: PerfilFabrica;
  moneda: Moneda | null;
  renglones: RenglonPI[];
}

export function paresDeRenglon(r: RenglonPI): number {
  return r.cajas * r.paresPorCaja;
}

export function importeDeRenglon(r: RenglonPI): number | null {
  if (r.unitalla || !r.preciosTalla) return r.precio == null ? null : r.precio * paresDeRenglon(r);
  let total = 0;
  for (const [t, n] of Object.entries(r.corrida)) {
    const p = r.preciosTalla[t] ?? r.precio;
    if (p == null) return null;
    total += p * n * r.cajas;
  }
  return total;
}

function numTalla(t: string): number {
  return Number(t) || 0;
}

/**
 * Las tallas que van en columnas: las del pedido, en orden. El lector de
 * proformas necesita al menos TRES columnas de talla para reconocer la
 * tabla, así que un pedido de una o dos tallas se completa con las vecinas
 * (vacías).
 */
export function tallasDeColumnas(renglones: RenglonPI[]): string[] {
  const set = new Set<string>();
  for (const r of renglones) {
    if (r.unitalla) set.add(r.unitalla);
    for (const t of Object.keys(r.corrida)) set.add(t);
  }
  const tallas = [...set].sort((a, b) => numTalla(a) - numTalla(b));
  while (tallas.length && tallas.length < 3) {
    const max = numTalla(tallas[tallas.length - 1]);
    const min = numTalla(tallas[0]);
    if (max < 35) tallas.push(String(max + 1));
    else tallas.unshift(String(min - 1));
  }
  return tallas;
}

const BORDE: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

/** Fila lógica de la tabla; cada formato decide en qué columna va cada cosa. */
interface FilaTabla {
  modelo: string;
  descripcion: string;
  color: string;
  /** talla -> número que va bajo la columna de la talla */
  bajoTalla: Record<string, number>;
  porCaja: number | null;
  cajas: number | null;
  pares: number;
  precio: number | null;
  importe: number | null;
  medidas: { largoCm: number; anchoCm: number; altoCm: number } | null;
  cbm: number | null;
}

function redondear(n: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function cbmDe(r: RenglonPI, cajas: number): number | null {
  if (r.cbmCaja != null && r.cbmCaja > 0) return redondear(r.cbmCaja * cajas);
  if (r.medidas) return redondear(((r.medidas.largoCm * r.medidas.anchoCm * r.medidas.altoCm) / 1e6) * cajas);
  return null;
}

/**
 * Las filas de la tabla según cómo escribe la fábrica una caja de una sola
 * talla:
 *   "cajas"    el número bajo la talla son las CAJAS (JINJIANG)
 *   "pares"    son los pares de la caja (JIAXING, MINGTAI, HUAIAN, FUZHOU)
 *   "por-color" un renglón por color con las cajas de cada talla (CHAOZHOU)
 * Una corrida con precio distinto por talla sale en filas de continuación.
 */
export function filasDeTabla(renglones: RenglonPI[], unitalla: "cajas" | "pares" | "por-color"): FilaTabla[] {
  const filas: FilaTabla[] = [];
  const medidasDe = (r: RenglonPI) => r.medidas ?? null;

  // CHAOZHOU: cajas de una sola talla del mismo color, pares por caja y
  // precio juntas en un renglón.
  const agrupadas = new Map<string, RenglonPI[]>();
  for (const r of renglones) {
    if (r.unitalla && unitalla === "por-color") {
      const k = `${r.modelo}|${r.color}|${r.paresPorCaja}|${r.precio ?? ""}`;
      const g = agrupadas.get(k);
      if (g) g.push(r);
      else agrupadas.set(k, [r]);
      continue;
    }
    if (r.unitalla) {
      const t = r.unitalla;
      filas.push({
        modelo: r.modelo,
        descripcion: r.descripcion,
        color: r.color,
        bajoTalla: { [t]: unitalla === "cajas" ? r.cajas : r.paresPorCaja },
        porCaja: r.paresPorCaja,
        cajas: r.cajas,
        pares: paresDeRenglon(r),
        precio: r.precio,
        importe: importeDeRenglon(r),
        medidas: medidasDe(r),
        cbm: cbmDe(r, r.cajas),
      });
      continue;
    }

    // Corrida: una fila por cada precio distinto (el primero con todo, las
    // demás de continuación, sin modelo ni color ni cajas).
    const grupos = new Map<number | null, string[]>();
    for (const t of Object.keys(r.corrida).sort((a, b) => numTalla(a) - numTalla(b))) {
      const p = r.preciosTalla?.[t] ?? r.precio;
      const g = grupos.get(p);
      if (g) g.push(t);
      else grupos.set(p, [t]);
    }
    let primera = true;
    for (const [precio, tallas] of grupos) {
      const bajoTalla: Record<string, number> = {};
      let paresCaja = 0;
      for (const t of tallas) {
        bajoTalla[t] = r.corrida[t];
        paresCaja += r.corrida[t];
      }
      const pares = paresCaja * r.cajas;
      filas.push({
        modelo: primera ? r.modelo : "",
        descripcion: primera ? r.descripcion : "",
        color: primera ? r.color : "",
        bajoTalla,
        porCaja: primera ? r.paresPorCaja : null,
        cajas: primera ? r.cajas : null,
        pares,
        precio,
        importe: precio == null ? null : redondear(precio * pares, 2),
        medidas: primera ? medidasDe(r) : null,
        cbm: primera ? cbmDe(r, r.cajas) : null,
      });
      primera = false;
    }
  }

  for (const g of agrupadas.values()) {
    const r = g[0];
    const bajoTalla: Record<string, number> = {};
    let cajas = 0;
    for (const x of g) {
      bajoTalla[x.unitalla!] = (bajoTalla[x.unitalla!] ?? 0) + x.cajas;
      cajas += x.cajas;
    }
    const pares = cajas * r.paresPorCaja;
    filas.push({
      modelo: r.modelo,
      descripcion: r.descripcion,
      color: r.color,
      bajoTalla,
      porCaja: r.paresPorCaja,
      cajas,
      pares,
      precio: r.precio,
      importe: r.precio == null ? null : redondear(r.precio * pares, 2),
      medidas: medidasDe(r),
      cbm: cbmDe(r, cajas),
    });
  }
  return filas;
}

/** "11/10/2026" o "2026/10/11" según la fábrica. */
function fechaComo(fecha: string, forma: "dma" | "amd"): string {
  const [a, m, d] = fecha.split("-");
  return forma === "dma" ? `${Number(d)}/${Number(m)}/${a}` : `${a}/${Number(m)}/${Number(d)}`;
}

interface Columnas {
  item: number;
  desc: number | null;
  color: number;
  /** segunda columna de color (JIAXING: OUTSOLE COLOR) */
  color2?: number;
  tallas: number;
  porCaja: number | null;
  cajas: number;
  pares: number;
  precio: number;
  importe: number;
  medidas: number | null;
  cbm: number | null;
  numero?: number;
}

function anchoDe(ws: ExcelJS.Worksheet, anchos: Record<number, number>): void {
  for (const [c, w] of Object.entries(anchos)) ws.getColumn(Number(c)).width = w;
}

function celda(ws: ExcelJS.Worksheet, fila: number, col: number, valor: ExcelJS.CellValue, opts?: { negrita?: boolean; formato?: string; centro?: boolean; borde?: boolean; tam?: number }): ExcelJS.Cell {
  const c = ws.getCell(fila, col);
  c.value = valor;
  if (opts?.negrita || opts?.tam) c.font = { bold: Boolean(opts?.negrita), size: opts?.tam ?? 10, name: "Arial" };
  else c.font = { size: 10, name: "Arial" };
  if (opts?.formato) c.numFmt = opts.formato;
  if (opts?.centro !== false) c.alignment = { vertical: "middle", horizontal: opts?.centro ? "center" : undefined, wrapText: true };
  if (opts?.borde) c.border = BORDE;
  return c;
}

/** Escribe la tabla con su encabezado; devuelve la fila siguiente al total. */
function escribirTabla(
  ws: ExcelJS.Worksheet,
  filaEnc: number,
  col: Columnas,
  tallas: string[],
  filas: FilaTabla[],
  etiquetas: {
    item: string;
    desc?: string;
    color: string;
    color2?: string;
    talla: (t: string) => string;
    tallaArriba?: string;
    porCaja: string;
    cajas: string;
    pares: string;
    precio: string;
    precioAbajo?: string;
    importe: string;
    importeAbajo?: string;
    medidas?: string;
    cbm?: string;
    numero?: string;
    /** fila extra bajo las tallas: "length | weighth | highth" o "L W H" */
    medidasAbajo?: [string, string, string];
    total: { col: number; texto: string };
    formatoPrecio: string;
  },
): number {
  const ult = Math.max(col.cbm ?? 0, col.importe, col.medidas != null ? col.medidas + 2 : 0);
  // Encabezado: etiquetas arriba, tallas en la fila de abajo (como las fábricas).
  const filaTallas = etiquetas.tallaArriba ? filaEnc + 1 : filaEnc;
  celda(ws, filaEnc, col.item, etiquetas.item, { negrita: true, centro: true });
  if (col.desc != null && etiquetas.desc) celda(ws, filaEnc, col.desc, etiquetas.desc, { negrita: true, centro: true });
  celda(ws, filaEnc, col.color, etiquetas.color, { negrita: true, centro: true });
  if (col.color2 != null && etiquetas.color2) celda(ws, filaTallas, col.color2, etiquetas.color2, { negrita: true, centro: true });
  if (etiquetas.numero && col.numero != null) celda(ws, filaEnc, col.numero, etiquetas.numero, { negrita: true, centro: true });
  if (etiquetas.tallaArriba) celda(ws, filaEnc, col.tallas, etiquetas.tallaArriba, { negrita: true, centro: true });
  tallas.forEach((t, k) => celda(ws, filaTallas, col.tallas + k, etiquetas.talla(t), { negrita: true, centro: true }));
  if (col.porCaja != null) celda(ws, filaEnc, col.porCaja, etiquetas.porCaja, { negrita: true, centro: true });
  celda(ws, filaEnc, col.cajas, etiquetas.cajas, { negrita: true, centro: true });
  celda(ws, filaEnc, col.pares, etiquetas.pares, { negrita: true, centro: true });
  celda(ws, filaEnc, col.precio, etiquetas.precio, { negrita: true, centro: true });
  if (etiquetas.precioAbajo) celda(ws, filaEnc + 1, col.precio, etiquetas.precioAbajo, { negrita: true, centro: true });
  celda(ws, filaEnc, col.importe, etiquetas.importe, { negrita: true, centro: true });
  if (etiquetas.importeAbajo) celda(ws, filaEnc + 1, col.importe, etiquetas.importeAbajo, { negrita: true, centro: true });
  if (col.medidas != null && etiquetas.medidas) celda(ws, filaEnc, col.medidas, etiquetas.medidas, { negrita: true, centro: true });
  if (col.medidas != null && etiquetas.medidasAbajo) {
    etiquetas.medidasAbajo.forEach((x, k) => celda(ws, filaTallas + (etiquetas.tallaArriba ? 0 : 1), col.medidas! + k, x, { negrita: true, centro: true }));
  }
  if (col.cbm != null && etiquetas.cbm) celda(ws, filaEnc, col.cbm, etiquetas.cbm, { negrita: true, centro: true });

  ws.getColumn(col.precio).width = 12;
  ws.getColumn(col.importe).width = 13;
  ws.getColumn(col.pares).width = 10;

  const filasEncabezado = etiquetas.tallaArriba || etiquetas.precioAbajo || etiquetas.importeAbajo ? 2 : 1;
  for (let f = filaEnc; f < filaEnc + filasEncabezado; f++) {
    for (let c = 1; c <= ult; c++) {
      const x = ws.getCell(f, c);
      x.border = BORDE;
      x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    }
  }

  let f = filaEnc + filasEncabezado;
  let numero = 0;
  let totCajas = 0;
  let totPares = 0;
  let totImporte = 0;
  let totCbm = 0;
  for (const x of filas) {
    if (col.numero != null && x.modelo) celda(ws, f, col.numero, ++numero, { centro: true });
    celda(ws, f, col.item, x.modelo || null, { negrita: Boolean(x.modelo) });
    if (col.desc != null) celda(ws, f, col.desc, x.descripcion || null);
    celda(ws, f, col.color, x.color || null);
    if (col.color2 != null) celda(ws, f, col.color2, x.color || null);
    tallas.forEach((t, k) => {
      const v = x.bajoTalla[t];
      celda(ws, f, col.tallas + k, v ? v : null, { centro: true });
    });
    if (col.porCaja != null) celda(ws, f, col.porCaja, x.porCaja, { centro: true });
    celda(ws, f, col.cajas, x.cajas, { centro: true });
    celda(ws, f, col.pares, x.pares, { centro: true });
    celda(ws, f, col.precio, x.precio, { formato: etiquetas.formatoPrecio, centro: true });
    celda(ws, f, col.importe, x.importe, { formato: etiquetas.formatoPrecio.replace(/0\.0+/, "#,##0.00"), centro: true });
    if (col.medidas != null && x.medidas) {
      celda(ws, f, col.medidas, redondear(x.medidas.largoCm / 100, 3), { centro: true });
      celda(ws, f, col.medidas + 1, redondear(x.medidas.anchoCm / 100, 3), { centro: true });
      celda(ws, f, col.medidas + 2, redondear(x.medidas.altoCm / 100, 3), { centro: true });
    }
    if (col.cbm != null) celda(ws, f, col.cbm, x.cbm, { formato: "0.000", centro: true });
    for (let c = 1; c <= ult; c++) ws.getCell(f, c).border = BORDE;
    totCajas += x.cajas ?? 0;
    totPares += x.pares;
    totImporte += x.importe ?? 0;
    totCbm += x.cbm ?? 0;
    f++;
  }

  celda(ws, f, etiquetas.total.col, etiquetas.total.texto, { negrita: true });
  celda(ws, f, col.cajas, totCajas, { negrita: true, centro: true });
  celda(ws, f, col.pares, totPares, { negrita: true, centro: true });
  if (totImporte > 0) {
    celda(ws, f, col.importe, redondear(totImporte, 2), {
      negrita: true,
      centro: true,
      formato: etiquetas.formatoPrecio.replace(/0\.0+/, "#,##0.00"),
    });
  }
  if (col.cbm != null && totCbm > 0) celda(ws, f, col.cbm, redondear(totCbm, 3), { negrita: true, centro: true, formato: "0.00" });
  for (let c = 1; c <= ult; c++) ws.getCell(f, c).border = BORDE;
  return f + 1;
}

function notas(ws: ExcelJS.Worksheet, fila: number, lineas: string[]): void {
  lineas.forEach((t, k) => celda(ws, fila + k, 1, t, { centro: false }));
}

function monedaTexto(m: Moneda | null): string {
  return m ?? "";
}

/** El .xlsx del pedido en el formato de su fábrica. */
export async function excelDePedido(p: PedidoPI): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GETAC";
  const ws = wb.addWorksheet(p.pedido, { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const tallas = tallasDeColumnas(p.renglones);
  const nT = tallas.length;
  const perfil = p.perfil;
  const m = monedaTexto(p.moneda);
  const modelos = [...new Set(p.renglones.map((r) => r.modelo))].join(", ");

  switch (perfil.formato) {
    case "chaozhou": {
      // A PHOTOS | B ITEM NO. | C COLOR | tallas | L W H | CBM | Ctns | QUANTITY | U./PRICE | AMOUNT
      const cT = 4;
      const cL = cT + nT;
      const col: Columnas = { item: 2, desc: null, color: 3, tallas: cT, porCaja: null, medidas: cL, cbm: cL + 3, cajas: cL + 4, pares: cL + 5, precio: cL + 6, importe: cL + 7 };
      celda(ws, 1, 1, `      ${perfil.nombre}`, { negrita: true, tam: 14, centro: false });
      perfil.direccion.forEach((d, k) => celda(ws, 2 + k, 1, d, { centro: false }));
      celda(ws, 4, 1, "  PROFORMA INVOICE", { negrita: true, tam: 14, centro: false });
      celda(ws, 5, col.precio, `INVOICE NO.: (${p.pedido})`, { negrita: true, centro: false });
      celda(ws, 6, 1, `TO:${COMPRADOR.nombre}`, { centro: false });
      celda(ws, 6, col.precio, `PAYMENT: ${perfil.pago}`, { centro: false });
      celda(ws, 7, col.precio, `DELIVERY TERMS: ${perfil.entrega}`, { centro: false });
      celda(ws, 8, col.precio, `DATE: ${fechaComo(p.fecha, "dma")}`, { centro: false });
      celda(ws, 9, 1, "PHOTOS", { negrita: true, centro: true });
      const sig = escribirTabla(ws, 9, col, tallas, filasDeTabla(p.renglones, "por-color"), {
        item: "ITEM NO.",
        color: "COLOR",
        talla: (t) => `${t}MX`,
        porCaja: "",
        cajas: "Ctns",
        pares: "QUANTITY",
        precio: "U./PRICE",
        precioAbajo: `(${m}) `,
        importe: "AMOUNT",
        importeAbajo: `(${m})`,
        medidas: "L",
        cbm: "CBM",
        total: { col: 2, texto: "TOTAL:" },
        formatoPrecio: "0.00",
      });
      // L | W | H van en tres columnas con su propia etiqueta.
      celda(ws, 9, cL + 1, "W", { negrita: true, centro: true });
      celda(ws, 9, cL + 2, "H", { negrita: true, centro: true });
      celda(ws, 10, col.pares, "(PRS)", { negrita: true, centro: true });
      notas(ws, sig + 1, perfil.notas);
      anchoDe(ws, { 1: 10, 2: 12, 3: 18 });
      break;
    }
    case "jinjiang": {
      // A Item No. | C DESCRIPTION | E COLOR | tallas | PER CTN | CTNS | PRS | FOB Xiamen RMB | importe | Means ×3 | CBMS
      const cT = 6;
      const c0 = cT + nT;
      const col: Columnas = { item: 1, desc: 3, color: 5, tallas: cT, porCaja: c0, cajas: c0 + 1, pares: c0 + 2, precio: c0 + 3, importe: c0 + 4, medidas: c0 + 5, cbm: c0 + 8 };
      celda(ws, 1, 1, "SHIPPER", { negrita: true, centro: false });
      celda(ws, 1, c0, "PROFORMA INVOICE", { negrita: true, tam: 14, centro: false });
      celda(ws, 2, 1, perfil.nombre, { negrita: true, centro: false });
      perfil.direccion.forEach((d, k) => celda(ws, 3 + k, 1, d, { centro: false }));
      celda(ws, 5, 1, "CONSIGNEE", { negrita: true, centro: false });
      celda(ws, 6, 1, COMPRADOR.nombre, { centro: false });
      celda(ws, 7, 1, COMPRADOR.direccion, { centro: false });
      celda(ws, 9, 1, "NOTIFY PARTY:", { negrita: true, centro: false });
      celda(ws, 10, 1, "SAME AS CONSIGNEE", { centro: false });
      celda(ws, 11, c0, "Invoice No.", { negrita: true, centro: false });
      celda(ws, 11, c0 + 2, "Date", { negrita: true, centro: false });
      celda(ws, 11, c0 + 4, "Page", { negrita: true, centro: false });
      celda(ws, 12, c0, p.pedido, { negrita: true, centro: false });
      celda(ws, 12, c0 + 2, p.fecha, { centro: false });
      celda(ws, 12, c0 + 4, "1/1", { centro: false });
      celda(ws, 14, 1, "Transport details", { centro: false });
      celda(ws, 14, c0, "TERMS OF PAYMENT:", { centro: false });
      celda(ws, 14, c0 + 2, perfil.pago, { centro: false });
      celda(ws, 15, c0, "TERMS OF DELIVERY :", { centro: false });
      celda(ws, 15, c0 + 2, perfil.entrega, { centro: false });
      celda(ws, 16, c0, "SHIPMENT DATE:", { centro: false });
      const sig = escribirTabla(ws, 19, col, tallas, filasDeTabla(p.renglones, "cajas"), {
        item: "Item No.",
        desc: "DESCRIPTION",
        color: "COLOR",
        tallaArriba: "SIZE",
        talla: (t) => `${t}MX`,
        porCaja: "PER CTN",
        cajas: "CTNS",
        pares: "PRS",
        precio: `FOB Xiamen ${m}`,
        importe: "",
        medidas: "Means",
        cbm: "CBMS",
        total: { col: 1, texto: "TTL" },
        formatoPrecio: "0.00",
      });
      notas(ws, sig + 1, perfil.notas);
      anchoDe(ws, { 1: 10, 3: 22, 5: 22, [c0]: 20 });
      break;
    }
    case "mingtai":
    case "jiaxing": {
      // B Item No. | C DESCRIPTION | (E) COLOR | tallas | PER CTN | CTNS | PRS | FOB … | importe | MEANS ×3 | CBMS
      const jiaxing = perfil.formato === "jiaxing";
      const cT = 6;
      const c0 = cT + nT;
      const col: Columnas = {
        item: 2,
        desc: 3,
        color: jiaxing ? 4 : 5,
        color2: jiaxing ? 5 : undefined,
        tallas: cT,
        porCaja: c0,
        cajas: c0 + 1,
        pares: c0 + 2,
        precio: c0 + 3,
        importe: c0 + 4,
        medidas: c0 + 5,
        cbm: c0 + 8,
      };
      celda(ws, 1, 1, perfil.nombre, { negrita: true, tam: 14, centro: false });
      perfil.direccion.forEach((d, k) => celda(ws, 2 + k, 1, d, { centro: false }));
      celda(ws, 3, 1, "PROFOMA INVOICE", { negrita: true, tam: 14, centro: false });
      celda(ws, 5, 2, `DATE: ${p.fecha}`, { centro: false });
      celda(ws, 6, 1, `PI : ${p.pedido}`, { negrita: true, centro: false });
      const sig = escribirTabla(ws, 7, col, tallas, filasDeTabla(p.renglones, "pares"), {
        item: "Item No.",
        desc: "DESCRIPTION",
        color: "COLOR",
        color2: jiaxing ? "OUTSOLE COLOR" : undefined,
        tallaArriba: "SIZE",
        talla: (t) => `${t}MX`,
        porCaja: "PER CTN",
        cajas: "CTNS",
        pares: "PRS",
        precio: `${perfil.entrega} ${jiaxing ? "" : m}`.trim(),
        importeAbajo: jiaxing ? m : undefined,
        importe: "",
        medidas: "MEANS",
        medidasAbajo: ["length", "weighth", "highth"],
        cbm: "CBMS",
        total: { col: 1, texto: "TTL" },
        formatoPrecio: "0.00",
      });
      notas(ws, sig, perfil.notas);
      anchoDe(ws, { 2: 12, 3: 26, 4: 16, 5: 16 });
      break;
    }
    case "fuzhou": {
      // A NO. | B PICTURE | C Article no | D COLOR | tallas "Mex 23" | PRS/CTN | TOTAL CTNS | TOTAL PRS | UNIT PRICE | TOTAL PRICE
      const cT = 5;
      const c0 = cT + nT;
      const col: Columnas = { numero: 1, item: 3, desc: null, color: 4, tallas: cT, porCaja: c0, cajas: c0 + 1, pares: c0 + 2, precio: c0 + 3, importe: c0 + 4, medidas: null, cbm: c0 + 5 };
      celda(ws, 1, 1, perfil.nombre, { negrita: true, tam: 14, centro: false });
      perfil.direccion.forEach((d, k) => celda(ws, 2 + k, 1, d, { centro: false }));
      celda(ws, 4, 1, "Proforma Invoice", { negrita: true, tam: 14, centro: false });
      celda(ws, 5, 1, `To：${COMPRADOR.nombre}`, { centro: false });
      celda(ws, 5, c0 + 2, `    PI NO.: (${p.pedido})`, { negrita: true, centro: false });
      celda(ws, 6, 1, COMPRADOR.direccion, { centro: false });
      celda(ws, 6, c0 + 2, `     Date:${fechaComo(p.fecha, "amd")}`, { centro: false });
      celda(ws, 9, 1, "The undersigned Sellers and Buyers have agreed to close the following transactions according to the terms and conditions stipulated below:", { centro: false });
      celda(ws, 11, cT, "SIZE RUN", { negrita: true, centro: false });
      celda(ws, 12, 2, "PICTURE", { negrita: true, centro: true });
      const fmt = p.moneda === "USD" ? '"US$"#,##0.000' : "0.000";
      const sig = escribirTabla(ws, 12, col, tallas, filasDeTabla(p.renglones, "pares"), {
        numero: "NO.",
        item: "Article no",
        color: "COLOR",
        talla: (t) => `Mex ${t}`,
        porCaja: "PRS/CTN",
        cajas: "TOTAL CTNS",
        pares: "TOTAL PRS",
        precio: `UNIT PRICE \n(${perfil.entrega})`,
        importe: "TOTAL PRICE",
        cbm: "CBM",
        total: { col: c0, texto: "Total" },
        formatoPrecio: fmt,
      });
      notas(ws, sig + 1, perfil.notas);
      anchoDe(ws, { 1: 5, 2: 10, 3: 12, 4: 18 });
      break;
    }
    default: {
      // Item No. | DESCRIPTION | COLOR | tallas | PER CTN | CTNS | PRS | PRICE | AMOUNT | L W H | CBM
      const cT = 4;
      const c0 = cT + nT;
      const col: Columnas = { item: 1, desc: 2, color: 3, tallas: cT, porCaja: c0, cajas: c0 + 1, pares: c0 + 2, precio: c0 + 3, importe: c0 + 4, medidas: c0 + 5, cbm: c0 + 8 };
      celda(ws, 1, 1, perfil.nombre, { negrita: true, tam: 14, centro: false });
      celda(ws, 2, 1, "PROFORMA INVOICE", { negrita: true, tam: 12, centro: false });
      celda(ws, 3, 1, `PI : ${p.pedido}`, { negrita: true, centro: false });
      celda(ws, 4, 1, `To: ${COMPRADOR.nombre} · Date ${p.fecha} · ${perfil.entrega} · ${modelos}`, { centro: false });
      if (perfil.pago) celda(ws, 5, 1, `Payment: ${perfil.pago}`, { centro: false });
      const sig = escribirTabla(ws, 7, col, tallas, filasDeTabla(p.renglones, "pares"), {
        item: "Item No.",
        desc: "DESCRIPTION",
        color: "COLOR",
        talla: (t) => `${t}MX`,
        porCaja: "PER CTN",
        cajas: "CTNS",
        pares: "PRS",
        precio: m ? `PRICE (${m})` : "PRICE",
        importe: m ? `AMOUNT (${m})` : "AMOUNT",
        medidas: "L (m)",
        cbm: "CBM",
        total: { col: 1, texto: "TOTAL" },
        formatoPrecio: "0.00",
      });
      celda(ws, 7, c0 + 6, "W (m)", { negrita: true, centro: true });
      celda(ws, 7, c0 + 7, "H (m)", { negrita: true, centro: true });
      notas(ws, sig + 1, perfil.notas);
      anchoDe(ws, { 1: 12, 2: 24, 3: 18 });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/** Nombre del archivo como los nombra el dueño: "IN10184 (GT179).xlsx". */
export function nombreArchivoPedido(pedido: string, renglones: RenglonPI[]): string {
  const modelos = [...new Set(renglones.map((r) => r.modelo))];
  const soloUnitalla = renglones.every((r) => r.unitalla);
  return `${pedido} (${modelos.join(", ")})${soloUnitalla ? " Solid size" : ""}.xlsx`;
}
