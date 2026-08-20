/**
 * Etiquetas en ZPL, calcadas del formato que Mercado Libre genera en
 * "Etiquetas de producto": código de barras Code 128 del código Full, el
 * código en texto (doble trazo = negrita), título en dos líneas, variante y
 * el SKU. Un bloque ^XA…^XZ por producto, con ^PQ para las copias, listo
 * para mandarse tal cual a una impresora térmica de 2 × 1 pulgadas.
 *
 * La etiqueta de Amazon (FNSKU) usa la misma plantilla: solo cambian el
 * código de las barras y el pie ("Nuevo" en vez del SKU).
 */
import type { EtiquetaResuelta } from "./resolver";

/** Lo que necesita una etiqueta, ya independiente de si es MELI o Amazon. */
export interface DatosEtiqueta {
  /** Lo que va en las barras y en negritas: código Full o FNSKU. */
  codigo: string;
  titulo: string;
  variante: string;
  /** Último renglón: "SKU: …" en MELI, "Nuevo" en Amazon. */
  pie: string;
  cantidad: number;
}

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

export function generarZplDatos(datos: DatosEtiqueta[]): string {
  const bloques: string[] = [];

  for (const d of datos) {
    if (!d.codigo || d.cantidad <= 0) continue;
    const codigo = limpiar(d.codigo);
    const titulo = limpiar(d.titulo);
    const variante = limpiar(d.variante);

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
        `^FO22,175^A0N,18,18^FH^FD${escaparFH(limpiar(d.pie))}^FS`,
        `^PQ${d.cantidad},0,1,Y^XZ`,
      ].join("\n"),
    );
  }

  return bloques.join("\n") + "\n";
}

export function generarZpl(etiquetas: EtiquetaResuelta[]): string {
  return generarZplDatos(
    etiquetas
      .filter((e) => e.codigoFull)
      .map((e) => ({
        codigo: e.codigoFull!,
        titulo: (e.titulo ?? e.sku).slice(0, 60),
        variante: varianteMeli(e.color, e.talla),
        pie: `SKU: ${e.sku}`,
        cantidad: e.cantidad,
      })),
  );
}

/**
 * El TXT como etiqueta de Amazon, con su PROPIO acomodo (no el de MELI):
 * barras del FNSKU arriba, el FNSKU centrado, "NEW - título de Amazon" en
 * dos líneas y el SKU de Amazon abajo. Es la plantilla que ya se usaba en
 * el generador viejo de etiquetas mixtas.
 */
export function generarZplAmazon(etiquetas: EtiquetaResuelta[]): string {
  const bloques: string[] = [];

  for (const e of etiquetas) {
    if (!e.fnsku || e.cantidad <= 0) continue;
    const fnsku = limpiar(e.fnsku);
    const titulo = limpiar(`NEW - ${(e.tituloAmazon ?? e.titulo ?? e.sku).slice(0, 55)}`);
    const sku = `SKU: ${escaparFH(limpiar(e.skuAmazon ?? e.sku))}`;

    bloques.push(
      [
        "^XA",
        "^CI28",
        "^LH0,0",
        `^FO40,10^BY2^BCN,65,N,N,N^FD${fnsku}^FS`,
        `^FO70,85^A0N,24,24^FB220,1,0,C^FH^FD${escaparFH(fnsku)}^FS`,
        `^FO30,115^A0N,18,18^FB300,2,10,L^FH^FD${escaparFH(titulo)}^FS`,
        `^FO30,180^A0N,16,16^FB300,1,0,L^FH^FD${sku}^FS`,
        `^PQ${e.cantidad},0,1,Y^XZ`,
      ].join("\n"),
    );
  }

  return bloques.join("\n") + "\n";
}
