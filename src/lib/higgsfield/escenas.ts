/**
 * Motor de escenas: qué video le queda a cada tipo de calzado.
 *
 * REGLA DE ORO: el producto no se altera. Los videos se generan DIRECTO de
 * las fotos reales de la publicación (nada de regenerar la imagen con IA:
 * eso redibujaba el producto y quedó prohibido). Los prompts solo piden
 * movimiento de cámara, luz y ambiente, y todos cierran con el candado de
 * fidelidad.
 *
 * El tipo se detecta del título/modelo, y cada tipo trae variantes de luz y
 * movimiento; el botón "Variar" tira el dado y arma otra combinación. Los
 * prompts van en inglés a propósito: los modelos generan mejor así.
 */

export type TipoCalzado =
  | "bota"
  | "bota_industrial"
  | "sandalia"
  | "sandalia_agua"
  | "pantufla"
  | "tenis"
  | "tacon"
  | "mocasin"
  | "zapato";

export type Genero = "mujer" | "hombre" | "nino" | null;

// ---------------------------------------------------------------------------
// Detección a partir del texto de la publicación
// ---------------------------------------------------------------------------

// El orden importa: "Pantufla de corcho" es pantufla, no sandalia; y una
// "sandalia acuática" es de agua antes que sandalia a secas.
const TIPOS: [TipoCalzado, RegExp][] = [
  ["pantufla", /\b(PANTUFLA|SLIPPER|PELUCHE)/i],
  // Industrial/hiking antes que bota: "bota industrial" es de trabajo.
  ["bota_industrial", /\b(INDUSTRIAL|CASQUILLO|DIELECTRIC|SEGURIDAD|HIKING|SENDERISMO|TREKKING|TACTIC|MONTA(Ñ|N)A)/i],
  ["bota", /\b(BOTA|BOTIN|BOTÍN|BOOT)/i],
  ["sandalia_agua", /\b(CHANCLA|FLIP|JELLY)|\b(SANDALIA|HUARACHE)\b.*\b(AGUA|ACUATIC|ACUÁTIC|PLAYA|ALBERCA|MAR|POOL)|\b(AGUA|ACUATIC|ACUÁTIC|PLAYA|ALBERCA|POOL)\b.*\b(SANDALIA|HUARACHE)/i],
  ["sandalia", /\b(SANDALIA|HUARACHE)/i],
  ["tenis", /\b(TENIS|SNEAKER|DEPORTIV|RUNNER|CASUAL SPORT)/i],
  ["tacon", /\b(TACON|TACÓN|ZAPATILLA|STILETTO|PUMP)/i],
  ["mocasin", /\b(MOCASIN|MOCASÍN|LOAFER|NAUTICO|NÁUTICO)/i],
];

export function detectarTipo(texto: string): TipoCalzado {
  for (const [tipo, patron] of TIPOS) {
    if (patron.test(texto)) return tipo;
  }
  return "zapato";
}

export function detectarGenero(texto: string): Genero {
  if (/\b(NIÑ|INFANTIL|KIDS|JOVEN)/i.test(texto)) return "nino";
  if (/\b(DAMA|MUJER|WOMEN|FEMENIL)/i.test(texto)) return "mujer";
  if (/\b(CABALLERO|HOMBRE|MEN\b|VARONIL)/i.test(texto)) return "hombre";
  return null;
}

// ---------------------------------------------------------------------------
// Guion del clip hablado
// ---------------------------------------------------------------------------

/** Cómo se llama el producto cuando la voz habla de él. */
export const PALABRA_TIPO: Record<TipoCalzado, { palabra: string; femenino: boolean }> = {
  bota: { palabra: "botas", femenino: true },
  bota_industrial: { palabra: "botas", femenino: true },
  sandalia: { palabra: "sandalias", femenino: true },
  sandalia_agua: { palabra: "sandalias", femenino: true },
  pantufla: { palabra: "pantuflas", femenino: true },
  tenis: { palabra: "tenis", femenino: false },
  tacon: { palabra: "tacones", femenino: false },
  mocasin: { palabra: "mocasines", femenino: false },
  zapato: { palabra: "zapatos", femenino: false },
};

/** Guion inicial en español para el clip hablado; el vendedor lo edita. */
export function guionInicial(tipo: TipoCalzado): string {
  const { palabra, femenino } = PALABRA_TIPO[tipo];
  const comodas = femenino ? "comodísimas" : "comodísimos";
  const estas = femenino ? "estas" : "estos";
  return `¡Tienen que ver ${estas} ${palabra}! Son ${comodas}, la calidad es increíble y combinan con todo. Córranle antes de que se acaben.`;
}

// ---------------------------------------------------------------------------
// Escenas (todas respetan el producto tal cual)
// ---------------------------------------------------------------------------

export interface Escena {
  id: string;
  etiqueta: string;
  descripcion: string;
}

export const ESCENAS: Escena[] = [
  {
    id: "escaparate",
    etiqueta: "Escaparate",
    descripcion: "La cámara rodea el producto despacio, estilo comercial premium.",
  },
  {
    id: "detalle",
    etiqueta: "Detalles",
    descripcion: "Acercamiento lento a materiales, costuras y suela.",
  },
  {
    id: "manos",
    etiqueta: "En manos",
    descripcion: "Unas manos toman el producto y lo presentan a cámara.",
  },
  {
    id: "vivo",
    etiqueta: "Foto viva",
    descripcion: "La foto cobra vida: luz que se mueve, fondo con aire, producto quieto.",
  },
];

/** El candado que cierra TODOS los prompts. */
const CANDADO =
  " STRICT RULE: the product must remain EXACTLY as shown in the input image — " +
  "same design, shape, colors, materials, textures and logos. Do not redesign, " +
  "replace, morph or restyle the product in any way.";

const LUCES: Record<TipoCalzado, string[]> = {
  bota: ["moody warm light with soft shadows", "golden hour glow", "dramatic side light"],
  bota_industrial: ["raw workshop light", "overcast outdoor daylight", "early morning jobsite light"],
  sandalia: ["bright airy summer light", "soft golden afternoon light", "fresh daylight"],
  sandalia_agua: ["sparkling summer light", "sunny poolside brightness", "fresh coastal light"],
  pantufla: ["warm cozy indoor light", "soft morning window light", "gentle lamp glow"],
  tenis: ["punchy studio light", "cool urban light", "clean bright light"],
  tacon: ["glamorous warm spotlights", "elegant cool evening light", "soft cinematic glow"],
  mocasin: ["refined soft daylight", "warm boutique light", "clean morning light"],
  zapato: ["natural daylight", "warm golden light", "soft studio light"],
};

const MOVIMIENTOS: Record<string, string[]> = {
  escaparate: [
    "slow elegant orbit around the product",
    "smooth semicircular dolly with a gentle rise",
    "slow rotating turntable feel, camera fixed",
  ],
  detalle: [
    "slow dolly-in toward the stitching and materials",
    "gentle macro glide along the profile ending on the sole",
    "slow push-in with a delicate focus pull",
  ],
  manos: [
    "a pair of well-groomed hands enters the frame, gently lifts the product and presents it to the camera turning it slightly",
    "hands pick up the product, bring it closer to the lens and tilt it to show the profile",
    "one hand points out the details while the other holds the product steady toward the camera",
  ],
  vivo: [
    "the light sweeps softly across the product while dust particles float in the air",
    "the background gains subtle life and depth of field shifts gently, product perfectly still",
    "a soft shadow of leaves moves over the scene while the camera drifts very slowly",
  ],
};

function elegir<T>(arr: T[], semilla: number, sal: number): T {
  // Determinista con la semilla: mismo dado, misma escena.
  const i = Math.abs(Math.floor(semilla * 7919 + sal * 104729)) % arr.length;
  return arr[i];
}

/**
 * Prompt de video para animar la foto REAL del producto. Solo cámara, luz y
 * ambiente; el candado de fidelidad va siempre al final.
 */
export function armarPromptProducto(datos: {
  tipo: TipoCalzado;
  escenaId: string;
  semilla: number;
}): string {
  const luz = elegir(LUCES[datos.tipo], datos.semilla, 2);
  const movimientos = MOVIMIENTOS[datos.escenaId] ?? MOVIMIENTOS.escaparate;
  const movimiento = elegir(movimientos, datos.semilla, 3);
  return (
    `Premium product commercial: ${movimiento}, ${luz}, subtle cinematic grade, ` +
    `the product always sharp and in focus.` + CANDADO
  );
}

/**
 * Prompt del clip hablado: la foto real se anima con movimiento suave y una
 * VOZ EN OFF en español presenta el producto. Nadie sale a cuadro y el
 * producto no se toca; Veo 3.1 genera la voz desde el propio prompt.
 */
export function armarPromptHablado(datos: {
  tipo: TipoCalzado;
  genero: Genero;
  semilla: number;
  guion: string;
}): string {
  const luz = elegir(LUCES[datos.tipo], datos.semilla, 2);
  const movimiento = elegir(MOVIMIENTOS.escaparate, datos.semilla, 3);
  const voz = datos.genero === "hombre" ? "male" : "female";
  const guion = datos.guion.trim().replace(/"/g, "'");
  return (
    `Product advertisement video: ${movimiento}, ${luz}, the product always sharp and in ` +
    `focus, while a warm enthusiastic ${voz} voice-over in Mexican Spanish says: "${guion}". ` +
    `Soft subtle background music under the voice.` + CANDADO
  );
}
