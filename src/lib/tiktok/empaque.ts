/**
 * Hojas de la lista de EMPAQUE (decisión del dueño, 25-sep-2026): la lista
 * de surtido completa del corte no se usaba —«es demasiado junto sacar
 * todo lo que hay y nada más se hace más bolas»—, así que cada HOJA de la
 * lista de empaque trae arriba lo que hay que surtir PARA ESA HOJA (por
 * modelo y color, con sus tallas y pares), se surte eso y luego se empaca
 * la hoja completa. Y cada MODELO empieza en su propia hoja, aunque le
 * toquen varias, para que no se revuelva.
 *
 * Motor puro: decide qué paquetes caben en cada hoja y qué se surte en
 * ella. Cuánto mide cada cosa lo dice quien dibuja (pdf-lib), por eso los
 * costos entran como funciones.
 */
import { compararSku, partirSku, type ParDespacho } from "./despacho";

export interface TallaSurtido {
  talla: string;
  pares: number;
}

/** Un renglón del surtido de la hoja: un modelo + color con sus tallas. */
export interface LineaSurtido {
  modelo: string;
  color: string;
  tallas: TallaSurtido[];
  pares: number;
}

interface ConPares {
  pares: Pick<ParDespacho, "sku" | "pares">[];
}

/**
 * Lo que hay que surtir para empacar estos paquetes: pares por SKU,
 * agrupados por modelo + color en el orden de la bodega (modelo → color →
 * talla numérica). Un SKU que no tiene forma MODELO-COLOR-TALLA sale con
 * lo que tenga.
 */
export function surtidoDeHoja(paquetes: ConPares[]): LineaSurtido[] {
  const porSku = new Map<string, number>();
  for (const p of paquetes) {
    for (const r of p.pares) porSku.set(r.sku, (porSku.get(r.sku) ?? 0) + r.pares);
  }
  const skus = [...porSku.keys()].sort(compararSku);
  const lineas: LineaSurtido[] = [];
  for (const sku of skus) {
    const { modelo, color, talla } = partirSku(sku);
    const pares = porSku.get(sku) ?? 0;
    const ultima = lineas[lineas.length - 1];
    if (ultima && ultima.modelo === modelo && ultima.color === color) {
      ultima.tallas.push({ talla, pares });
      ultima.pares += pares;
    } else {
      lineas.push({ modelo, color, tallas: [{ talla, pares }], pares });
    }
  }
  return lineas;
}

export interface Hoja<T> {
  paquetes: T[];
  surtido: LineaSurtido[];
}

/**
 * Reparte los paquetes de UN modelo en hojas. Un paquete nunca se parte;
 * cabe en la hoja si el costo fijo de la hoja (cabecera + bloque de
 * surtido, que crece con los colores que lleva) más lo que ocupan sus
 * paquetes no pasa de `alto`. Si un paquete solo no cabe ni en una hoja
 * vacía, va de todos modos: mejor que se salga que perderlo.
 */
export function partirEnHojas<T extends ConPares>(
  paquetes: T[],
  alto: number,
  costoPaquete: (p: T) => number,
  costoFijo: (surtido: LineaSurtido[]) => number,
): Hoja<T>[] {
  const hojas: Hoja<T>[] = [];
  let actual: T[] = [];
  let ocupado = 0;
  for (const p of paquetes) {
    const candidato = [...actual, p];
    const surtido = surtidoDeHoja(candidato);
    const total = costoFijo(surtido) + ocupado + costoPaquete(p);
    if (actual.length && total > alto) {
      hojas.push({ paquetes: actual, surtido: surtidoDeHoja(actual) });
      actual = [p];
      ocupado = costoPaquete(p);
    } else {
      actual = candidato;
      ocupado += costoPaquete(p);
    }
  }
  if (actual.length) hojas.push({ paquetes: actual, surtido: surtidoDeHoja(actual) });
  return hojas;
}

/**
 * Cómo se escribe una línea del surtido: «23 ×8   24 ×5   27 ×20». Las
 * tallas que no quepan en el ancho pasan al renglón de abajo; `medir`
 * dice cuánto ocupa un texto y `ancho` cuánto hay.
 */
export function renglonesDeTallas(
  tallas: TallaSurtido[],
  ancho: number,
  medir: (texto: string) => number,
  separador = "   ",
): string[] {
  const renglones: string[] = [];
  let actual = "";
  for (const t of tallas) {
    const pieza = `${t.talla || "—"} ×${t.pares}`;
    const junto = actual ? actual + separador + pieza : pieza;
    if (actual && medir(junto) > ancho) {
      renglones.push(actual);
      actual = pieza;
    } else {
      actual = junto;
    }
  }
  if (actual) renglones.push(actual);
  return renglones;
}
