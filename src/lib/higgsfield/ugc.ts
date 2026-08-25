/**
 * Motor de conceptos UGC: cada tirada del dado arma un video DISTINTO —
 * concepto narrativo, perfil del influencer, escena inicial, forma de grabar
 * y guion con gancho — específico para el tipo de calzado y su público.
 *
 * Los conceptos base vienen del brief del usuario (pantuflas = llegar a
 * casa; sandalias de mujer = outfit; botas de hombre = uso diario;
 * sandalias de hombre = viaje) y de ahí se amplió el catálogo: unboxing,
 * reseña al mes, alberca, oficina, mandado, jornada de pie, obra, lluvia,
 * regalo, escéptico convertido y un concepto especial para calzado de niños
 * (presenta la mamá; NUNCA se generan menores). Cada categoría vende un
 * MOTIVO distinto — jamás el genérico "cómodos, bonitos y de calidad" — y
 * la forma de abrir alterna: a cámara, espejo, caja, maleta, camino al
 * trabajo.
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
  // Hash bien mezclado: un multiplicador lineal degenera con listas cortas
  // (el paso cae en múltiplos del largo y nunca toca un elemento).
  // Determinista: misma semilla y sal, mismo elemento.
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
    "{resistentes}": "resistentes",
    "{baratas}": femenino ? "baratas" : "baratos",
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
    "El acolchado de verdad se siente; no es de las que se aplastan a la semana.",
    "Puedes hasta salir por el mandado rápido y no se ven mal.",
  ],
  sandalia: [
    "Cambian el outfit por completo, y van con jeans, vestido, lino… prácticamente con todo.",
    "Llevo horas caminando con ellas y cero problema: ligeras y nada incómodas.",
    "Elevan lo básico: te pones lo mismo de siempre y de repente se ve arreglado.",
    "No sacan ampollas ni marcan el pie, ni el primer día.",
    "La plantilla se siente acolchadita, no dura como tabla.",
  ],
  sandalia_agua: [
    "No resbalan ni con el piso mojado, y se secan volando.",
    "Aguantan agua, sol y todo el día… y siguen {comodas}.",
    "Para el calor son lo mejor: frescas, firmes y sin patinadas.",
    "Las enjuagas y quedan como nuevas; ni se decoloran.",
    "El material no lastima aunque traigas el pie mojado.",
  ],
  bota: [
    "Quedan perfecto con jeans, la suela se siente firme y se ven bien hechas.",
    "Aguantan el uso diario sin deformarse, y sirven igual de día que de noche.",
    "Son de esas botas de diario de las que no te arrepientes: {comodas} y resistentes.",
    "El material se ve de calidad y las costuras vienen parejas, bien rematadas.",
    "Se amoldan al pie a los dos días; no hay que 'sufrirlas' semanas.",
  ],
  bota_industrial: [
    "Aguantan la jornada completa: suela antiderrapante y el pie protegido.",
    "Son duras para el trabajo pero no pesan como otras; llegas a casa sin los pies muertos.",
    "Costuras reforzadas, no se despegan a los tres meses como las {baratas}.",
    "Agarran bien en piso mojado, grava y escalera — de eso depende uno.",
    "Para el trabajo rudo salen más baratas que comprar dos veces.",
  ],
  tenis: [
    "Paso todo el día de pie y no me cansan: ligeros y bien acolchados.",
    "Combinan con todo y para caminar mucho son otra cosa.",
    "Frescos, ligeros, y no se ven gastados a la semana como otros.",
    "El soporte se siente de verdad; no es puro diseño bonito.",
    "Los lavas y quedan como el primer día.",
  ],
  tacon: [
    "Se ven elegantísimos y de verdad aguantas la noche entera con ellos.",
    "Estilizan un montón y no torturan como otros tacones.",
    "El taconeo se siente firme y seguro, nada de andar tambaleándose.",
    "La altura es la perfecta: eleva sin volverse un castigo.",
    "La horma es amplia de enfrente; no aprietan los dedos.",
  ],
  mocasin: [
    "Se ven presentables para la oficina, pero se sienten como pantufla.",
    "Van igual de bien con pantalón de vestir que con jeans, y son {comodas} desde el día uno.",
    "Cero molestias aunque {las} uses todo el día.",
    "La piel se ve bien acabada, de las que envejecen bonito.",
    "Te los pones sin agacharte y se ven arreglados: la combinación perfecta.",
  ],
  zapato: [
    "Sirven igual para el trabajo que para el fin de semana.",
    "{palabra} que estrenas sin ampollas ni molestias, desde el primer día.",
    "Buen material y se ven más caros de lo que costaron.",
    "Aguantan el uso diario y siguen presentables.",
    "La suela no es dura como tabla: caminas horas y no lo resientes.",
  ],
};

// ---------------------------------------------------------------------------
// Conceptos
// ---------------------------------------------------------------------------

type Publico = "mujer" | "hombre";

interface Concepto {
  id: string;
  etiqueta: string;
  tipos: TipoCalzado[] | "todos";
  publicos: Publico[];
  /** Solo aparece para calzado de niños (presenta la mamá). */
  soloNinos?: boolean;
  /** Quién graba (EN, por público, varias variantes). */
  perfiles: Record<Publico, string[]>;
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

const TODOS: TipoCalzado[] = [
  "bota",
  "bota_industrial",
  "sandalia",
  "sandalia_agua",
  "pantufla",
  "tenis",
  "tacon",
  "mocasin",
  "zapato",
];

const CONCEPTOS: Concepto[] = [
  {
    id: "llegue-a-casa",
    etiqueta: "Llegué a casa",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s wearing leggings and an oversized sweater, just home after a long day",
        "a Mexican woman in her mid 30s still in office clothes, visibly tired but relieved to be home",
      ],
      hombre: [
        "a Mexican man in his early 30s in a t-shirt and joggers, just home after a long day",
        "a Mexican man in his late 30s loosening his shirt after work, keys still in hand",
      ],
    },
    escenas: [
      "in the apartment entryway in the evening, bag just dropped on the floor, warm household lighting, sitting down mid-sentence while sliding into the featured slippers",
      "on the living room couch at night, one lamp on, blankets around, leaning to the phone while holding up the featured slippers",
      "sitting at the bottom of the stairs taking off street shoes, the featured slippers waiting beside, talking to the propped phone",
      "by the front door with the day's mail in one hand, stepping into the featured slippers while talking",
    ],
    narrativas: [
      "she arrives home after a long day, drops her bag, takes off street shoes and slides into the featured slippers — natural close-up of the feet sliding in — then walks through the apartment to the kitchen, prepares a drink and ends up relaxing on the sofa",
      "cozy evening at home: shuffles around the apartment in the featured slippers, picks something from the kitchen, flops on the couch and lifts a foot to show them to the camera",
      "the after-work ritual: shoes off by the door, featured slippers on, a sigh of relief to the camera, then normal home life — folding laundry, warming dinner — always wearing them",
    ],
    hooks: [
      "Les tengo que enseñar algo que últimamente uso TODOS los días.",
      "Literal, llego a mi casa y lo primero que hago… es esto.",
      "Esto ya se volvió mi ritual favorito al llegar a casa.",
      "Nadie me dijo que llegar a casa podía sentirse así de bien.",
      "El mejor momento del día empieza exactamente aquí.",
    ],
    cierres: [
      "De esas cosas que no sabía que necesitaba.",
      "Para estar en casa, no hay nada mejor.",
      "Si trabajas todo el día de pie, me van a entender.",
      "Mi casa, mis reglas… y mis pantuflas.",
    ],
  },
  {
    id: "manana-en-casa",
    etiqueta: "Mañanas en casa",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in pajamas with messy morning hair, holding a coffee mug",
        "a Mexican woman in her 30s in a robe, morning light through the kitchen window",
      ],
      hombre: [
        "a Mexican man in his 30s in a t-shirt and pajama pants, hair uncombed, morning mode",
        "a Mexican man in his late 20s making breakfast in sweatpants, relaxed Sunday energy",
      ],
    },
    escenas: [
      "in the kitchen in the morning, coffee brewing behind, talking to the phone propped on the counter, featured slippers on and visible",
      "sitting on the edge of the bed just woken up, sliding the feet into the featured slippers",
      "by the window with a mug in hand, morning light, lifting one foot to show the featured slippers",
    ],
    narrativas: [
      "morning routine: gets out of bed straight into the featured slippers, walks to the kitchen to make coffee, sits by the window with the mug, camera catches the slippers at every step",
      "lazy Sunday vlog: breakfast, watering plants, tidying a little — all in the featured slippers, with one close-up of the feet walking on the cold floor",
      "she films the 'first five minutes of my day': alarm off, feet into the slippers, curtains open, coffee — narrating to the camera the whole time",
    ],
    hooks: [
      "Mi mañana no arranca sin esto.",
      "El piso frío ya no es mi enemigo.",
      "Cinco minutos de mi mañana, tal cual son.",
      "Esto es lo PRIMERO que busco al despertar.",
    ],
    cierres: [
      "Las mañanas se disfrutan más así.",
      "Pequeños lujos que sí valen.",
      "Y así empieza un buen día.",
      "Cero pies fríos, cero mal humor.",
    ],
  },
  {
    id: "outfit-del-dia",
    etiqueta: "Outfit del día",
    tipos: ["sandalia", "tacon", "tenis", "zapato", "bota"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a stylish Mexican woman in her mid 20s getting ready for a casual Saturday outing, young and relatable, not a fashion model",
        "a Mexican woman in her early 30s with an effortless style, jeans and a linen shirt, girl-next-door vibe",
        "a Mexican college-age woman in her early 20s with playful TikTok energy, casual dress",
      ],
      hombre: ["a casual Mexican man in his late 20s picking an outfit, relatable"],
    },
    escenas: [
      "in front of her bedroom mirror holding the phone, outfit options thrown on the bed behind, mid-sentence while showing the featured footwear",
      "sitting on the edge of the bed putting on the featured footwear, mirror and normal bedroom clutter behind",
      "in her closet doorway comparing two pairs of shoes, holding up the featured one to the camera",
      "mid mirror-selfie pose wearing the full outfit with the featured footwear on, phone visible in the mirror",
    ],
    narrativas: [
      "Get Ready With Me: handheld mirror shot showing the outfit while she decides which shoes to wear, she picks the featured pair, close-up putting them on, full-body mirror check showing how they complement the outfit, then a low-angle clip walking down a pleasant street or café",
      "she tries the outfit with another pair first, shakes her head, switches to the featured footwear, and the mirror shot shows the look clicking — ends walking out the door",
      "quick outfit montage in the mirror, the featured footwear stays on in every option, final selfie-angle walking clip outside",
      "three outfits, one pair: she shows how the featured footwear works with jeans, with a dress and with linen pants, mirror shots and quick cuts",
    ],
    hooks: [
      "Ok, ayúdenme con el outfit de hoy…",
      "No sabía qué ponerme, hasta que me acordé de {estas} {palabra}.",
      "El outfit de hoy gira alrededor de {estas} {palabra}.",
      "POV: tienes salida en una hora y nada que ponerte.",
      "Tres outfits, {unas} {palabra}: vean esto.",
    ],
    cierres: [
      "Así quedó el look, ¿qué opinan?",
      "¿Ustedes con qué {las} combinarían?",
      "10 de 10 el look de hoy.",
      "Y así de fácil se resolvió el outfit.",
    ],
  },
  {
    id: "salida-de-noche",
    etiqueta: "Salida de noche",
    tipos: ["tacon", "bota", "zapato"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s getting ready for a night out, dress laid on the bed, hair half done",
        "a Mexican woman in her early 30s doing her makeup in the bedroom mirror, going-out energy",
      ],
      hombre: ["a Mexican man in his 30s getting ready for dinner, buttoning a shirt"],
    },
    escenas: [
      "at her bedroom vanity finishing her makeup, the featured footwear waiting beside her, phone propped against the mirror",
      "sitting on the bed in her going-out dress strapping on the featured footwear",
      "full-length mirror shot in the evening outfit, holding the phone, featured footwear on",
    ],
    narrativas: [
      "night-out prep: finishing touches of makeup, she picks up the featured footwear and puts it on sitting on the bed, stands for the full mirror look, grabs her bag and walks out — a clip of her walking to the uber at night",
      "she shows the shoes to the camera first, explains why these are 'the going-out pair', puts them on and does a little turn at the mirror, then a short clip arriving at a restaurant",
      "GRWM for dinner: outfit reveal in the mirror with the featured footwear as the final piece, close-up of the details, out the door",
    ],
    hooks: [
      "Hoy hay salida… y ya sé qué {palabra} van.",
      "El secreto de un buen look de noche está en los pies.",
      "GRWM para la cena de hoy.",
      "Estos son MIS {palabra} de salir, y les explico por qué.",
    ],
    cierres: [
      "Lista. Nos vemos al rato.",
      "El look de hoy: {aprobadas}.",
      "Y sí: aguantan toda la noche.",
      "Ahora sí, que empiece la noche.",
    ],
  },
  {
    id: "para-diario",
    etiqueta: "Los compré para diario",
    tipos: ["bota", "tenis", "mocasin", "zapato"],
    publicos: ["hombre"],
    perfiles: {
      hombre: [
        "a regular Mexican man around 35, plain shirt and jeans, someone recommending a purchase that worked out — understated, NOT a fashion model",
        "a Mexican man in his late 20s with backpack and headphones around the neck, everyday commuter",
        "a Mexican dad in his early 40s, polo shirt, practical and to the point",
      ],
      mujer: [
        "a practical Mexican woman in her 30s, casual, recommending a purchase that worked out",
      ],
    },
    escenas: [
      "sitting in his entryway on a weekday morning putting on and lacing the featured footwear, keys and backpack nearby",
      "standing in the hallway ready to leave for work, holding the phone, featured footwear on and clearly visible",
      "in a parking lot next to his car, phone at arm's length, glancing down at the featured footwear",
      "at a coffee shop table with the phone leaned on a cup, showing the featured footwear under the table",
    ],
    narrativas: [
      "a normal weekday: he sits and puts the featured footwear on, ties it, stands up, grabs his keys and leaves — smartphone clips walking through a parking lot, a sidewalk and a casual work environment, one close-up of the footwear after hours of normal use",
      "matter-of-fact review: he shows the footwear in his hands, points at the sole and stitching while talking, puts it on and walks naturally down the street — no posing",
      "half the video walking POV looking down at the featured footwear on real streets, cut to him explaining to the camera why he keeps wearing it",
      "morning-to-evening cut: same shoes at breakfast, at work, at the store and back home, timestamped like a day-in-the-life",
    ],
    hooks: [
      "Les enseño {estas} {palabra} porque sí me sorprendieron.",
      "Ya llevo un rato usando {estas} {palabra}, va la opinión honesta.",
      "Andaba buscando {unas} {palabra} para el diario… y me quedé con {estas}.",
      "No soy de grabar esto, pero {estas} {palabra} lo valen.",
      "Compré {estas} {palabra} sin muchas expectativas. Me equivoqué.",
    ],
    cierres: [
      "Si buscas {unas} {palabra} de diario, {estas} cumplen.",
      "Compra que sí valió la pena.",
      "Sin tanto rollo: {recomendadas}.",
      "Yo ya hasta quiero otro par.",
    ],
  },
  {
    id: "de-viaje",
    etiqueta: "Me las llevé de viaje",
    tipos: ["sandalia", "sandalia_agua", "tenis", "mocasin"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      hombre: [
        "a relaxed Mexican man in his early 30s in shorts and a polo, travel-vlog style creator on a weekend getaway",
        "a Mexican man in his late 20s with a cap and backpack, budget-travel energy",
      ],
      mujer: [
        "a relaxed Mexican woman in her late 20s in summer clothes, travel-vlog style creator on a weekend getaway",
        "a Mexican woman in her early 30s with a sun hat and tote bag, effortless traveler",
      ],
    },
    escenas: [
      "inside a bright hotel room, small travel bag open on the bed, holding up the featured footwear to the camera mid-sentence",
      "sitting on the hotel bed putting on the featured footwear, suitcase and sunlight from the window behind",
      "on the hotel balcony with the phone at arm's length, featured footwear held up, warm destination behind",
      "at home the night before the trip, packing the small bag on the bed, the featured footwear going in first",
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
      "Tip de viaje que nadie pide pero todos necesitan.",
    ],
    motivos: [
      "No ocupan casi nada en la maleta y {las} termino usando para todo: bajar a desayunar, la alberca, caminar por ahí.",
      "Puedo caminar horas con {ellas} sin que me molesten, y con el calor se agradecen.",
      "Entre cargar cinco pares o algo que sirva para todo… me quedo con esto.",
      "Se ponen y se quitan en segundos: para el aeropuerto son lo máximo.",
    ],
    cierres: [
      "Lo más práctico que traigo.",
      "Viajar ligero, pero bien.",
      "Para un fin de semana así, es todo lo que necesitas.",
      "Maleta chica, cero sufrimiento.",
    ],
  },
  {
    id: "recien-llegaron",
    etiqueta: "Me acaban de llegar",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her 20s at home, genuinely excited about a delivery, casual clothes",
        "a Mexican woman in her 30s opening a package at the kitchen table, curious and honest",
      ],
      hombre: [
        "a Mexican man in his 30s at home, curious about a delivery, casual clothes",
        "a Mexican man in his 20s with the just-arrived box, skeptical-but-curious energy",
      ],
    },
    escenas: [
      "at the dining table with a just-opened shoe box, lifting the featured footwear out towards the camera",
      "sitting on the couch with the delivery box on the lap, holding the featured footwear up mid-sentence",
      "on the bedroom floor with the open box and wrapping paper around, showing the featured footwear to the camera",
      "at the front door holding the just-received package, about to open it, talking to the camera",
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
      "Unboxing rapidito porque no aguanté las ganas.",
      "Llegó mi pedido y lo abrimos juntos.",
    ],
    motivos: [
      "Se ven mejor que en las fotos, en serio: el material se siente bien y los detalles vienen limpios.",
      "Me {las} probé de una vez y la primera sensación es buenísima.",
      "El acabado se ve de calidad, mejor de lo que esperaba por el precio.",
      "Llegaron rapidísimo y bien empacadas, ni un rayón.",
    ],
    cierres: [
      "Primera impresión: {aprobadas}.",
      "Ahorita se los enseño {puestas} con calma.",
      "Ya les contaré cómo se portan con el uso.",
      "Por lo pronto: cero arrepentimiento.",
    ],
  },
  {
    id: "un-mes-despues",
    etiqueta: "Un mes usándolos",
    tipos: ["bota", "bota_industrial", "tenis", "zapato", "mocasin", "sandalia"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a down-to-earth Mexican woman in her 30s giving an honest follow-up review, casual",
        "a Mexican woman in her 20s doing a 'one month later' update, direct and honest",
      ],
      hombre: [
        "a down-to-earth Mexican man in his 30s giving an honest follow-up review, casual",
        "a Mexican man in his 40s, no-nonsense, showing how the shoes held up",
      ],
    },
    escenas: [
      "in the living room holding the featured footwear up to the camera, showing it after weeks of real use",
      "sitting on the doorstep of the house wearing the featured footwear, relaxed, phone at arm's length",
      "by the shoe rack at home, picking the featured footwear out from the others to show the camera",
      "outdoors on a sidewalk holding the featured footwear sole towards the camera, daylight",
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
      "Actualización del par que les enseñé hace un mes.",
    ],
    motivos: [
      "Se siguen viendo prácticamente {nuevas}, y eso que no {las} he cuidado nada.",
      "La suela no se ha deformado y siguen igual de {comodas} que el primer día.",
      "Uso diario, sin consentirlas… y aquí siguen, firmes.",
      "Ni una costura abierta, ni despegues, nada.",
    ],
    cierres: [
      "Veredicto: sí valen.",
      "Un mes después: {recomendadas}.",
      "Si dudaban, ahí está la respuesta.",
      "Pasaron la prueba del uso real.",
    ],
  },
  {
    id: "dia-de-alberca",
    etiqueta: "Día de alberca",
    tipos: ["sandalia_agua"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her 20s in a swimsuit cover-up at a pool, casual vlog style",
        "a Mexican mom in her 30s at a family pool day, towel over the shoulder",
      ],
      hombre: [
        "a Mexican man in his 30s in swim shorts and a t-shirt at a pool, casual vlog style",
        "a Mexican man in his 20s heading to the beach, backpack and towel",
      ],
    },
    escenas: [
      "at the edge of a community pool with towels around, wearing the featured sandals, phone held selfie-style",
      "sitting at the pool steps putting on the featured sandals, water sparkling behind",
      "walking on the wet pool deck towards the camera in the featured sandals, mid-sentence",
      "at the bathroom getting the pool bag ready, featured sandals in hand, talking to the propped phone",
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
      "Se resbalan en la alberca porque quieren.",
    ],
    cierres: [
      "Verano resuelto.",
      "Las de agua que sí sirven.",
      "Alberca, playa, regadera… sirven para todo.",
      "Y sin patinar en todo el día.",
    ],
  },
  {
    id: "dia-de-oficina",
    etiqueta: "Día de oficina",
    tipos: ["mocasin", "zapato", "tacon"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican office worker in her late 20s in business-casual clothes, commuting energy",
        "a Mexican woman in her 30s in slacks and a blouse, coffee in hand, realistic office vibe",
      ],
      hombre: [
        "a Mexican office worker in his 30s in a shirt and chinos, morning commute energy",
        "a Mexican man in his late 20s with a laptop bag, business-casual, practical",
      ],
    },
    escenas: [
      "at home in office clothes putting on the featured footwear before leaving, bag ready by the door",
      "in an office hallway or elevator, phone at arm's length, featured footwear visible",
      "at the office desk stretching a foot out to show the featured footwear under the desk",
    ],
    narrativas: [
      "office day: puts the featured footwear on at home, commute clips — walking to the car or transit — the office hallway, and at the end of the day still comfortable, told to the camera on the way home",
      "the 8-hour test: quick cuts through the workday, morning coffee, meetings, errands at lunch — the featured footwear in frame at every step, final verdict walking home",
      "she explains to the camera why office shoes used to hurt and how these changed it, showing the featured footwear from her desk",
    ],
    hooks: [
      "Ocho horas de oficina con {estas} {palabra}: les cuento.",
      "El que trabaja en oficina sabe que esto importa más que la silla.",
      "Encontré {unas} {palabra} que aguantan la jornada SIN matarte.",
      "Día de oficina, cero pies destrozados. Les explico.",
    ],
    motivos: [
      "Se ven formales pero se sienten como tenis: llego al final del día sin dolor.",
      "Aguantan juntas, pendientes, subir y bajar… y siguen {comodas}.",
      "Nadie nota que son las mismas de diario, y mis pies lo agradecen.",
    ],
    cierres: [
      "La jornada completa, sin sufrir.",
      "Adiós al 'ya quiero llegar a quitármelos'.",
      "Para la oficina: {aprobadas}.",
    ],
  },
  {
    id: "dia-de-mandado",
    etiqueta: "Día de mandado",
    tipos: ["tenis", "sandalia", "zapato"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her 30s with a market tote bag, running errands, practical clothes",
        "a Mexican mom in her late 20s with shopping bags, real-life energy",
      ],
      hombre: [
        "a Mexican man in his 30s with grocery bags, cap on, errand-day mode",
        "a Mexican man in his 40s at the local market, practical and unhurried",
      ],
    },
    escenas: [
      "at the front door with a market tote, putting on the featured footwear before heading out",
      "walking through a local street market towards the camera, featured footwear visible, bags in hand",
      "loading groceries in the car trunk, phone propped, glancing down at the featured footwear",
    ],
    narrativas: [
      "errand day: super, market, bank, pharmacy — quick clips walking everywhere in the featured footwear, counting the steps out loud, ending home with the bags and feet still fine",
      "the market run: real streets, real crowds, POV of the feet dodging puddles and curbs in the featured footwear, verdict to the camera on the way back",
      "she narrates the day while walking: how many blocks, how many hours, and how the featured footwear held up through all of it",
    ],
    hooks: [
      "Hoy toca mandado… y estos son los {palabra} correctos.",
      "Quince mil pasos después, les debo esta reseña.",
      "El mandado se hace caminando, y para eso están {estas}.",
      "Sábado de mercado: vean con qué ando.",
    ],
    motivos: [
      "Horas caminando, cargando bolsas… y los pies como si nada.",
      "Agarran bien en banqueta, mercado y donde sea.",
      "Se limpian fácil aunque el mandado se ponga rudo.",
    ],
    cierres: [
      "Mandado terminado, pies contentos.",
      "Para el trajín diario, no hay pierde.",
      "Los del mandado oficiales.",
    ],
  },
  {
    id: "todo-el-dia-de-pie",
    etiqueta: "Trabajo de pie todo el día",
    tipos: ["tenis", "zapato", "mocasin"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her 20s in a work polo, someone who spends the whole shift standing",
        "a Mexican nurse or shop attendant in her 30s, tired but upbeat, end-of-shift energy",
      ],
      hombre: [
        "a Mexican man in his 30s in a work polo, someone who spends the whole shift standing",
        "a Mexican waiter or shop attendant in his 20s, quick break energy",
      ],
    },
    escenas: [
      "in a break room or back-of-store, sitting for a quick break, tilting the featured footwear to the camera",
      "at home before the shift, putting on the featured footwear, uniform ready",
      "at the end of the shift by the door, phone at arm's length, pointing at the featured footwear",
    ],
    narrativas: [
      "shift day: puts the featured footwear on before work, mid-shift check-in during the break, end-of-shift verdict walking home — the whole day standing and the feet still fine",
      "he talks straight to the camera on a break: how many hours standing, what used to hurt, and why he switched to the featured footwear — with a close-up of the cushioning",
      "day-in-the-life of someone who works standing: opening the store, hours passing on a clock overlay style, the featured footwear at every cut",
    ],
    hooks: [
      "Si trabajas de pie TODO el día, esto te interesa.",
      "Diez horas de pie diario. Estos son los {palabra} que lo aguantan.",
      "Mi trabajo es estar parado… y esto me salvó los pies.",
      "A la mitad del turno y los pies siguen bien: les explico.",
    ],
    motivos: [
      "El acolchado de verdad aguanta la jornada; no se aplana a las dos horas.",
      "Desde que {las} uso, se acabó el llegar a casa arrastrando los pies.",
      "Firmes, ligeros y respiran: justo lo que pide un turno completo.",
    ],
    cierres: [
      "Los pies te lo van a agradecer.",
      "Para trabajar de pie: {recomendadas}.",
      "El turno se aguanta mejor así.",
    ],
  },
  {
    id: "aguantan-trabajo",
    etiqueta: "Aguantan el trabajo",
    tipos: ["bota_industrial"],
    publicos: ["hombre"],
    perfiles: {
      hombre: [
        "a Mexican worker in his 30s in a reflective vest or work shirt, jobsite background, straight talker",
        "a Mexican man in his 40s in dusty jeans and work gloves hanging from the pocket, workshop energy",
        "a Mexican technician in his late 20s with a tool bag, before-the-shift energy",
      ],
      mujer: [
        "a Mexican woman in her 30s in work gear, jobsite background, straight talker",
      ],
    },
    escenas: [
      "sitting on the tailgate of a pickup truck lacing the featured work boots, jobsite behind",
      "at the workshop entrance holding the featured boots up to the camera, tools behind",
      "early morning at home in work clothes, putting on the featured boots by the door",
    ],
    narrativas: [
      "workday test: laces the featured boots at dawn, clips through the shift — gravel, ladders, wet floor — one close-up of the sole grabbing, end-of-day verdict sitting on the truck",
      "he shows the featured boots in his hands pointing at the reinforced stitching and the sole, puts them on and walks the jobsite naturally — no posing, just work",
      "the two-boots story: shows a destroyed cheap pair next to the featured boots, makes the math of buying twice, then wears the featured ones to work",
    ],
    hooks: [
      "En el trabajo no anda uno con {palabra} de juguete.",
      "Me duraban tres meses las botas… hasta que llegué a {estas}.",
      "Para la obra, esto es lo que sí aguanta.",
      "El que trabaja parado en obra sabe lo que vale una buena bota.",
    ],
    cierres: [
      "Para trabajar: {estas} y ya.",
      "Herramienta que va en los pies.",
      "Lo barato sale caro; esto sale a cuenta.",
      "Al jale se va uno bien calzado.",
    ],
  },
  {
    id: "dia-de-lluvia",
    etiqueta: "Día de lluvia",
    tipos: ["bota", "bota_industrial", "tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her 20s with an umbrella by the window, rainy day at home",
        "a Mexican woman in her 30s in a raincoat at the doorway, street wet behind",
      ],
      hombre: [
        "a Mexican man in his 30s at the doorway watching the rain, jacket on",
        "a Mexican man in his 20s under an awning on a wet street, casual",
      ],
    },
    escenas: [
      "at the doorway with rain visible behind, putting on the featured footwear before going out",
      "under an awning on a wet street, holding the phone, featured footwear visible on wet pavement",
      "by the window with rain falling outside, holding up the featured footwear to the camera",
    ],
    narrativas: [
      "rainy-day test: puts the featured footwear on and goes out anyway — wet sidewalks, puddles dodged and one stepped in, close-up of the sole on wet pavement — comes back with dry feet and tells the camera",
      "the commute in the rain: bus stop, wet streets, quick clips of the featured footwear handling it, end verdict taking them off at home and showing the socks: dry",
      "she films the rain from the door, decides the errand can't wait, wears the featured footwear and narrates the walk through the wet streets",
    ],
    hooks: [
      "Está lloviendo… perfecto para probar {estas} {palabra}.",
      "El verdadero examen de {unas} {palabra}: un día como hoy.",
      "Llueve y hay que salir igual. Vean con qué.",
      "Charcos: 0. {palabra}: 1.",
    ],
    motivos: [
      "Pisé charcos y banquetas mojadas… y los calcetines secos.",
      "La suela agarra bien en piso mojado, nada de patinar.",
      "Ni el agua ni el lodo las despintan; se limpian y listo.",
    ],
    cierres: [
      "Lluvia aprobada.",
      "Ya puede llover lo que quiera.",
      "Secos, firmes y sin resbalones.",
    ],
  },
  {
    id: "se-los-regale",
    etiqueta: "Se los regalé",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her 30s wrapping or holding a shoe box as a gift, warm energy",
        "a Mexican woman in her 20s telling the story of a gift that was a hit",
      ],
      hombre: [
        "a Mexican man in his 30s holding a shoe box he is about to gift, casual",
        "a Mexican man in his 40s telling how he solved a birthday gift, practical humor",
      ],
    },
    escenas: [
      "at the dining table with the shoe box and gift wrap, holding the featured footwear up before wrapping it",
      "on the couch holding the open box towards the camera, telling the gift story",
      "at a store-pickup moment or with the delivery box, explaining who it is for",
    ],
    narrativas: [
      "the gift story: shows the featured footwear, explains who it is for and why this pair, wraps the box halfway through, and closes telling the reaction it got",
      "gift-hunting solved: she tells the camera how hard the person is to shop for, shows the featured footwear from every angle as 'the answer', packs it up",
      "unwrapped: the box is opened on camera as the gift moment is retold, close-ups of the details that made it the right choice",
    ],
    hooks: [
      "¿Regalo para alguien difícil? Ya lo resolví.",
      "Le regalé {estas} {palabra} y me quedé corta con la reacción.",
      "El regalo con el que SÍ quedas bien.",
      "Se acercaba el cumpleaños y esto fue lo que compré.",
    ],
    motivos: [
      "Un regalo que sí se usa a diario, no de los que se quedan en el clóset.",
      "La talla era mi miedo, pero el cambio fue fácil y quedaron perfectos.",
      "Se ven mucho más caros de lo que costaron: quedas de lujo.",
    ],
    cierres: [
      "Regalo {aprobadas} al cien.",
      "Quedé como reina con el regalo.",
      "Apunten para el próximo cumpleaños.",
      "De nada, por la idea.",
    ],
  },
  {
    id: "no-conocia-la-marca",
    etiqueta: "No conocía la marca",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a skeptical Mexican woman in her 30s who researches before buying, honest reviewer energy",
        "a Mexican woman in her 20s who almost didn't buy, telling the story",
      ],
      hombre: [
        "a skeptical Mexican man in his 30s who compares everything before buying, honest reviewer",
        "a Mexican man in his 40s who doubted an online purchase, plain talker",
      ],
    },
    escenas: [
      "at the desk with the phone propped, holding the featured footwear like presenting evidence",
      "on the couch with the featured footwear in hand, mid-story face, casual home behind",
      "by the shoe rack comparing the featured footwear against a known-brand pair",
    ],
    narrativas: [
      "the skeptic's story: tells the camera he had never heard of the brand, almost didn't buy, shows the featured footwear up close going over material, stitching and sole, and admits it beat his expectations — ends wearing them out",
      "compares the featured footwear against a famous-brand pair he owns: details side by side, price difference told out loud, honest verdict",
      "reads out loud a doubt he had before buying (sizing, quality), then answers it on camera showing the actual featured footwear",
    ],
    hooks: [
      "No conocía la marca… y casi no compro. Qué error hubiera sido.",
      "Marca mexicana que no conocía: GETAC. Les cuento.",
      "Compré con miedo y llegó esto.",
      "¿Vale la pena una marca que no conoces? Hoy sí.",
    ],
    motivos: [
      "Por el precio esperaba menos, y la calidad se siente igual o mejor que marcas conocidas.",
      "El material, las costuras, la suela… todo se ve cuidado, nada 'de imitación'.",
      "La talla llegó exacta y {las} estoy usando desde el día uno.",
    ],
    cierres: [
      "Ya no compro por el nombre, compro por esto.",
      "Marca nueva para mí: {aprobadas}.",
      "El riesgo valió toda la pena.",
      "GETAC, me sorprendieron.",
    ],
  },
  {
    id: "para-mis-hijos",
    etiqueta: "Para mis hijos",
    tipos: "todos",
    publicos: ["mujer"],
    soloNinos: true,
    perfiles: {
      mujer: [
        "a young Mexican mom in her early 30s at home, warm and practical, holding the kids' featured footwear (no children on camera)",
        "a Mexican mom in her late 20s by the washing machine or the shoe rack, real-mom energy, holding the kids' featured footwear (no children on camera)",
      ],
      hombre: [
        "a young Mexican dad in his 30s at home holding the kids' featured footwear (no children on camera)",
      ],
    },
    escenas: [
      "in the living room holding up the small featured footwear to the camera, toys visible in the background",
      "by the shoe rack full of family shoes, picking up the kids' featured footwear to show it",
      "at the dining table with the school backpack beside, showing the featured footwear to the camera",
    ],
    narrativas: [
      "mom review: she shows the kids' featured footwear up close — the sole, the closure, how easy it opens — explains what it survives (school, park, bikes) and how it washes, all told to the camera with no children shown",
      "the school-shoes talk: she compares how fast other pairs died, shows the featured footwear details and why this one lasts, ends putting it in the backpack for tomorrow",
      "she demonstrates with her hands how easily the featured footwear opens and closes and how solid the sole is, telling anecdotes of what her kid puts shoes through",
    ],
    hooks: [
      "Las mamás me van a entender: los niños DESTRUYEN zapatos.",
      "Encontré los {palabra} que sí le aguantan a mi hijo.",
      "Se los compré a mi hija sin muchas esperanzas… y mírenlos.",
      "El uniforme sobrevive, los zapatos no. Bueno, estos sí.",
    ],
    motivos: [
      "Aguantan escuela, parque y bici… y siguen enteros.",
      "Se los pone él solito: el cierre es facilísimo.",
      "Se lavan y quedan como nuevos, sin despegarse.",
      "La suela agarra bien y no anda resbalándose en el patio.",
    ],
    cierres: [
      "Mamás: apunten.",
      "Por fin unos que duran más que el ciclo escolar.",
      "Los niños felices, y yo más.",
      "Aprobados por el mío, que es el crash test más rudo.",
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

/** El público del guion: sin género, mujer. */
function publicoDe(genero: Genero): Publico {
  return genero === "hombre" ? "hombre" : "mujer";
}

function aplicaTipo(c: Concepto, tipo: TipoCalzado): boolean {
  return c.tipos === "todos" || c.tipos.includes(tipo);
}

/**
 * Arma el concepto completo para un tipo + género + semilla. Determinista:
 * el 🎲 (semilla nueva) cambia concepto, perfil, escena, narrativa y guion a
 * la vez. Para calzado de niños solo aplican los conceptos de mamá/papá
 * (nunca se generan menores).
 */
export function armarConceptoUGC(datos: {
  tipo: TipoCalzado;
  genero: Genero;
  semilla: number;
}): ConceptoArmado {
  const publico = publicoDe(datos.genero);
  const esNinos = datos.genero === "nino";
  const candidatos = CONCEPTOS.filter(
    (c) =>
      aplicaTipo(c, datos.tipo) &&
      c.publicos.includes(publico) &&
      Boolean(c.soloNinos) === esNinos,
  );
  // Red de seguridad: unboxing (adultos) o el concepto de mamá (niños).
  const pool = candidatos.length
    ? candidatos
    : CONCEPTOS.filter((c) => c.id === (esNinos ? "para-mis-hijos" : "recien-llegaron"));
  const concepto = elegir(pool, datos.semilla, 11);

  const perfiles = concepto.perfiles[publico];
  const perfil = elegir(perfiles.length ? perfiles : concepto.perfiles.mujer, datos.semilla, 31);
  const escena = elegir(concepto.escenas, datos.semilla, 13);
  const narrativaBase = elegir(concepto.narrativas, datos.semilla, 17);
  const hook = elegir(concepto.hooks, datos.semilla, 19);
  const motivo = elegir(concepto.motivos ?? MOTIVOS[datos.tipo], datos.semilla, 23);
  const cierre = elegir(concepto.cierres, datos.semilla, 29);

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
