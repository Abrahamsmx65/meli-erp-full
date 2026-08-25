/**
 * Motor de escenas: qué video le queda a cada tipo de calzado.
 *
 * No es lo mismo unas botas que unas sandalias: el tipo se detecta del
 * título/modelo de la publicación y cada tipo trae sus propias escenas con
 * variantes de locación, luz y movimiento. El botón "Variar" de la UI tira
 * un dado nuevo y arma otra combinación, para que dos videos del mismo
 * producto no salgan iguales.
 *
 * Los prompts van en inglés a propósito: los modelos generan mejor así.
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
// Ingredientes por tipo
// ---------------------------------------------------------------------------

interface Ingredientes {
  /** dónde pasa la escena */
  locaciones: string[];
  /** con qué luz */
  luces: string[];
  /** qué hace la persona (video con personaje) */
  acciones: string[];
  /** ropa que acompaña al calzado */
  atuendos: string[];
  /** dónde se para el producto cuando NO hay personaje */
  superficies: string[];
}

const INGREDIENTES: Record<TipoCalzado, Ingredientes> = {
  bota: {
    locaciones: [
      "a rugged mountain trail with pine trees",
      "a rain-soaked city street at night with neon reflections",
      "an autumn forest path covered in golden leaves",
      "an industrial district with brick walls",
      "a desert road at golden hour",
    ],
    luces: ["moody overcast light", "warm golden hour glow", "dramatic low sun with long shadows"],
    acciones: [
      "walking firmly toward the camera with confident strides",
      "stepping onto a rock ledge and pausing to look ahead",
      "kicking up dust as they stride past the camera",
    ],
    atuendos: ["slim jeans and a rugged jacket", "cargo pants and a flannel shirt", "a long coat with dark denim"],
    superficies: ["a weathered wooden crate", "wet asphalt with reflections", "mossy rocks"],
  },
  sandalia: {
    // Sandalias de vestir, corcho, piel: nada de agua, que se echan a perder.
    locaciones: [
      "a colorful summer street market",
      "a charming café terrace with plants",
      "a sunlit boutique district",
      "a garden patio with warm string lights",
    ],
    luces: ["bright summer sunlight", "soft golden afternoon light", "sparkling midday light with gentle shade"],
    acciones: [
      "strolling relaxed through the market",
      "walking easy and light across the terrace",
      "turning around smiling while walking away from the camera",
    ],
    atuendos: ["a flowy summer dress", "linen shorts and a light shirt", "a light boho outfit"],
    superficies: ["warm terracotta tiles", "sun-bleached wooden planks", "a linen-draped display table"],
  },
  sandalia_agua: {
    locaciones: [
      "a white-sand beach shoreline at sunset",
      "a tropical resort pool deck",
      "a rocky river bank with crystal-clear water",
      "a breezy seaside boardwalk",
    ],
    luces: ["bright summer sunlight", "soft sunset glow", "sparkling reflections from the water"],
    acciones: [
      "walking along the wet shoreline, splashing a little water with each step",
      "stepping into shallow crystal-clear water, drops sparkling",
      "strolling on the pool deck leaving wet footprints",
    ],
    atuendos: ["a swimsuit with a beach cover-up", "board shorts and a tank top", "light beachwear"],
    superficies: ["wet sand with foam from a wave", "a poolside mosaic edge with water drops", "smooth river stones"],
  },
  pantufla: {
    // Las pantuflas viven dentro de casa: cozy, no banquetas.
    locaciones: [
      "a cozy living room with a soft rug and warm lamps",
      "a bright bedroom on a lazy Sunday morning",
      "a cabin with a fireplace glowing",
      "a modern kitchen while making morning coffee",
    ],
    luces: ["warm cozy indoor light", "soft morning window light", "golden fireplace glow"],
    acciones: [
      "padding softly across the wooden floor toward the camera",
      "curling up on the couch and stretching their feet toward the camera",
      "walking to the kitchen holding a mug, relaxed and comfy",
    ],
    atuendos: ["cozy pajamas and a knit sweater", "a fluffy robe", "loungewear with warm socks vibes"],
    superficies: ["a soft shaggy rug", "warm wooden flooring", "a knitted blanket on the couch"],
  },
  tenis: {
    locaciones: [
      "an urban basketball court with murals",
      "a skate park at golden hour",
      "a busy city crosswalk",
      "a modern gym with dramatic lighting",
      "a colorful graffiti alley",
    ],
    luces: ["punchy urban daylight", "neon-tinted evening light", "clean bright studio-like light"],
    acciones: [
      "jogging toward the camera and stopping with energy",
      "doing a quick pivot step, sneakers gripping the ground",
      "walking with a confident bounce, camera tracking low",
    ],
    atuendos: ["joggers and a hoodie", "athletic wear", "streetwear with an oversized jacket"],
    superficies: ["painted court concrete", "a skate ramp edge", "clean white studio blocks"],
  },
  tacon: {
    locaciones: [
      "an elegant hotel lobby with marble floors",
      "a rooftop bar at dusk with city lights",
      "a grand staircase with warm lamps",
      "a gallery opening with soft spotlights",
    ],
    luces: ["warm glamorous lighting", "cool elegant evening light", "soft cinematic spotlights"],
    acciones: [
      "walking gracefully toward the camera, heels clicking",
      "descending the staircase slowly, one hand on the rail",
      "turning elegantly, dress flowing, heels in focus",
    ],
    atuendos: ["an elegant evening dress", "a chic tailored suit", "a cocktail dress"],
    superficies: ["polished marble", "a velvet pedestal", "a mirrored platform"],
  },
  mocasin: {
    locaciones: [
      "a stylish café terrace in the morning",
      "a modern office lobby",
      "a cobblestone street in a historic district",
      "a yacht deck on a clear day",
    ],
    luces: ["soft morning light", "clean corporate daylight", "warm afternoon light"],
    acciones: [
      "walking relaxed with hands in pockets",
      "crossing the lobby with an easy confident pace",
      "stepping off a curb smoothly, camera at ankle height",
    ],
    atuendos: ["chinos and a crisp shirt", "a smart-casual blazer", "light summer trousers"],
    superficies: ["warm wooden decking", "polished concrete", "cobblestones"],
  },
  zapato: {
    locaciones: [
      "a lively city sidewalk",
      "a sunlit park path",
      "a modern shopping district",
      "a minimalist studio set",
    ],
    luces: ["natural daylight", "warm golden hour glow", "clean soft studio light"],
    acciones: [
      "walking naturally toward the camera",
      "stepping confidently past the camera, shoes in focus",
      "pausing mid-walk and turning slightly",
    ],
    atuendos: ["smart-casual everyday clothes", "jeans and a neat jacket", "a relaxed modern outfit"],
    superficies: ["clean pavement", "a wooden display cube", "smooth studio floor"],
  },
};

// ---------------------------------------------------------------------------
// Escenas
// ---------------------------------------------------------------------------

export interface Escena {
  id: string;
  etiqueta: string;
  descripcion: string;
  /** true si la escena necesita una persona (y por lo tanto luce con personaje) */
  conPersona: boolean;
}

export const ESCENAS: Escena[] = [
  {
    id: "uso-real",
    etiqueta: "Uso real",
    descripcion: "La persona camina con el producto puesto, escena natural.",
    conPersona: true,
  },
  {
    id: "influencer",
    etiqueta: "Estilo influencer",
    descripcion: "Pose y actitud de redes: cercano, con energía y carisma.",
    conPersona: true,
  },
  {
    id: "escaparate",
    etiqueta: "Escaparate",
    descripcion: "Solo el producto: la cámara lo rodea con luz de estudio.",
    conPersona: false,
  },
  {
    id: "detalle",
    etiqueta: "Detalles",
    descripcion: "Acercamientos a materiales, costuras y suela.",
    conPersona: false,
  },
];

/** Cómo se llama el producto cuando el personaje habla de él. */
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

function elegir<T>(arr: T[], semilla: number, sal: number): T {
  // Determinista con la semilla: mismo dado, misma escena.
  const i = Math.abs(Math.floor(semilla * 7919 + sal * 104729)) % arr.length;
  return arr[i];
}

const PERSONA: Record<Exclude<Genero, null>, string> = {
  mujer: "a young female fashion influencer",
  hombre: "a young male fashion influencer",
  nino: "a cheerful kid model",
};

/**
 * Prompts del clip hablado: el personaje presenta el producto a cámara y
 * dice el guion en español. Veo 3.1 genera la voz y el lip sync desde el
 * propio prompt.
 */
export function armarPromptsHablado(datos: {
  tipo: TipoCalzado;
  genero: Genero;
  semilla: number;
  guion: string;
}): PromptsEscena {
  const ing = INGREDIENTES[datos.tipo];
  const s = datos.semilla;
  const locacion = elegir(ing.locaciones, s, 1);
  const luz = elegir(ing.luces, s, 2);
  const atuendo = elegir(ing.atuendos, s, 4);
  const persona = PERSONA[datos.genero ?? "mujer"];
  const guion = datos.guion.trim().replace(/"/g, "'");

  return {
    imagen:
      `Vertical photo of ${persona} with ${atuendo} in ${locacion}, ${luz}, facing the camera ` +
      `and holding up one shoe from the reference image toward the viewer while wearing the pair, ` +
      `social media selfie-video framing, photorealistic, sharp focus, ` +
      `the shoes must match the reference exactly`,
    video:
      `The person looks straight at the camera with a warm smile, lifts the shoe closer to the lens to ` +
      `show it off, and says in enthusiastic Mexican Spanish: "${guion}". ` +
      `Natural lip sync and hand gestures, upbeat social media influencer energy, ${luz}, ` +
      `vertical video, the shoes clearly visible the whole time`,
  };
}

export interface PromptsEscena {
  /** para Soul: la foto vertical de partida */
  imagen: string;
  /** para Kling/DoP: cómo se mueve esa foto */
  video: string;
}

/**
 * Arma los dos prompts (imagen y video) para un tipo de calzado, escena,
 * género y semilla de variación. Cambiar la semilla cambia locación, luz,
 * atuendo y acción: esa es la "creatividad" controlada.
 */
export function armarPrompts(datos: {
  tipo: TipoCalzado;
  escenaId: string;
  genero: Genero;
  semilla: number;
}): PromptsEscena {
  const ing = INGREDIENTES[datos.tipo];
  const s = datos.semilla;
  const locacion = elegir(ing.locaciones, s, 1);
  const luz = elegir(ing.luces, s, 2);
  const accion = elegir(ing.acciones, s, 3);
  const atuendo = elegir(ing.atuendos, s, 4);
  const superficie = elegir(ing.superficies, s, 5);
  const persona = PERSONA[datos.genero ?? "mujer"];

  switch (datos.escenaId) {
    case "influencer":
      return {
        imagen:
          `Vertical full-body photo of ${persona} wearing the exact shoes from the reference image ` +
          `with ${atuendo}, posing for social media in ${locacion}, ${luz}, shot on a 35mm lens, ` +
          `photorealistic, sharp focus on the shoes, the shoes must match the reference exactly`,
        video:
          `The person comes alive with influencer energy: ${accion}, then a playful spin toward ` +
          `the camera, ${luz}, smooth gimbal movement, the shoes always in frame and in focus`,
      };
    case "escaparate":
      return {
        imagen:
          `Vertical premium product photo of the exact shoes from the reference image placed on ` +
          `${superficie} in ${locacion}, ${luz}, shallow depth of field, photorealistic, ` +
          `the shoes must match the reference exactly`,
        video:
          `Slow cinematic orbit around the shoes, ${luz}, subtle dust particles in the light, ` +
          `premium commercial style, the shoes stay perfectly identical`,
      };
    case "detalle":
      return {
        imagen:
          `Vertical macro-style photo of the exact shoes from the reference image on ${superficie}, ` +
          `${luz}, extreme detail of stitching, texture and sole, photorealistic, ` +
          `the shoes must match the reference exactly`,
        video:
          `Slow dolly-in revealing the texture, stitching and sole of the shoes, ${luz}, ` +
          `elegant focus pulls, premium commercial style, the shoes stay perfectly identical`,
      };
    case "uso-real":
    default:
      return {
        imagen:
          `Vertical full-body photo of ${persona} wearing the exact shoes from the reference image ` +
          `with ${atuendo}, standing naturally in ${locacion}, ${luz}, candid documentary style, ` +
          `photorealistic, sharp focus on the shoes, the shoes must match the reference exactly`,
        video:
          `Realistic scene: ${accion}, natural body motion, ${luz}, handheld documentary feel, ` +
          `camera low and close to the ground, the shoes always visible and in focus`,
      };
  }
}
