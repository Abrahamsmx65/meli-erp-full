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

export type TipoCalzado = "bota" | "sandalia" | "tenis" | "tacon" | "mocasin" | "zapato";
export type Genero = "mujer" | "hombre" | "nino" | null;

// ---------------------------------------------------------------------------
// Detección a partir del texto de la publicación
// ---------------------------------------------------------------------------

const TIPOS: [TipoCalzado, RegExp][] = [
  ["bota", /\b(BOTA|BOTIN|BOTÍN|BOOT)/i],
  ["sandalia", /\b(SANDALIA|HUARACHE|CHANCLA|FLIP)/i],
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
    locaciones: [
      "a white-sand beach boardwalk at sunset",
      "a tropical resort pool deck",
      "a colorful summer street market",
      "a breezy seaside terrace",
    ],
    luces: ["bright summer sunlight", "soft sunset glow", "sparkling midday light with gentle shade"],
    acciones: [
      "strolling relaxed along the boardwalk",
      "walking barefoot-style, easy and light, splashing a little water",
      "turning around smiling while walking away from the camera",
    ],
    atuendos: ["a flowy summer dress", "linen shorts and a light shirt", "a beach cover-up"],
    superficies: ["warm sand with seashells", "sun-bleached wooden planks", "a poolside mosaic edge"],
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
