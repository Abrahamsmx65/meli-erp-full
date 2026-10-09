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
import { loteDePaquete, type Lote } from "./lotes";

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
 * cabe en la hoja si el costo fijo de la hoja (cabecera, que depende de
 * qué hoja del modelo es, + bloque de surtido, que crece con los colores
 * que lleva) más lo que ocupan sus paquetes no pasa de `alto`. Si un paquete solo no cabe ni en una hoja
 * vacía, va de todos modos: mejor que se salga que perderlo.
 */
export function partirEnHojas<T extends ConPares>(
  paquetes: T[],
  alto: number,
  costoPaquete: (p: T) => number,
  costoFijo: (surtido: LineaSurtido[], indiceHoja: number) => number,
): Hoja<T>[] {
  const hojas: Hoja<T>[] = [];
  let actual: T[] = [];
  let ocupado = 0;
  for (const p of paquetes) {
    const candidato = [...actual, p];
    const surtido = surtidoDeHoja(candidato);
    // La cabecera de la primera hoja del modelo es más alta (título y, en
    // la primera del corte, su resumen): el costo fijo sabe qué hoja es.
    const total = costoFijo(surtido, hojas.length) + ocupado + costoPaquete(p);
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

/**
 * Lo que va en la hoja: un paquete normal, o un LOTE (muchos paquetes
 * iguales de un par) como UN solo bloque. `pares` lo lleva el bloque
 * completo, para que el surtido de la hoja cuente todos sus pares.
 */
export type ItemDeHoja<T extends ConPares> =
  | { tipo: "paquete"; paquete: T; pares: T["pares"] }
  | { tipo: "lote"; lote: Lote; paquetes: T[]; pares: { sku: string; pares: number }[] };

/**
 * Los paquetes de un grupo con sus lotes colapsados: los paquetes seguidos
 * de un mismo lote se vuelven un solo bloque; lo demás queda igual.
 */
export function itemsConLotes<T extends ConPares & { numero: number }>(paquetes: T[], lotes: Lote[]): ItemDeHoja<T>[] {
  const items: ItemDeHoja<T>[] = [];
  for (const p of paquetes) {
    const lote = loteDePaquete(lotes, p.numero);
    const ultimo = items[items.length - 1];
    if (lote && ultimo && ultimo.tipo === "lote" && ultimo.lote.desde === lote.desde) {
      ultimo.paquetes.push(p);
      ultimo.pares = [{ sku: lote.sku, pares: ultimo.paquetes.length }];
      continue;
    }
    if (lote) items.push({ tipo: "lote", lote, paquetes: [p], pares: [{ sku: lote.sku, pares: 1 }] });
    else items.push({ tipo: "paquete", paquete: p, pares: p.pares });
  }
  return items;
}
