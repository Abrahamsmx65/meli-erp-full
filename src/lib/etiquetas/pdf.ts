/**
 * Etiquetas en PDF calcadas del archivo "Etiquetas de producto" que genera
 * Mercado Libre: hoja A4 con una cuadrícula de 24 etiquetas (4 columnas × 6
 * filas). Cada etiqueta lleva marco fino, código de barras Code 128, el
 * código en negritas centrado, título en dos líneas, variante y SKU.
 *
 * Todas las medidas vienen de diseccionar un PDF real de MELI
 * (EtiquetasdeproductoXUGQ45431.pdf): posiciones de columnas y filas, tamaño
 * de caja, posición y tamaño del código de barras y de cada línea de texto.
 * MELI usa ProximaNova; aquí va Helvetica, que es la métrica estándar más
 * parecida que un PDF puede llevar sin incrustar la fuente original.
 *
 * La etiqueta de Amazon (FNSKU) usa exactamente la misma cuadrícula: solo
 * cambia qué código va en las barras y el pie ("Nuevo" en vez del SKU).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { codificar128 } from "./code128";
import type { EtiquetaResuelta } from "./resolver";
import { varianteMeli, type DatosEtiqueta } from "./zpl";

export type { DatosEtiqueta } from "./zpl";

/* ---- Geometría medida del PDF de MELI (puntos, origen abajo-izquierda) --- */

const PAGINA: [number, number] = [595.2756, 841.8898]; // A4
const COLUMNAS_X = [35.1496, 163.7575, 292.3654, 420.9732];
const FILAS_Y = [759.9685, 677.0, 594.0315, 511.063, 428.0945, 345.126];
const CAJA_ANCHO = 113.9528;
const CAJA_ALTO = 71.0079;
const MARCO = 0.2835; // grosor del marco (doble rectángulo con relleno par-impar)

const BARRAS_X = 14.4567; // desde el borde izquierdo de la caja
const BARRAS_Y = 40.9606; // desde el borde inferior de la caja
const BARRAS_ANCHO = 85.0394;
const BARRAS_ALTO = 25.5118;

const CODIGO_Y = 33.1033; // línea base del código, centrado, negritas 7 pt
const TAM_CODIGO = 7;

const TEXTO_X = 5.9528; // sangría de título, variante y SKU
const TITULO_Y1 = 26.6671;
const TITULO_Y2 = 20.7143;
const VARIANTE_Y = 14.7615;
const PIE_Y = 8.8088;
const TAM_TEXTO = 5.4;
// La zona de recorte de MELI termina en x = 108.0 de la caja; el texto
// arranca en 5.9528, así que esto es lo máximo que puede medir una línea.
const MAX_ANCHO_TEXTO = 102.047;

export const ETIQUETAS_POR_HOJA = COLUMNAS_X.length * FILAS_Y.length;

interface Fuentes {
  normal: PDFFont;
  negrita: PDFFont;
}

/** WinAnsi no sabe de todos los caracteres; lo raro se vuelve espacio. */
function seguro(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[^\x20-\x7EáéíóúÁÉÍÓÚñÑüÜ°ªº¿¡]/g, " ").replace(/\s+/g, " ").trim();
}

function recortar(texto: string, font: PDFFont, tamano: number, maxAncho: number): string {
  let t = texto;
  while (t.length > 1 && font.widthOfTextAtSize(t, tamano) > maxAncho) {
    t = t.slice(0, -1);
  }
  return t;
}

/** Parte el título en hasta 2 líneas que quepan, como hace MELI. */
function dosLineas(texto: string, font: PDFFont, tamano: number, maxAncho: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    const intento = actual ? `${actual} ${p}` : p;
    if (font.widthOfTextAtSize(intento, tamano) <= maxAncho) {
      actual = intento;
    } else {
      if (actual) lineas.push(actual);
      actual = p;
      if (lineas.length === 2) break;
    }
  }
  if (actual && lineas.length < 2) lineas.push(actual);
  return lineas.slice(0, 2).map((l) => recortar(l, font, tamano, maxAncho));
}

/**
 * El código de barras como rectángulos de vector, estirado exactamente al
 * ancho pedido: así cualquier código, largo o corto, ocupa el mismo espacio
 * que en los archivos originales de MELI y Amazon.
 */
function dibujarBarras(
  page: PDFPage,
  texto: string,
  x: number,
  y: number,
  anchoTotal: number,
  alto: number,
): void {
  const barras = codificar128(texto);
  const modulo = anchoTotal / barras.modulos;
  let cursor = x;
  let esBarra = true;
  for (const a of barras.anchos) {
    const ancho = a * modulo;
    if (esBarra) {
      page.drawRectangle({
        x: cursor,
        y,
        width: ancho,
        height: alto,
        color: rgb(0, 0, 0),
      });
    }
    cursor += ancho;
    esBarra = !esBarra;
  }
}

/** Una etiqueta en la posición (columna, fila) de la hoja. */
function dibujarEtiqueta(
  page: PDFPage,
  fuentes: Fuentes,
  columna: number,
  fila: number,
  d: DatosEtiqueta,
): void {
  const bx = COLUMNAS_X[columna];
  const by = FILAS_Y[fila];

  // Marco fino: MELI lo pinta como dos rectángulos con relleno par-impar;
  // un trazo del mismo grosor centrado en el mismo contorno se ve idéntico.
  page.drawRectangle({
    x: bx + MARCO / 2,
    y: by + MARCO / 2,
    width: CAJA_ANCHO - MARCO,
    height: CAJA_ALTO - MARCO,
    borderWidth: MARCO,
    borderColor: rgb(0, 0, 0),
  });

  const codigo = seguro(d.codigo);
  dibujarBarras(page, codigo, bx + BARRAS_X, by + BARRAS_Y, BARRAS_ANCHO, BARRAS_ALTO);

  const anchoCodigo = fuentes.negrita.widthOfTextAtSize(codigo, TAM_CODIGO);
  page.drawText(codigo, {
    x: bx + (CAJA_ANCHO - anchoCodigo) / 2,
    y: by + CODIGO_Y,
    size: TAM_CODIGO,
    font: fuentes.negrita,
  });

  const lineas = dosLineas(seguro(d.titulo), fuentes.normal, TAM_TEXTO, MAX_ANCHO_TEXTO);
  const ysTitulo = [TITULO_Y1, TITULO_Y2];
  lineas.forEach((l, i) => {
    page.drawText(l, {
      x: bx + TEXTO_X,
      y: by + ysTitulo[i],
      size: TAM_TEXTO,
      font: fuentes.normal,
    });
  });

  const variante = seguro(d.variante);
  if (variante) {
    page.drawText(recortar(variante, fuentes.normal, TAM_TEXTO, MAX_ANCHO_TEXTO), {
      x: bx + TEXTO_X,
      y: by + VARIANTE_Y,
      size: TAM_TEXTO,
      font: fuentes.normal,
    });
  }

  const pie = seguro(d.pie);
  if (pie) {
    page.drawText(recortar(pie, fuentes.normal, TAM_TEXTO, MAX_ANCHO_TEXTO), {
      x: bx + TEXTO_X,
      y: by + PIE_Y,
      size: TAM_TEXTO,
      font: fuentes.normal,
    });
  }
}

async function fuentesDe(doc: PDFDocument): Promise<Fuentes> {
  return {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

/**
 * El PDF completo: hojas A4 que se van llenando de izquierda a derecha y de
 * arriba a abajo, 24 etiquetas por hoja, cada una repetida su cantidad.
 */
export async function generarPdfDatos(datos: DatosEtiqueta[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fuentes = await fuentesDe(doc);

  let page: PDFPage | null = null;
  let lugar = 0;

  for (const d of datos) {
    if (!d.codigo || d.cantidad <= 0) continue;
    for (let copia = 0; copia < d.cantidad; copia++) {
      if (!page || lugar === ETIQUETAS_POR_HOJA) {
        page = doc.addPage(PAGINA);
        lugar = 0;
      }
      const fila = Math.floor(lugar / COLUMNAS_X.length);
      const columna = lugar % COLUMNAS_X.length;
      dibujarEtiqueta(page, fuentes, columna, fila, d);
      lugar++;
    }
  }

  if (!page) doc.addPage(PAGINA);
  return doc.save();
}

/** Etiquetas de MELI: código Full en las barras, SKU al pie. */
export function datosMeli(e: EtiquetaResuelta): DatosEtiqueta {
  return {
    codigo: e.codigoFull ?? "",
    titulo: e.titulo ?? e.sku,
    variante: varianteMeli(e.color, e.talla),
    pie: `SKU: ${e.sku}`,
    cantidad: e.cantidad,
  };
}

/** El PDF de la pantalla de etiquetas, formato MELI (hoja A4, 24 por hoja). */
export async function generarPdfEtiquetas(etiquetas: EtiquetaResuelta[]): Promise<Uint8Array> {
  return generarPdfDatos(etiquetas.filter((e) => e.codigoFull).map(datosMeli));
}

/* ========================================================================== */
/* Etiquetas de 2 × 1 pulgadas, una por página: el formato que se comparte   */
/* con la fábrica en China. Medidas calcadas de un paquete real              */
/* (IN10128_GT125.zip): la página de MELI es su ZPL rendereado a 72/203 y la */
/* de Amazon es la etiqueta térmica que genera Amazon.                       */
/* ========================================================================== */

const PAGINA_2X1: [number, number] = [144, 72];

/** Página con la etiqueta de MELI, idéntica a la del archivo de la fábrica. */
export function paginaMeli2x1(doc: PDFDocument, fuentes: Fuentes, d: DatosEtiqueta): void {
  const page = doc.addPage(PAGINA_2X1);
  const codigo = seguro(d.codigo);

  // Código de barras: ^FO25,15 ^BY2 ^BCN,55 traducido a puntos.
  dibujarBarras(page, codigo, 8.9202, 47.2256, (codificar128(codigo).modulos * 2 * 72) / 203, 19.401);

  // El código en "negritas" de impresora térmica: doble trazo corrido un dot.
  const tCodigo = 7.803;
  for (const x of [39.0148, 38.6601]) {
    page.drawText(codigo, { x, y: 37.2414, size: tCodigo, font: fuentes.normal });
  }

  const tTexto = 6.3842;
  const maxAncho = (300 * 72) / 203; // ^FB300
  const lineas = dosLineas(seguro(d.titulo.slice(0, 60)), fuentes.normal, tTexto, maxAncho);
  const ysTitulo = [26.601, 20.2167];
  lineas.forEach((l, i) => {
    page.drawText(l, { x: 7.803, y: ysTitulo[i], size: tTexto, font: fuentes.normal });
  });

  const variante = seguro(d.variante);
  if (variante) {
    const v = recortar(variante, fuentes.normal, tTexto, maxAncho);
    for (const x of [7.803, 7.4483]) {
      page.drawText(v, { x, y: 13.1232, size: tTexto, font: fuentes.normal });
    }
  }

  page.drawText(recortar(seguro(d.pie), fuentes.normal, tTexto, maxAncho), {
    x: 7.803,
    y: 5.3202,
    size: tTexto,
    font: fuentes.normal,
  });
}

export interface DatosAmazon2x1 {
  fnsku: string;
  titulo: string;
  sku: string;
}

/**
 * Página con la etiqueta de Amazon, traducción exacta de su plantilla ZPL:
 * barras del FNSKU (^FO40,10 ^BCN,65), el FNSKU centrado (^FO70,85 ^FB220,C),
 * "NEW - título" en dos líneas (^FO30,115 ^FB300,2,10) y el SKU de Amazon
 * (^FO30,180).
 */
export function paginaAmazon2x1(doc: PDFDocument, fuentes: Fuentes, d: DatosAmazon2x1): void {
  const page = doc.addPage(PAGINA_2X1);
  const D = 72 / 203; // dots ZPL → puntos PDF
  const fnsku = seguro(d.fnsku);

  // ^FO40,10 ^BY2 ^BCN,65: módulo de 2 dots, 65 dots de alto.
  dibujarBarras(
    page,
    fnsku,
    40 * D,
    72 - (10 + 65) * D,
    codificar128(fnsku).modulos * 2 * D,
    65 * D,
  );

  // ^FO70,85 ^A0N,24,24 ^FB220,1,0,C: centrado dentro del bloque de 220 dots.
  const tFnsku = 24 * D;
  const anchoFnsku = fuentes.normal.widthOfTextAtSize(fnsku, tFnsku);
  page.drawText(fnsku, {
    x: (70 + 110) * D - anchoFnsku / 2,
    y: 72 - (85 + 24 * 0.722) * D,
    size: tFnsku,
    font: fuentes.normal,
  });

  // ^FO30,115 ^A0N,18,18 ^FB300,2,10: dos líneas con 10 dots extra de paso.
  const tTitulo = 18 * D;
  const maxAncho = 300 * D;
  const titulo = seguro(`NEW - ${d.titulo.slice(0, 55)}`);
  const lineas = dosLineas(titulo, fuentes.normal, tTitulo, maxAncho);
  lineas.forEach((l, i) => {
    page.drawText(l, {
      x: 30 * D,
      y: 72 - (115 + 18 * 0.722 + i * 28) * D,
      size: tTitulo,
      font: fuentes.normal,
    });
  });

  // ^FO30,180 ^A0N,16,16: el SKU de Amazon.
  const tSku = 16 * D;
  page.drawText(recortar(seguro(`SKU: ${d.sku}`), fuentes.normal, tSku, maxAncho), {
    x: 30 * D,
    y: 72 - (180 + 16 * 0.722) * D,
    size: tSku,
    font: fuentes.normal,
  });
}

/** Los datos de Amazon de una etiqueta resuelta, con sus respaldos. */
export function amazonDe(e: EtiquetaResuelta): DatosAmazon2x1 | null {
  if (!e.fnsku) return null;
  return {
    fnsku: e.fnsku,
    titulo: e.tituloAmazon ?? e.titulo ?? e.sku,
    sku: e.skuAmazon ?? e.sku,
  };
}

/**
 * El PDF de Amazon de la pantalla de etiquetas: una etiqueta de 2 × 1 por
 * página (el formato de Amazon), repetida su cantidad.
 */
export async function generarPdfAmazon(etiquetas: EtiquetaResuelta[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fuentes = await fuentesDe(doc);
  for (const e of etiquetas) {
    const d = amazonDe(e);
    if (!d || e.cantidad <= 0) continue;
    for (let copia = 0; copia < e.cantidad; copia++) paginaAmazon2x1(doc, fuentes, d);
  }
  if (!doc.getPageCount()) doc.addPage(PAGINA_2X1);
  return doc.save();
}

/**
 * El PDF de una variante para la fábrica: la etiqueta de Amazon y la de
 * MELI, una por página y del mismo tamaño (2 × 1), en ese orden — igual que
 * los "…, 2 LABEL.pdf" que ya se comparten con China.
 */
export async function generarPdf2Etiquetas(
  amazon: DatosAmazon2x1 | null,
  meli: DatosEtiqueta | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fuentes = await fuentesDe(doc);
  if (amazon) paginaAmazon2x1(doc, fuentes, amazon);
  if (meli) paginaMeli2x1(doc, fuentes, meli);
  if (!doc.getPageCount()) doc.addPage(PAGINA_2X1);
  return doc.save();
}

/**
 * La etiqueta de caja (BOX LABEL): 10 × 5 cm por página, con el código de
 * barras del texto "PEDIDO-MODELO-COLOR" y el texto abajo en negritas,
 * centrados — una página por color, todas en un solo PDF, igual que el
 * "IN10128 - BOX LABEL.pdf" del paquete real.
 */
export async function generarPdfCarton(textos: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const ancho = 282.96;
  const alto = 142.08;

  for (const texto of textos) {
    const page = doc.addPage([ancho, alto]);
    const limpio = seguro(texto);

    const anchoBarras = 249;
    dibujarBarras(page, limpio, (ancho - anchoBarras) / 2, 50.58, anchoBarras, 68.25);

    let tamano = 13.5;
    while (tamano > 7 && negrita.widthOfTextAtSize(limpio, tamano) > ancho - 24) {
      tamano -= 0.5;
    }
    page.drawText(limpio, {
      x: (ancho - negrita.widthOfTextAtSize(limpio, tamano)) / 2,
      y: 27.33,
      size: tamano,
      font: negrita,
    });
  }

  if (!doc.getPageCount()) doc.addPage([ancho, alto]);
  return doc.save();
}
