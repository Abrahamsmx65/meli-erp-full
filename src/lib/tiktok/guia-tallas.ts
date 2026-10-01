/**
 * La guía de tallas que se publica con cada producto de TikTok (pedido del
 * dueño, 30-sep-2026: «cada uno es 23 = 23 cm»). En el calzado de GETAC la
 * talla MX ES el largo de la plantilla en centímetros, así que la guía es
 * una tabla talla → cm con las tallas que lleva el producto. Puro: de aquí
 * sale el texto para la descripción y los renglones que se dibujan.
 */

export interface RenglonGuiaTallas {
  talla: string;
  cm: string;
}

function tallaNumerica(t: string): number {
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : 999;
}

/** Las tallas únicas del producto, ordenadas, con su largo: 23 → "23 cm", 23.5 → "23.5 cm". */
export function guiaDeTallas(tallas: string[]): RenglonGuiaTallas[] {
  const unicas = [...new Set(tallas.map((t) => String(t).trim()).filter((t) => tallaNumerica(t) !== 999))];
  return unicas
    .sort((a, b) => tallaNumerica(a) - tallaNumerica(b))
    .map((t) => ({ talla: t.replace(/\.0$/, ""), cm: `${String(tallaNumerica(t)).replace(/\.0$/, "")} cm` }));
}

/** El párrafo para la descripción: «Guía de tallas (largo de la plantilla): 23 = 23 cm · 24 = 24 cm …». */
export function textoGuiaTallas(renglones: RenglonGuiaTallas[]): string {
  if (!renglones.length) return "";
  return `Guía de tallas (largo de la plantilla): ${renglones.map((r) => `${r.talla} = ${r.cm}`).join(" · ")}`;
}
