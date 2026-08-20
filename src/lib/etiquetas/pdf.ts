/**
 * Etiquetas en PDF con el mismo acomodo que el PDF de "Etiquetas de
 * producto" de Mercado Libre: página de 2 × 1 pulgadas por etiqueta, código
 * de barras Code 128 arriba, el código en negritas al centro, título en dos
 * líneas, variante y SKU abajo. Una página por copia, igual que MELI.
 *
 * Las posiciones vienen de traducir el ZPL de MELI (203 puntos por pulgada)
 * a puntos de PDF (72 por pulgada): x_pt = x_zpl × 72 ÷ 203.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { codificar128 } from "./code128";
import type { EtiquetaResuelta } from "./resolver";
import { varianteMeli } from "./zpl";

const ANCHO = 144; // 2 in
const ALTO = 72; // 1 in
const D = 72 / 203; // dots ZPL → puntos PDF

/** WinAnsi no sabe de todos los caracteres; lo raro se vuelve espacio. */
function seguro(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[^\x20-\x7EáéíóúÁÉÍÓÚñÑüÜ°ªº¿¡]/g, " ").trim();
}

function recortar(texto: string, font: PDFFont, tamano: number, maxAncho: number): string {
  let t = texto;
  while (t.length > 1 && font.widthOfTextAtSize(t, tamano) > maxAncho) {
    t = t.slice(0, -1);
  }
  return t;
}

/** Parte el título en hasta 2 líneas que quepan, como el ^FB300,2 del ZPL. */
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
  if (lineas.length === 2) lineas[1] = recortar(lineas[1], font, tamano, maxAncho);
  return lineas.slice(0, 2);
}

function dibujarCodigoBarras(
  page: PDFPage,
  texto: string,
  x: number,
  yTope: number,
  alto: number,
): void {
  const barras = codificar128(texto);
  const modulo = 2 * D; // ^BY2
  let cursor = x;
  let esBarra = true;
  for (const a of barras.anchos) {
    const ancho = a * modulo;
    if (esBarra) {
      page.drawRectangle({
        x: cursor,
        y: ALTO - yTope - alto,
        width: ancho,
        height: alto,
        color: rgb(0, 0, 0),
      });
    }
    cursor += ancho;
    esBarra = !esBarra;
  }
}

export async function generarPdfEtiquetas(etiquetas: EtiquetaResuelta[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const e of etiquetas) {
    if (!e.codigoFull || e.cantidad <= 0) continue;
    const codigo = seguro(e.codigoFull);
    const titulo = seguro(e.titulo ?? e.sku);
    const variante = seguro(varianteMeli(e.color, e.talla));

    for (let copia = 0; copia < e.cantidad; copia++) {
      const page = doc.addPage([ANCHO, ALTO]);

      // Código de barras: ^FO25,15 alto 55 dots.
      dibujarCodigoBarras(page, codigo, 25 * D, 15 * D, 55 * D);

      // El código en texto, negritas (~^FT110,98 tamaño 22 dots).
      const tCodigo = 22 * D * 0.95;
      page.drawText(codigo, {
        x: 110 * D,
        y: ALTO - 98 * D,
        size: tCodigo,
        font: negrita,
      });

      // Título en hasta dos líneas (^FO22,115, caja de 300 dots, 18 dots).
      const tTexto = 18 * D * 0.95;
      const maxAncho = 300 * D;
      const lineas = dosLineas(titulo, normal, tTexto, maxAncho);
      lineas.forEach((l, i) => {
        page.drawText(l, {
          x: 22 * D,
          y: ALTO - (115 + 18 * (i + 1)) * D + 3 * D,
          size: tTexto,
          font: normal,
        });
      });

      // Variante en seminegrita (doble trazo en el ZPL) y el SKU.
      if (variante) {
        page.drawText(recortar(variante, negrita, tTexto, maxAncho), {
          x: 22 * D,
          y: ALTO - 153 * D - tTexto + 3 * D,
          size: tTexto,
          font: negrita,
        });
      }
      page.drawText(recortar(`SKU: ${seguro(e.sku)}`, normal, tTexto, maxAncho), {
        x: 22 * D,
        y: ALTO - 175 * D - tTexto + 3 * D,
        size: tTexto,
        font: normal,
      });
    }
  }

  return doc.save();
}
