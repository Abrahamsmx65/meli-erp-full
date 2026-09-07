/**
 * Código de barras Code 128, subconjunto B.
 *
 * Es el que lee el escáner de Mercado Envíos Full sobre el código de
 * inventario (por ejemplo QPLW61342). Está escrito a mano en lugar de traer
 * una librería porque son cuarenta líneas de tabla, no cambia nunca, y una
 * etiqueta mal impresa se descubre hasta que el almacén rechaza la caja —
 * prefiero poder probarlo aquí mismo.
 *
 * Cómo funciona: cada carácter vale su ASCII menos 32. La secuencia es
 *
 *   [inicio B] [datos…] [dígito verificador] [fin]
 *
 * y el verificador es la suma de inicio + posición × valor, módulo 103. Cada
 * símbolo son seis anchos alternando barra/espacio, empezando en barra.
 */

/** Anchos de cada símbolo, del 0 al 106. El 106 (fin) trae siete. */
const PATRONES = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
];

const INICIO_B = 104;
const INICIO_C = 105;
const FIN = 106;

export interface Barras {
  /** anchos en módulos, alternando barra/espacio, empezando en barra */
  anchos: number[];
  /** ancho total en módulos */
  modulos: number;
  /** el dígito verificador que se calculó, útil para probar */
  verificador: number;
}

/**
 * Convierte un texto en la secuencia de anchos del código de barras.
 *
 * Solo acepta ASCII imprimible (del espacio al `~`): es lo que cubre el
 * subconjunto B, y los códigos de inventario de Mercado Libre caen de sobra
 * ahí. Un carácter fuera de rango es un error y no un carácter sustituido a
 * la fuerza, porque un código de barras que escanea distinto a lo impreso es
 * peor que ninguno.
 */
export function codificar128(texto: string): Barras {
  if (!texto) throw new Error("No hay nada que codificar.");

  // Puros dígitos en cantidad par (un número de pedido de TikTok, 18
  // dígitos): juego C, dos dígitos por símbolo, la mitad de ancho.
  if (/^\d+$/.test(texto) && texto.length % 2 === 0) {
    const pares: number[] = [];
    for (let i = 0; i < texto.length; i += 2) pares.push(Number(texto.slice(i, i + 2)));
    let suma = INICIO_C;
    pares.forEach((v, i) => {
      suma += v * (i + 1);
    });
    const verificador = suma % 103;
    const simbolos = [INICIO_C, ...pares, verificador, FIN];
    const anchos: number[] = [];
    for (const sym of simbolos) for (const d of PATRONES[sym]) anchos.push(Number(d));
    return { anchos, modulos: anchos.reduce((a, b) => a + b, 0), verificador };
  }

  const valores: number[] = [];
  for (const ch of texto) {
    const c = ch.codePointAt(0)!;
    if (c < 32 || c > 126) {
      throw new Error(`El carácter "${ch}" no se puede poner en un código de barras.`);
    }
    valores.push(c - 32);
  }

  let suma = INICIO_B;
  valores.forEach((v, i) => {
    suma += v * (i + 1);
  });
  const verificador = suma % 103;

  const simbolos = [INICIO_B, ...valores, verificador, FIN];
  const anchos: number[] = [];
  for (const s of simbolos) {
    for (const d of PATRONES[s]) anchos.push(Number(d));
  }

  return {
    anchos,
    modulos: anchos.reduce((a, b) => a + b, 0),
    verificador,
  };
}

/**
 * Dibuja el código como SVG.
 *
 * Se devuelve SVG y no una imagen porque la etiqueta se imprime: un vector
 * sale nítido en cualquier impresora, y un PNG a 96 dpi estirado a 4 cm sale
 * borroso justo en el lugar donde el escáner necesita filo.
 */
export function svg128(
  texto: string,
  opciones?: { alto?: number; modulo?: number; margen?: number },
): { svg: string; ancho: number; alto: number } {
  const alto = opciones?.alto ?? 60;
  const modulo = opciones?.modulo ?? 2;
  const margen = opciones?.margen ?? 10;

  const { anchos } = codificar128(texto);

  let x = margen;
  let esBarra = true;
  const rects: string[] = [];

  for (const a of anchos) {
    const ancho = a * modulo;
    if (esBarra) {
      rects.push(`<rect x="${x}" y="0" width="${ancho}" height="${alto}" fill="#000"/>`);
    }
    x += ancho;
    esBarra = !esBarra;
  }

  const ancho = x + margen;

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" shape-rendering="crispEdges" role="img" aria-label="Código ${texto}">${rects.join("")}</svg>`,
    ancho,
    alto,
  };
}
