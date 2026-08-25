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

// ---------------------------------------------------------------------------
// UGC: una persona presenta el producto hablando a cámara
// ---------------------------------------------------------------------------

/**
 * Quién presenta. Para producto de niños presenta una mamá joven: personas
 * menores generadas por IA quedan fuera a propósito.
 */
function personaUGC(genero: Genero): string {
  if (genero === "hombre") {
    return "a friendly young Mexican man in his late 20s, casual everyday clothes";
  }
  if (genero === "nino") {
    return "a friendly young Mexican mom in her early 30s, casual everyday clothes";
  }
  return "a friendly young Mexican woman in her mid 20s, casual everyday clothes";
}

/**
 * Dónde graba la persona. Lugares COTIDIANOS y con vida — un video UGC se ve
 * grabado en casa o en la calle, no en un set.
 */
const ESCENARIOS_UGC: Record<TipoCalzado, string[]> = {
  bota: [
    "their apartment entryway with coats hanging behind",
    "a sidewalk outside their house on a cloudy day",
    "their bedroom with the closet door open behind them",
  ],
  sandalia: [
    "their sunny apartment balcony with plants",
    "their living room with a fan in the background",
    "the patio of their house",
  ],
  sandalia_agua: [
    "the edge of a community pool, towels in the background",
    "a beach on an overcast day, filmed casually",
    "their bathroom getting ready for the pool",
  ],
  pantufla: [
    "their slightly messy cozy bedroom",
    "their living room couch with blankets around",
    "their kitchen while making morning coffee",
  ],
  tenis: [
    "their bedroom with sneaker boxes visible behind",
    "a regular city sidewalk with parked cars",
    "the hallway mirror of their apartment",
  ],
  tacon: [
    "their bedroom mirror while getting ready to go out",
    "their apartment hallway, purse on the floor",
    "their closet trying on outfits",
  ],
  mocasin: [
    "their home office desk area",
    "the entrance of their apartment before leaving for work",
    "their living room, everyday clutter around",
  ],
  zapato: [
    "their living room, everyday clutter around",
    "their bedroom with the bed unmade behind",
    "the entryway of their house",
  ],
};

/**
 * Prompt de la IMAGEN del presentador (Soul, 9:16 con la foto real de
 * referencia). UGC de verdad: cuadro de video casero de celular — luz normal,
 * encuadre imperfecto, casa real — NUNCA foto de estudio ni anuncio.
 */
export function armarPromptPersonaUGC(datos: {
  tipo: TipoCalzado;
  genero: Genero;
  semilla: number;
}): string {
  const escenario = elegir(ESCENARIOS_UGC[datos.tipo], datos.semilla, 5);
  return (
    `Frame grab from a casual selfie video filmed on a phone front camera, vertical 9:16: ` +
    `${personaUGC(datos.genero)}, full body or three-quarter body visible, standing in ` +
    `${escenario}. Ordinary indoor lighting, slightly imperfect framing, mild phone-camera ` +
    `grain, real unretouched skin. Mid-sentence talking to the camera while holding up the ` +
    `featured footwear from the reference image with one hand, shoe clearly visible near ` +
    `chest height. It must look like a regular person's TikTok clip: amateur, spontaneous, ` +
    `relatable. NO studio lighting, NO advertising polish, NO cinematic look, NO posing.` +
    CANDADO
  );
}

/**
 * Prompt de la animación Speak (el audio pone las palabras; esto solo pide
 * el tono y los gestos del presentador). Vibra de video casero, no comercial.
 */
export function armarPromptSpeakUGC(datos: { tipo: TipoCalzado; semilla: number }): string {
  const escenario = elegir(ESCENARIOS_UGC[datos.tipo], datos.semilla, 5);
  return (
    `Casual selfie-style talking video filmed on a phone in ${escenario}: the person chats ` +
    `directly to the camera like recommending the shoes to a friend, spontaneous natural ` +
    `gestures, lifts the shoe up and turns it while talking, slight handheld shake, ` +
    `ordinary home lighting. Amateur TikTok energy — NOT an ad, NOT cinematic.` + CANDADO
  );
}

/**
 * Prompt del UGC hablado por IA: la persona de la imagen dice el guion en
 * español con lip sync y audio nativo. Mismo tono casero.
 */
export function armarPromptVozIAUGC(datos: {
  tipo: TipoCalzado;
  genero: Genero;
  semilla: number;
  guion: string;
}): string {
  const guion = datos.guion.trim().replace(/"/g, "'");
  return (
    `Casual selfie-style phone video, the person in the image talks directly to the camera ` +
    `in casual Mexican Spanish with accurate lip sync, like recommending the shoes to a ` +
    `friend, saying: "${guion}". Spontaneous gestures, lifts the shoe while talking, slight ` +
    `handheld shake, ordinary home lighting, natural room ambience. Amateur TikTok energy — ` +
    `NOT an ad, NOT cinematic.` + CANDADO
  );
}

/** Guion inicial del UGC: primera persona, como creador de contenido. */
export function guionInicialUGC(tipo: TipoCalzado): string {
  const { palabra, femenino } = PALABRA_TIPO[tipo];
  const estas = femenino ? "estas" : "estos";
  const comodas = femenino ? "cómodas" : "cómodos";
  const las = femenino ? "las" : "los";
  return (
    `¡Miren ${estas} ${palabra} que me llegaron! Están súper ${comodas}, ` +
    `los materiales se sienten de calidad y combinan con todo. Yo ya ${las} estoy ` +
    `usando diario — córranle antes de que se agoten.`
  );
}
