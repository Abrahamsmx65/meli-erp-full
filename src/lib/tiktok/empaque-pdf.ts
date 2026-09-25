/**
 * El PDF de la lista de EMPAQUE del corte, hoja por hoja. Solo dibuja: los
 * datos ya vienen cargados (`CorteParaLista`) y qué cabe en cada hoja lo
 * decide `tiktok/empaque.ts`. Separado de `servicios/tiktok-despacho.ts`
 * para poder armarlo sin base (previews, pruebas).
 *
 * Reglas del dueño:
 * · 18-sep-2026: sin códigos de barras; un renglón por SKU completo, los
 *   paquetes intercalados gris y blanco, la cantidad de más de un par en
 *   un recuadro sombreado y un paquete con varios renglones en recuadro
 *   negro con su total.
 * · 25-sep-2026: cada MODELO empieza en su propia hoja y cada hoja trae
 *   ARRIBA lo que hay que surtir para esa hoja (modelo + color, tallas y
 *   pares): se surte eso y luego se empaca la hoja completa. La lista de
 *   surtido del corte completo hacía «más bolas».
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { agruparPorModelo, type OrdenPaquetes, type PaqueteNumerado } from "./despacho";
import { partirEnHojas, renglonesDeTallas, type Hoja, type LineaSurtido } from "./empaque";

export interface CorteParaLista {
  numero: number;
  creadoEn: string;
  orden: OrdenPaquetes;
  paquetes: PaqueteNumerado[];
}

const CARTA: [number, number] = [612, 792];
const M = 36;
const ANCHO = CARTA[0] - 2 * M;
/** Columnas: # | Pedido (texto) | SKU completo | Cant. | Destinatario | ☐ */
const COL = [30, 118, 190, 44, ANCHO - 30 - 118 - 190 - 44 - 18, 18];
const XS = COL.reduce<number[]>((acc, w, i) => [...acc, (acc[i - 1] ?? M) + (i ? COL[i - 1] : 0)], []);
const FILA = 16;
/** La cabecera de una hoja de continuación (una línea) más el encabezado de la tabla. */
const ALTO_CABECERA = 18 + 4 + FILA;
/** Lo que agrega el título grande del modelo en su primera hoja. */
const ALTO_TITULO_MODELO = 20;
/** Lo que agrega la línea del corte (fecha, paquetes, resumen) en la primera hoja del corte. */
const ALTO_LINEA_CORTE = 14;
/** El bloque de surtido: título, un renglón por línea, márgenes. */
const SURTIDO_TITULO = 13;
const SURTIDO_RENGLON = 14;
const SURTIDO_MARGEN = 6;
const SURTIDO_HUECO = 12;
const SURTIDO_ETIQUETA = 118;

const negro = rgb(0, 0, 0);
const gris = rgb(0.45, 0.45, 0.45);
const linea = rgb(0.75, 0.75, 0.75);
const fondoGris = rgb(0.9, 0.9, 0.9);
const sombraCant = rgb(0.8, 0.8, 0.8);
const fondoSurtido = rgb(0.96, 0.96, 0.96);

export async function pdfListaDeEmpaque(corte: CorteParaLista): Promise<Uint8Array> {
  const grupos = agruparPorModelo(corte.paquetes, corte.orden);
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Corte ${corte.numero} · lista de empaque`);

  const medirTallas = (t: string) => negrita.widthOfTextAtSize(t, 10);
  const anchoTallas = ANCHO - SURTIDO_ETIQUETA - 2 * SURTIDO_MARGEN - 50;
  const renglonesSurtido = (s: LineaSurtido[]) =>
    s.reduce((n, l) => n + Math.max(1, renglonesDeTallas(l.tallas, anchoTallas, medirTallas).length), 0);
  const altoSurtido = (s: LineaSurtido[]) =>
    SURTIDO_TITULO + renglonesSurtido(s) * SURTIDO_RENGLON + 2 * SURTIDO_MARGEN + SURTIDO_HUECO;
  // La línea del corte (fecha, paquetes, resumen por modelo) va SOLO en la
  // primera hoja y el título grande del modelo solo en la primera hoja de
  // ese modelo; las de continuación llevan una sola línea de cabecera
  // (dueño, 25-sep-2026: «esto no lo tienes que repetir en cada hoja»).
  const costoFijoDe = (iGrupo: number) => (s: LineaSurtido[], iHoja: number) =>
    ALTO_CABECERA +
    (iHoja === 0 ? ALTO_TITULO_MODELO : 0) +
    (iGrupo === 0 && iHoja === 0 ? ALTO_LINEA_CORTE : 0) +
    altoSurtido(s);
  const costoPaquete = (p: PaqueteNumerado) => FILA * Math.max(1, p.pares.length);
  const altoUtil = CARTA[1] - 2 * M;

  // Primero se planean TODAS las hojas (para saber «hoja X de Y»), luego se dibujan.
  const plan = grupos.map((g, iGrupo) => ({ grupo: g, hojas: partirEnHojas(g.paquetes, altoUtil, costoPaquete, costoFijoDe(iGrupo)) }));
  const totalHojas = plan.reduce((n, p) => n + p.hojas.length, 0);
  const totalPares = grupos.reduce((a, g) => a + g.pares, 0);
  const fecha = new Date(corte.creadoEn).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const resumen = grupos.map((g) => `${g.modelo} ${g.pares}`).join("  ·  ");

  let hojaN = 0;
  plan.forEach(({ grupo: g, hojas }, iGrupo) => {
    hojas.forEach((hoja, i) => {
      hojaN++;
      const pagina = doc.addPage(CARTA);
      let y = CARTA[1] - M;
      const titulo = g.revuelto ? `${g.modelo.toUpperCase()} (varios modelos en la misma caja)` : g.modelo;
      const primeraDelModelo = i === 0;
      const primeraDelCorte = iGrupo === 0 && i === 0;

      // Cabecera de una línea: el corte y, en una hoja de continuación, el
      // modelo; a la derecha, qué hoja es (del modelo y del corte).
      const izquierda = primeraDelModelo
        ? `Corte #${corte.numero} · TikTok Shop · lista de empaque`
        : `Corte #${corte.numero} · lista de empaque · ${titulo}`;
      pagina.drawText(izquierda, { x: M, y, size: 11, font: negrita });
      const derecha = (hojas.length > 1 ? `${titulo}: hoja ${i + 1} de ${hojas.length}   ·   ` : "") + `hoja ${hojaN} de ${totalHojas}`;
      pagina.drawText(derecha, { x: M + ANCHO - normal.widthOfTextAtSize(derecha, 9), y, size: 9, font: normal, color: gris });
      y -= 18;
      if (primeraDelCorte) {
        pagina.drawText(recorta(`${fecha}   ·   ${corte.paquetes.length} paquetes   ·   ${totalPares} pares   ·   ${resumen}`, ANCHO, 8, normal), { x: M, y, size: 8, font: normal, color: gris });
        y -= ALTO_LINEA_CORTE;
      }
      if (primeraDelModelo) {
        pagina.drawText(`${titulo}  —  ${g.pares} ${g.pares === 1 ? "par" : "pares"} en ${g.paquetes.length} ${g.paquetes.length === 1 ? "paquete" : "paquetes"}${hojas.length > 1 ? `  ·  ${hojas.length} hojas` : ""}`, { x: M, y, size: 13, font: negrita });
        y -= ALTO_TITULO_MODELO;
      }
      const paresHoja = hoja.surtido.reduce((a, l) => a + l.pares, 0);

      // Bloque de surtido de ESTA hoja.
      y = dibujarSurtido(pagina, hoja, paresHoja, y, normal, negrita, anchoTallas, medirTallas);

      // La tabla.
      y = encabezado(pagina, y, negrita);
      hoja.paquetes.forEach((p, iPaquete) => {
        y = dibujarPaquete(pagina, p, iPaquete, y, normal, negrita);
      });
    });
  });

  return doc.save();
}

function recorta(t: string, ancho: number, size: number, f: PDFFont): string {
  let s = t;
  while (s.length > 1 && f.widthOfTextAtSize(s, size) > ancho - 4) s = s.slice(0, -1);
  return s === t ? t : s.slice(0, -1) + "…";
}

function dibujarSurtido(
  pagina: PDFPage,
  hoja: Hoja<PaqueteNumerado>,
  paresHoja: number,
  y: number,
  normal: PDFFont,
  negrita: PDFFont,
  anchoTallas: number,
  medir: (t: string) => number,
): number {
  const renglones = hoja.surtido.map((l) => ({
    etiqueta: `${l.modelo} ${l.color}`.trim(),
    pares: l.pares,
    textos: renglonesDeTallas(l.tallas, anchoTallas, medir),
  }));
  const nRenglones = renglones.reduce((n, r) => n + Math.max(1, r.textos.length), 0);
  const alto = SURTIDO_TITULO + nRenglones * SURTIDO_RENGLON + 2 * SURTIDO_MARGEN;
  pagina.drawRectangle({ x: M - 2, y: y - alto + 10, width: ANCHO + 4, height: alto, color: fondoSurtido, borderColor: negro, borderWidth: 1 });
  let yy = y - SURTIDO_MARGEN - 4;
  pagina.drawText(`SURTIR PARA ESTA HOJA  ·  ${paresHoja} ${paresHoja === 1 ? "par" : "pares"}  ·  ${hoja.paquetes.length} ${hoja.paquetes.length === 1 ? "paquete" : "paquetes"}`, { x: M + SURTIDO_MARGEN, y: yy, size: 9, font: negrita, color: gris });
  yy -= SURTIDO_TITULO;
  for (const r of renglones) {
    pagina.drawText(recorta(r.etiqueta, SURTIDO_ETIQUETA, 10, negrita), { x: M + SURTIDO_MARGEN, y: yy, size: 10, font: negrita });
    const textos = r.textos.length ? r.textos : ["—"];
    textos.forEach((t, i) => {
      pagina.drawText(t, { x: M + SURTIDO_MARGEN + SURTIDO_ETIQUETA, y: yy, size: 10, font: negrita });
      if (i === 0) {
        const total = `= ${r.pares}`;
        pagina.drawText(total, { x: M + ANCHO - SURTIDO_MARGEN - normal.widthOfTextAtSize(total, 9), y: yy, size: 9, font: normal, color: gris });
      }
      yy -= SURTIDO_RENGLON;
    });
  }
  return y - alto - SURTIDO_HUECO + 10;
}

function encabezado(pagina: PDFPage, y: number, negrita: PDFFont): number {
  const titulos = ["#", "Pedido", "SKU", "Cant.", "Destinatario", ""];
  titulos.forEach((t, i) => {
    const x = i === 3 ? XS[i] + (COL[i] - negrita.widthOfTextAtSize(t, 8)) / 2 : XS[i] + 2;
    pagina.drawText(t, { x, y, size: 8, font: negrita, color: gris });
  });
  y -= 4;
  pagina.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.8, color: linea });
  return y - FILA;
}

function dibujarPaquete(pagina: PDFPage, p: PaqueteNumerado, iPaquete: number, y: number, normal: PDFFont, negrita: PDFFont): number {
  // Un renglón por SKU del paquete, ya en orden modelo → color → talla.
  const renglones = p.pares.length ? p.pares : [{ sku: "(sin renglones)", pares: 0 }];
  const paresPaquete = renglones.reduce((a, r) => a + r.pares, 0);
  const yArribaPaquete = y + FILA - 3;
  const varios = renglones.length > 1;

  // Fondo intercalado POR PAQUETE: todos los renglones de la misma caja
  // comparten el tono, para que el recuadro y la franja digan lo mismo.
  if (iPaquete % 2 === 0) {
    pagina.drawRectangle({
      x: M - 2,
      y: y - FILA * (renglones.length - 1) - 3,
      width: ANCHO + 4,
      height: FILA * renglones.length,
      color: fondoGris,
    });
  }

  renglones.forEach((r, i) => {
    const base = y + 4;
    if (i === 0) {
      pagina.drawText(`#${p.numero}`, { x: XS[0] + 2, y: base, size: 10, font: negrita });
      pagina.drawText(p.orderId, { x: XS[1] + 2, y: base, size: 8, font: normal, color: gris });
    }
    pagina.drawText(recorta(r.sku, COL[2], 9.5, negrita), { x: XS[2] + 2, y: base, size: 9.5, font: negrita });
    // La cantidad: la de más de un par va en un recuadro sombreado.
    const cant = String(r.pares);
    if (r.pares > 1) {
      pagina.drawRectangle({
        x: XS[3] + 3,
        y: y + 0.5,
        width: COL[3] - 6,
        height: FILA - 2,
        color: sombraCant,
        borderColor: negro,
        borderWidth: 0.8,
      });
    }
    pagina.drawText(cant, { x: XS[3] + (COL[3] - negrita.widthOfTextAtSize(cant, 10)) / 2, y: base, size: 10, font: negrita });
    if (i === 0) {
      pagina.drawText(recorta(p.destinatario ?? "", COL[4], 7.5, normal), { x: XS[4] + 2, y: base, size: 7.5, font: normal, color: gris });
      pagina.drawRectangle({ x: XS[5] + 3, y: y + 1, width: 11, height: 11, borderColor: negro, borderWidth: 0.8, color: rgb(1, 1, 1) });
    }
    if (varios && i < renglones.length - 1) {
      pagina.drawLine({ start: { x: M + COL[0], y: y - 1 }, end: { x: M + ANCHO, y: y - 1 }, thickness: 0.3, color: linea });
    }
    y -= FILA;
  });

  // Un paquete con varios renglones va dentro de un recuadro negro con
  // su total: todo lo de adentro se empaca junto, en la misma caja.
  if (varios) {
    pagina.drawRectangle({
      x: M - 2,
      y: y + FILA - 3,
      width: ANCHO + 4,
      height: yArribaPaquete - (y + FILA - 3),
      borderColor: negro,
      borderWidth: 1.2,
    });
    pagina.drawText(`${paresPaquete} pares en la misma caja`, { x: XS[4] + 2, y: y + FILA + 4, size: 7, font: normal, color: gris });
  }
  return y;
}
