/**
 * Etiquetas en ZPL, calcadas del formato que Mercado Libre genera en
 * "Etiquetas de producto": código de barras Code 128 del código Full, el
 * código en texto (doble trazo = negrita), título en dos líneas, variante y
 * el SKU. Un bloque ^XA…^XZ por producto, con ^PQ para las copias, listo
 * para mandarse tal cual a una impresora térmica de 2 × 1 pulgadas.
 */
import type { EtiquetaResuelta } from "./resolver";

/**
 * ^FH usa `_` como marca de hexadecimal: un guion se escribe _2D y un
 * guion bajo _5F, igual que en los archivos de MELI. Lo demás va tal cual
 * (^CI28 pone la impresora en UTF-8, los acentos pasan derecho).
 */
function escaparFH(texto: string): string {
  return texto.replace(/_/g, "_5F").replace(/-/g, "_2D").replace(/[\^~]/g, " ");
}

function limpiar(texto: string): string {
  return texto.replace(/[\^~]/g, " ").trim();
}

/** "Azul marino - 27 MX", como lo escribe MELI en su etiqueta. */
export function varianteMeli(color: string | null, talla: string | null): string {
  const p: string[] = [];
  if (color) p.push(limpiar(color));
  if (talla) p.push(`${talla} MX`);
  return p.join(" - ");
}

export function generarZpl(etiquetas: EtiquetaResuelta[]): string {
  const bloques: string[] = [];

  for (const e of etiquetas) {
    if (!e.codigoFull || e.cantidad <= 0) continue;
    const codigo = limpiar(e.codigoFull);
    const titulo = limpiar(e.titulo ?? e.sku);
    const variante = varianteMeli(e.color, e.talla);

    bloques.push(
      [
        "^XA",
        "^CI28",
        "^LH0,0",
        `^FO25,15^BY2,,0^BCN,55,N,N^FD${codigo}^FS`,
        `^FT110,98^A0N,22,22^FH^FD${codigo}^FS`,
        `^FT109,98^A0N,22,22^FH^FD${codigo}^FS`,
        `^FO22,115^A0N,18,18^FB300,2,0,L^FH^FD${titulo}^FS`,
        `^FO22,153^A0N,18,18^FB300,1,0,L^FH^FD${variante}^FS`,
        `^FO21,153^A0N,18,18^FB300,1,0,L^FH^FD${variante}^FS`,
        `^FO22,175^A0N,18,18^FH^FDSKU: ${escaparFH(e.sku)}^FS`,
        `^FO22,175^A0N,18,18^FH^FD^FS`,
        `^PQ${e.cantidad},0,1,Y^XZ`,
      ].join("\n"),
    );
  }

  return bloques.join("\n") + "\n";
}
