/**
 * Motor de conceptos UGC: cada tirada del dado arma un video DISTINTO —
 * concepto narrativo, perfil del influencer, escena inicial, forma de grabar
 * y guion con gancho — específico para el tipo de calzado y su público.
 *
 * Los conceptos vienen del brief del usuario (pantuflas = llegar a casa;
 * sandalias de mujer = outfit; botas de hombre = uso diario; sandalias de
 * hombre = viaje) más variantes propias (unboxing, reseña al mes, alberca).
 * Cada categoría vende un MOTIVO distinto — nunca el genérico "cómodos,
 * bonitos y de calidad" — y la forma de abrir alterna: hablando a cámara,
 * frente al espejo, abriendo la caja, empacando la maleta.
 *
 * Todo es determinista con la semilla: mismo dado, mismo concepto completo.
 */

import { PALABRA_TIPO, type Genero, type TipoCalzado } from "./escenas";

// El mismo candado de siempre + la regla anti-inventos del brief.
const CANDADO_UGC =
  " STRICT RULE: the featured footwear must remain EXACTLY as shown in the reference " +
  "image — same design, shape, proportions, colors, materials, textures, stitching, " +
  "sole and logos. Do not redesign, replace, morph or restyle it, and do not invent " +
  "additional logos, text, buckles or design elements.";

// Imperfecciones que hacen que NO parezca anuncio generado.
const IMPERFECCIONES =
  " Slight handheld shake, occasional autofocus hunting, natural speech pauses, " +
  "quick natural cuts, ordinary lighting, normal home imperfections. Genuine " +
  "TikTok/Reels recommendation energy — NOT an ad, NOT cinematic, no fashion-model " +
  "posing, no floating product shots, no slow motion.";

function elegir<T>(arr: T[], semilla: number, sal: number): T {
  // Hash bien mezclado: el multiplicador lineal de escenas.ts degenera con
  // listas cortas (el paso cae en múltiplos del largo y nunca toca un
  // elemento). Determinista: misma semilla y sal, mismo elemento.
  let x = Math.floor(semilla * 2 ** 31) ^ Math.imul(sal, 2654435761);
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  x = (x ^ (x >>> 16)) >>> 0;
  return arr[x % arr.length];
}

/** Rellena {tokens} de concordancia según el género gramatical del producto. */
function llenar(plantilla: string, tipo: TipoCalzado): string {
  const { palabra, femenino } = PALABRA_TIPO[tipo];
  const mapa: Record<string, string> = {
    "{palabra}": palabra,
    "{estas}": femenino ? "estas" : "estos",
    "{unas}": femenino ? "unas" : "unos",
    "{las}": femenino ? "las" : "los",
    "{ellas}": femenino ? "ellas" : "ellos",
    "{comodas}": femenino ? "cómodas" : "cómodos",
    "{puestas}": femenino ? "puestas" : "puestos",
    "{nuevas}": femenino ? "nuevas" : "nuevos",
    "{recomendadas}": femenino ? "recomendadas" : "recomendados",
    "{aprobadas}": femenino ? "aprobadas" : "aprobados",
    "{practicas}": femenino ? "prácticas" : "prácticos",
  };
  return plantilla.replace(/\{[a-z]+\}/g, (t) => mapa[t] ?? t);
}

// ---------------------------------------------------------------------------
// Motivos de compra por categoría (el corazón del brief: cada tipo vende algo
// distinto). En español, con tokens de concordancia.
// ---------------------------------------------------------------------------

const MOTIVOS: Record<TipoCalzado, string[]> = {
  pantufla: [
    "Se sienten suavecitas pero con suela firme: puedes andar por toda la casa sin sentir que traes una pantufla toda aguada.",
    "Calientitas sin que te sude el pie, y no se salen al caminar.",
    "Es ponértelas y sentir que por fin llegaste a descansar.",
  ],
  sandalia: [
    "Cambian el outfit por completo, y van con jeans, vestido, lino… prácticamente con todo.",
    "Llevo horas caminando con ellas y cero problema: ligeras y nada incómodas.",
    "Elevan lo básico: te pones lo mismo de siempre y de repente se ve arreglado.",
  ],
  sandalia_agua: [
    "No resbalan ni con el piso mojado, y se secan volando.",
    "Aguantan agua, sol y todo el día… y siguen {comodas}.",
    "Para el calor son lo mejor: frescas, firmes y sin patinadas.",
  ],
  bota: [
    "Quedan perfecto con jeans, la suela se siente firme y se ven bien hechas.",
    "Aguantan el uso diario sin deformarse, y sirven igual de día que de noche.",
    "Son de esas botas de diario de las que no te arrepientes: {comodas} y resistentes.",
  ],
  tenis: [
    "Paso todo el día de pie y no me cansan: ligeros y bien acolchados.",
    "Combinan con todo y para caminar mucho son otra cosa.",
    "Frescos, ligeros, y no se ven gastados a la semana como otros.",
  ],
  tacon: [
    "Se ven elegantísimos y de verdad aguantas la noche entera con ellos.",
    "Estilizan un montón y no torturan como otros tacones.",
    "El taconeo se siente firme y seguro, nada de andar tambaleándose.",
  ],
  mocasin: [
    "Se ven presentables para la oficina, pero se sienten como pantufla.",
    "Van igual de bien con pantalón de vestir que con jeans, y son {comodas} desde el día uno.",
    "Cero molestias aunque {las} uses todo el día.",
  ],
  zapato: [
    "Sirven igual para el trabajo que para el fin de semana.",
    "{palabra} que estrenas sin ampollas ni molestias, desde el primer día.",
    "Buen material y se ven más caros de lo que costaron.",
  ],
};

// ---------------------------------------------------------------------------
// Conceptos
// ---------------------------------------------------------------------------

type Publico = "mujer" | "hombre";

interface Concepto {
  id: string;
  etiqueta: string;
  tipos: TipoCalzado[];
  publicos: Publico[];
  /** Quién graba (EN, por público). El tono del guion también cambia. */
  perfil: Record<Publico, string>;
  /** Cuadro inicial del video (EN): qué se ve cuando arranca. */
  escenas: string[];
  /** Qué pasa en el video (EN), multi-toma, estilo celular. */
  narrativas: string[];
  /** Ganchos de los primeros 2 segundos (ES). */
  hooks: string[];
  /** Motivo del concepto; si falta se usa MOTIVOS[tipo]. */
  motivos?: string[];
  cierres: string[];
}

const CONCEPTOS: Concepto[] = [
  {
    id: "llegue-a-casa",
    etiqueta: "Llegué a casa",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfil: {
      mujer:
        "a Mexican woman in her late 20s wearing leggings and an oversized sweater, just home after a long day",
      hombre:
        "a Mexican man in his early 30s in a t-shirt and joggers, just home after a long day",
    },
    escenas: [
      "in the apartment entryway in the evening, bag just dropped on the floor, warm household lighting, sitting down mid-sentence while sliding into the featured slippers",
      "on the living room couch at night, one lamp on, blankets around, leaning to the phone while holding up the featured slippers",
      "in the kitchen in the morning, coffee brewing behind, talking to the phone propped on the counter, featured slippers on",
    ],
    narrativas: [
      "she arrives home after a long day, drops her bag, takes off her street shoes and slides into the featured slippers — natural close-up of the feet sliding in — then walks through the apartment to the kitchen, prepares a drink and ends up relaxing on the sofa",
      "cozy evening at home: shuffles around the apartment in the featured slippers, picks something from the kitchen, flops on the couch and lifts a foot to show them to the camera",
      "morning routine: gets out of bed straight into the featured slippers, walks to the kitchen to make coffee, sits by the window with the mug, camera catches the slippers at every step",
    ],
    hooks: [
      "Les tengo que enseñar algo que últimamente uso TODOS los días.",
      "Literal, llego a mi casa y lo primero que hago… es esto.",
      "Esto ya se volvió mi ritual favorito al llegar a casa.",
    ],
    cierres: [
      "De esas cosas que no sabía que necesitaba.",
      "Para estar en casa, no hay nada mejor.",
      "Si trabajas todo el día de pie, me van a entender.",
    ],
  },
  {
    id: "outfit-del-dia",
    etiqueta: "Outfit del día",
    tipos: ["sandalia", "tacon", "tenis", "zapato", "bota"],
    publicos: ["mujer"],
    perfil: {
      mujer:
        "a stylish Mexican woman in her mid 20s getting ready for a casual Saturday outing, young and relatable, not a fashion model",
      hombre: "a casual Mexican man in his late 20s picking an outfit, relatable",
    },
    escenas: [
      "in front of her bedroom mirror holding the phone, outfit options thrown on the bed behind, mid-sentence while showing the featured footwear",
      "sitting on the edge of the bed putting on the featured footwear, mirror and normal bedroom clutter behind",
      "in her closet doorway comparing two pairs of shoes, holding up the featured one to the camera",
    ],
    narrativas: [
      "Get Ready With Me: handheld mirror shot showing the outfit while she decides which shoes to wear, she picks the featured pair, close-up putting them on, full-body mirror check showing how they complement the outfit, then a low-angle clip walking down a pleasant street or café",
      "she tries the outfit with another pair first, shakes her head, switches to the featured footwear, and the mirror shot shows the look clicking — ends walking out the door",
      "quick outfit montage in the mirror, the featured footwear stays on in every option, final selfie-angle walking clip outside",
    ],
    hooks: [
      "Ok, ayúdenme con el outfit de hoy…",
      "No sabía qué ponerme, hasta que me acordé de {estas} {palabra}.",
      "El outfit de hoy gira alrededor de {estas} {palabra}.",
    ],
    cierres: [
      "Así quedó el look, ¿qué opinan?",
      "¿Ustedes con qué {las} combinarían?",
      "10 de 10 el look de hoy.",
    ],
  },
  {
    id: "para-diario",
    etiqueta: "Los compré para diario",
    tipos: ["bota", "tenis", "mocasin", "zapato"],
    publicos: ["hombre"],
    perfil: {
      hombre:
        "a regular Mexican man around 35, plain shirt and jeans, someone recommending a purchase that worked out — understated, NOT a fashion model",
      mujer: "a practical Mexican woman in her 30s, casual, recommending a purchase that worked out",
    },
    escenas: [
      "sitting in his entryway on a weekday morning putting on and lacing the featured footwear, keys and backpack nearby",
      "standing in the hallway ready to leave for work, holding the phone, featured footwear on and clearly visible",
      "in a parking lot next to his car, phone at arm's length, glancing down at the featured footwear",
    ],
    narrativas: [
      "a normal weekday: he sits and puts the featured footwear on, ties it, stands up, grabs his keys and leaves — smartphone clips walking through a parking lot, a sidewalk and a casual work environment, one close-up of the footwear after hours of normal use",
      "matter-of-fact review: he shows the footwear in his hands, points at the sole and stitching while talking, puts it on and walks naturally down the street — no posing",
      "half the video walking POV looking down at the featured footwear on real streets, cut to him explaining to the camera why he keeps wearing it",
    ],
    hooks: [
      "Les enseño {estas} {palabra} porque sí me sorprendieron.",
      "Ya llevo un rato usando {estas} {palabra}, va la opinión honesta.",
      "Andaba buscando {unas} {palabra} para el diario… y me quedé con {estas}.",
    ],
    cierres: [
      "Si buscas {unas} {palabra} de diario, {estas} cumplen.",
      "Compra que sí valió la pena.",
      "Sin tanto rollo: {recomendadas}.",
    ],
  },
  {
    id: "de-viaje",
    etiqueta: "Me las llevé de viaje",
    tipos: ["sandalia", "sandalia_agua", "tenis", "mocasin"],
    publicos: ["hombre", "mujer"],
    perfil: {
      hombre:
        "a relaxed Mexican man in his early 30s in shorts and a polo, travel-vlog style creator on a weekend getaway",
      mujer:
        "a relaxed Mexican woman in her late 20s in summer clothes, travel-vlog style creator on a weekend getaway",
    },
    escenas: [
      "inside a bright hotel room, small travel bag open on the bed, holding up the featured footwear to the camera mid-sentence",
      "sitting on the hotel bed putting on the featured footwear, suitcase and sunlight from the window behind",
      "on the hotel balcony with the phone at arm's length, featured footwear held up, warm destination behind",
    ],
    narrativas: [
      "travel vlog: unpacking a small bag in the hotel room, pulls out the featured footwear and explains why it always comes along, puts it on beside the bed, walks the hotel hallway, goes down for breakfast, walks near the pool — with POV shots looking down at the feet",
      "a day of the trip wearing the featured footwear everywhere: breakfast, walking the town, the pool area, back to the room — casual clips stitched like a real vlog",
      "packing light: shows everything that fits in the small bag, the featured footwear goes in first, then quick clips of it being used all weekend",
    ],
    hooks: [
      "Esto SIEMPRE termina en mi maleta cuando salgo de viaje.",
      "Lo que nunca falta cuando me escapo el fin de semana… {estas} {palabra}.",
      "Empaqué ligerísimo para este viaje, pero esto no podía faltar.",
    ],
    motivos: [
      "No ocupan casi nada en la maleta y {las} termino usando para todo: bajar a desayunar, la alberca, caminar por ahí.",
      "Puedo caminar horas con {ellas} sin que me molesten, y con el calor se agradecen.",
      "Entre cargar cinco pares o algo que sirva para todo… me quedo con esto.",
    ],
    cierres: [
      "Lo más práctico que traigo.",
      "Viajar ligero, pero bien.",
      "Para un fin de semana así, es todo lo que necesitas.",
    ],
  },
  {
    id: "recien-llegaron",
    etiqueta: "Me acaban de llegar",
    tipos: ["bota", "sandalia", "sandalia_agua", "pantufla", "tenis", "tacon", "mocasin", "zapato"],
    publicos: ["mujer", "hombre"],
    perfil: {
      mujer: "a Mexican woman in her 20s at home, genuinely excited about a delivery, casual clothes",
      hombre: "a Mexican man in his 30s at home, curious about a delivery, casual clothes",
    },
    escenas: [
      "at the dining table with a just-opened shoe box, lifting the featured footwear out towards the camera",
      "sitting on the couch with the delivery box on the lap, holding the featured footwear up mid-sentence",
      "on the bedroom floor with the open box and wrapping paper around, showing the featured footwear to the camera",
    ],
    narrativas: [
      "unboxing: opens the box on camera, honest first reaction, turns the featured footwear around showing the sole and material up close, tries it on for the first time and takes a few steps checking the mirror",
      "first impressions: compares what it looks like in hand versus the listing photos, points at the details while talking, then puts it on and walks a little",
      "quick unboxing cut with the fingers tracing the stitching and sole, then the first try-on with a mirror glance and a happy nod",
    ],
    hooks: [
      "¡Por fin llegaron! Miren esto.",
      "Acaba de llegar el paquete que estaba esperando…",
      "Primera impresión en vivo: esto acaba de llegar.",
    ],
    motivos: [
      "Se ven mejor que en las fotos, en serio: el material se siente bien y los detalles vienen limpios.",
      "Me {las} probé de una vez y la primera sensación es buenísima.",
      "El acabado se ve de calidad, mejor de lo que esperaba por el precio.",
    ],
    cierres: [
      "Primera impresión: {aprobadas}.",
      "Ahorita se los enseño {puestas} con calma.",
      "Ya les contaré cómo se portan con el uso.",
    ],
  },
  {
    id: "un-mes-despues",
    etiqueta: "Un mes usándolos",
    tipos: ["bota", "tenis", "zapato", "mocasin", "sandalia"],
    publicos: ["mujer", "hombre"],
    perfil: {
      mujer: "a down-to-earth Mexican woman in her 30s giving an honest follow-up review, casual",
      hombre: "a down-to-earth Mexican man in his 30s giving an honest follow-up review, casual",
    },
    escenas: [
      "in the living room holding the featured footwear up to the camera, showing it after weeks of real use",
      "sitting on the doorstep of the house wearing the featured footwear, relaxed, phone at arm's length",
      "by the shoe rack at home, picking the featured footwear out from the others to show the camera",
    ],
    narrativas: [
      "honest one-month review: shows the featured footwear up close after weeks of use, points at the sole and stitching still holding up, puts it on and walks naturally on the street, ends talking straight to the camera",
      "before-work check-in: puts the featured footwear on like any other day while telling the camera how it has held up, walks out the door",
      "shows the featured footwear next to an older worn-out pair, makes the point, then wears it out for a walk",
    ],
    hooks: [
      "Un mes usando {estas} {palabra}: reseña honesta.",
      "Muchos me preguntaron por {estas} {palabra}… un mes después, esto pienso.",
      "¿Valen la pena {estas} {palabra} después de un mes de uso? Va.",
    ],
    motivos: [
      "Se siguen viendo prácticamente {nuevas}, y eso que no {las} he cuidado nada.",
      "La suela no se ha deformado y siguen igual de {comodas} que el primer día.",
      "Uso diario, sin consentirlas… y aquí siguen, firmes.",
    ],
    cierres: [
      "Veredicto: sí valen.",
      "Un mes después: {recomendadas}.",
      "Si dudaban, ahí está la respuesta.",
    ],
  },
  {
    id: "dia-de-alberca",
    etiqueta: "Día de alberca",
    tipos: ["sandalia_agua"],
    publicos: ["mujer", "hombre"],
    perfil: {
      mujer: "a Mexican woman in her 20s in a swimsuit cover-up at a pool, casual vlog style",
      hombre: "a Mexican man in his 30s in swim shorts and a t-shirt at a pool, casual vlog style",
    },
    escenas: [
      "at the edge of a community pool with towels around, wearing the featured sandals, phone held selfie-style",
      "sitting at the pool steps putting on the featured sandals, water sparkling behind",
      "walking on the wet pool deck towards the camera in the featured sandals, mid-sentence",
    ],
    narrativas: [
      "pool day vlog: puts the featured sandals on, walks the wet pool deck confidently, dips the feet at the edge, walks to the snack bar — with POV shots of the feet walking on wet floor",
      "beach-day version: sand, boardwalk and shore clips wearing the featured sandals, rinses them at the shower and they are ready again",
      "getting ready for the pool: grabs towel and sunscreen, slides into the featured sandals and heads out, casual clips all the way to the water",
    ],
    hooks: [
      "Día de alberca… y esto es lo más importante que traje.",
      "Si van a la alberca o a la playa, necesitan ver esto.",
      "El error es llevar chanclas malas a la alberca. Yo traigo estas.",
    ],
    cierres: [
      "Verano resuelto.",
      "Las de agua que sí sirven.",
      "Alberca, playa, regadera… sirven para todo.",
    ],
  },
];

// ---------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------

export interface ConceptoArmado {
  id: string;
  etiqueta: string;
  /** Prompt de la imagen inicial (Soul, 9:16, con la foto real de referencia). */
  promptImagen: string;
  /** Narrativa del video (EN), sin candado ni diálogo: se remata con paraSpeak/conVozIA. */
  narrativa: string;
  /** Guion sugerido (ES): gancho + motivo + cierre. El vendedor lo edita. */
  guionSugerido: string;
}

/** El público del guion: niños los presenta una mamá; sin género, mujer. */
function publicoDe(genero: Genero): Publico {
  return genero === "hombre" ? "hombre" : "mujer";
}

/**
 * Arma el concepto completo para un tipo + género + semilla. Determinista:
 * el 🎲 (semilla nueva) cambia concepto, escena, narrativa y guion a la vez.
 */
export function armarConceptoUGC(datos: {
  tipo: TipoCalzado;
  genero: Genero;
  semilla: number;
}): ConceptoArmado {
  const publico = publicoDe(datos.genero);
  const candidatos = CONCEPTOS.filter(
    (c) => c.tipos.includes(datos.tipo) && c.publicos.includes(publico),
  );
  // Siempre hay al menos "recien-llegaron", que cubre todos los tipos.
  const pool = candidatos.length ? candidatos : CONCEPTOS.filter((c) => c.id === "recien-llegaron");
  const concepto = elegir(pool, datos.semilla, 11);

  const escena = elegir(concepto.escenas, datos.semilla, 13);
  const narrativaBase = elegir(concepto.narrativas, datos.semilla, 17);
  const hook = elegir(concepto.hooks, datos.semilla, 19);
  const motivo = elegir(concepto.motivos ?? MOTIVOS[datos.tipo], datos.semilla, 23);
  const cierre = elegir(concepto.cierres, datos.semilla, 29);

  const perfil =
    datos.genero === "nino"
      ? "a young Mexican mom in her early 30s presenting kids' footwear she bought, casual everyday clothes"
      : concepto.perfil[publico];

  const promptImagen =
    `Frame grab from a casual vertical 9:16 video filmed on a smartphone: ${perfil}, ` +
    `${escena}. The featured footwear from the reference image is clearly visible. ` +
    `Full body or three-quarter body in frame, ordinary lighting, slightly imperfect ` +
    `framing, mild phone-camera grain, real unretouched skin. It must look like a ` +
    `regular person's TikTok clip: amateur, spontaneous, relatable. NO studio lighting, ` +
    `NO advertising polish, NO cinematic look, NO posing.` + CANDADO_UGC;

  const narrativa =
    `Authentic vertical 9:16 UGC video filmed naturally on a smartphone: ${perfil}. ` +
    `${narrativaBase}.` + IMPERFECCIONES;

  const guionSugerido = llenar(`${hook} ${motivo} ${cierre}`, datos.tipo);

  return { id: concepto.id, etiqueta: concepto.etiqueta, promptImagen, narrativa, guionSugerido };
}

/** Remate para Speak (el audio grabado pone las palabras). */
export function promptUGCParaSpeak(narrativa: string): string {
  return (
    narrativa +
    " The person talks directly to the camera with spontaneous natural gestures, " +
    "like recommending the footwear to a friend." + CANDADO_UGC
  );
}

/** Remate con voz de IA (Wan 2.6: el diálogo genera la voz con lip sync). */
export function promptUGCConVozIA(narrativa: string, guion: string): string {
  const limpio = guion.trim().replace(/"/g, "'");
  return (
    narrativa +
    ` The person talks directly to the camera in casual Mexican Spanish with accurate ` +
    `lip sync, like recommending the footwear to a friend, saying: "${limpio}".` +
    CANDADO_UGC
  );
}
