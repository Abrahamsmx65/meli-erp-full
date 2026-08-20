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
 * ^FH usa `_` como marca de hexadecimal: el guion va como _2D y los acentos
 * como su UTF-8 en hex, exactamente el mismo encodeZPL del generador viejo
 * de etiquetas mixtas. El guion bajo se escapa a _5F por seguridad (es el
 * carácter de escape mismo).
 */
function escaparFH(texto: string): string {
  return texto
    .replace(/_/g, "_5F")
    .replace(/-/g, "_2D")
    .replace(/é/g, "_C3_A9")
    .replace(/á/g, "_C3_A1")
    .replace(/í/g, "_C3_AD")
    .replace(/ó/g, "_C3_B3")
    .replace(/ú/g, "_C3_BA")
    .replace(/ñ/g, "_C3_B1")
    .replace(/[\^~]/g, " ");
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
  let zpl = "";

  for (const d of datos) {
    if (!d.codigo || d.cantidad <= 0) continue;
    const codigo = limpiar(d.codigo);
    const titulo = escaparFH(limpiar(d.titulo));
    const variante = escaparFH(limpiar(d.variante));
    const pie = escaparFH(limpiar(d.pie));

    // Un bloque por copia con ^PQ1, tal cual lo arma el generador viejo.
    const bloque = `
^XA
^CI28
^LH0,0
^FO25,15^BY2,,0^BCN,55,N,N^FD${codigo}^FS
^FT110,98^A0N,22,22^FH^FD${codigo}^FS
^FT109,98^A0N,22,22^FH^FD${codigo}^FS
^FO22,115^A0N,18,18^FB300,2,0,L^FH^FD${titulo}^FS
^FO22,153^A0N,18,18^FB300,1,0,L^FH^FD${variante}^FS
^FO21,153^A0N,18,18^FB300,1,0,L^FH^FD${variante}^FS
^FO22,175^A0N,18,18^FH^FD${pie}^FS
^PQ1,0,1,Y
^XZ
`;
    for (let c = 0; c < d.cantidad; c++) zpl += bloque;
  }

  return zpl;
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
/**
 * El TXT con LAS DOS etiquetas de cada par, intercaladas: bloque de Amazon
 * y en seguida el de MELI, por cada copia. Así el rollo sale en pares y se
 * etiqueta el par completo de un jalón. Un par sin FNSKU sale solo con su
 * bloque de MELI, y al revés.
 */
export function generarZplAmbas(etiquetas: EtiquetaResuelta[]): string {
  let zpl = "";
  for (const e of etiquetas) {
    if (e.cantidad <= 0) continue;
    const unaVez = { ...e, cantidad: 1 };
    const amazon = e.fnsku ? generarZplAmazon([unaVez]) : "";
    const meli = e.codigoFull ? generarZpl([unaVez]) : "";
    for (let c = 0; c < e.cantidad; c++) zpl += amazon + meli;
  }
  return zpl;
}

export function generarZplAmazon(etiquetas: EtiquetaResuelta[]): string {
  let zpl = "";

  for (const e of etiquetas) {
    if (!e.fnsku || e.cantidad <= 0) continue;
    const fnsku = limpiar(e.fnsku);
    const titulo = escaparFH(limpiar(`NEW - ${(e.tituloAmazon ?? e.titulo ?? e.sku).slice(0, 55)}`));
    const sku = escaparFH(limpiar(`SKU: ${e.skuAmazon ?? e.sku}`));

    // La plantilla del generador viejo tal cual, con sus líneas en blanco.
    const bloque = `
^XA
^CI28
^LH0,0

^FO40,10^BY2
^BCN,65,N,N,N
^FD${fnsku}^FS

^FO70,85^A0N,24,24^FB220,1,0,C^FH^FD${escaparFH(fnsku)}^FS

^FO30,115^A0N,18,18^FB300,2,10,L^FH^FD${titulo}^FS

^FO30,180^A0N,16,16^FB300,1,0,L^FH^FD${sku}^FS

^PQ1,0,1,Y
^XZ
`;
    for (let c = 0; c < e.cantidad; c++) zpl += bloque;
  }

  return zpl;
}
