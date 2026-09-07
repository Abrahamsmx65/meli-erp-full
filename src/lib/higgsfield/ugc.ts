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
import { CONCEPTOS_EXTRA } from "./conceptos-extra";

// El mismo candado de siempre + la regla anti-inventos del brief.
const CANDADO_UGC =
  " STRICT RULE: the featured footwear must remain EXACTLY as shown in the reference " +
  "image — same design, shape, proportions, colors, materials, textures, stitching, " +
  "sole and logos. Do not redesign, replace, morph or restyle it, and do not invent " +
  "additional logos, text, buckles or design elements. The product can be picked " +
  "up, worn and walked in naturally, but it is handled gently — never tossed, " +
  "shaken or spun fast — and it never morphs. No on-screen text of any kind: no " +
  "subtitles, no captions, no labels, no watermarks (AI-rendered text comes out " +
  "misspelled).";

// Imperfecciones que hacen que NO parezca anuncio generado.
const IMPERFECCIONES =
  " Filmed as ONE single continuous take: no cuts, no jump transitions, no " +
  "teleporting — but real motion is welcome: the person moves, walks, bends and acts " +
  "naturally while the handheld camera follows smoothly with slow pans and tilts, " +
  "all within the same continuous space. Fluid, natural rhythm; natural speech " +
  "pauses, ordinary lighting, normal home imperfections. Genuine TikTok/Reels " +
  "energy — NOT an ad, NOT cinematic, no fashion-model posing, no floating product " +
  "shots.";

/**
 * El estilo fijo de la marca (pedido del usuario): creador "whitexican" —
 * fresa mexicano de clase alta, aspiracional. Se aplica a TODOS los
 * personajes del UGC y del Studio: look pulido, outfit casual premium,
 * locación moderna y luminosa.
 */
export const ESTILO_PERSONA =
  "with an upscale Mexican 'fresa' (whitexican) vibe: light-skinned, polished and " +
  "well-groomed, quiet-luxury casual outfit, upscale modern Mexican home or setting " +
  "with beautiful natural light, aspirational lifestyle-creator energy";

/**
 * Cómo debe SONAR la voz: de corrido y fluida. El usuario reportó que el
 * audio salía un poco entrecortado; esta instrucción va en todos los
 * prompts que generan voz.
 */
export const VOZ_FLUIDA =
  "The vocal delivery is smooth and flowing: sentences connect naturally in one " +
  "relaxed conversational rhythm with soft natural breaths, never robotic, choppy, " +
  "over-enunciated or with awkward gaps between phrases. The speaker is a NATIVE " +
  "Mexican Spanish speaker: never mix in English or Portuguese words or " +
  "pronunciations (say 'sandalias', never 'sandals'; 'ampollas', never 'ampolas'), " +
  "and pronounce every Spanish word completely and correctly";

// ---------------------------------------------------------------------------
// Rasgos del producto: lo que el TÍTULO dice que el producto ES. Con ellos
// el guion habla del frío si son pantuflas térmicas, de la lluvia si son
// impermeables, del trabajo si traen casquillo — nunca de ocasiones
// genéricas que no le corresponden al producto.
// ---------------------------------------------------------------------------

const DETECTORES_RASGOS: { rasgo: string; regex: RegExp }[] = [
  { rasgo: "frio", regex: /t[ée]rmic|borreg|invierno|fr[íi]o|polar|afelpad|peluch|calientit|forr(o|ad)|abrigad/i },
  { rasgo: "calor", regex: /fresc[ao]|verano|playa|ventilad|para calor/i },
  { rasgo: "lluvia", regex: /impermeable|waterproof|lluvia|contra agua/i },
  { rasgo: "navidad", regex: /navid|christmas|reno|noel|nieve|festiv/i },
  { rasgo: "seguridad", regex: /casquillo|diel[ée]ctric|seguridad|industrial/i },
  { rasgo: "confort", regex: /memory foam|acolchad|confort|ortop[ée]dic|descanso|plantilla suave|gel/i },
  { rasgo: "antiderrapante", regex: /antiderrapante|antidesliz/i },
  { rasgo: "piel", regex: /piel genuina|100 ?% piel|cuero genuino|piel aut[ée]ntica/i },
];

/** Qué rasgos trae el producto según su título/modelo. */
export function detectarRasgos(texto: string): string[] {
  return DETECTORES_RASGOS.filter((d) => d.regex.test(texto)).map((d) => d.rasgo);
}

/** Conceptos incompatibles: pantuflas de frío jamás van a la alberca. */
const CONFLICTOS_RASGO: Record<string, string[]> = {
  frio: ["calor"],
  navidad: ["calor"],
  calor: ["frio", "navidad"],
};

/** GANCHOS originales por rasgo (los primeros 2 segundos del guion). */
const GANCHOS_RASGO: Record<string, string[]> = {
  frio: [
    "Bajó la temperatura y yo subí de nivel.",
    "El frío llegó sin avisar; yo sí estaba preparada.",
    "Hay dos tipos de personas en invierno: las que sufren el piso helado… y yo.",
    "Mis pies no vuelven a pasar frío este año, lo juré.",
    "Diciembre a las 6 de la mañana no me vuelve a agarrar desprevenida.",
    "¿Sienten ese friíto? Yo ya no.",
  ],
  calor: [
    "Con este calorón, esto es lo ÚNICO que aguanto en los pies.",
    "35 grados y mis pies frescos como lechuga, les cuento.",
    "El verano exige pies libres; yo obedezco.",
    "Si el clima está de playa, los pies también.",
    "Contra el calor no se lucha: se viste uno inteligente.",
  ],
  lluvia: [
    "Empezó la temporada de lluvias y por fin no me importa.",
    "Charco que veo, charco que piso. Sin miedo.",
    "El pronóstico dice tormenta; mis pies dicen 'qué bueno'.",
    "Antes le sacaba la vuelta a la lluvia; ahora hasta se me antoja.",
    "Se mojó TODO… menos mis calcetines.",
  ],
  navidad: [
    "Ya huele a ponche, a tamales… y a regalos bien elegidos.",
    "Este año el intercambio lo gano yo, se los adelanto.",
    "Diciembre es de posadas, y a las posadas se va calientito.",
    "¿Ya tienen el regalo de mamá? Porque yo ya, y van a querer copiarme.",
    "La temporada más bonita del año merece los pies más consentidos.",
    "Santa ya no tiene que traerlos: ya llegaron.",
  ],
  seguridad: [
    "En mi trabajo los errores cuestan; el calzado no puede ser uno.",
    "Antes de tocar una herramienta, revisa lo que traes en los pies.",
    "El equipo de seguridad empieza desde abajo, literal.",
    "Un buen día de chamba empieza con buen calzado; uno malo, con el equivocado.",
    "Esto no es moda: es lo que me deja volver entero a casa.",
  ],
  confort: [
    "Mis pies llevaban años pidiendo esto y yo sin escuchar.",
    "La comodidad no se presume… bueno, sí, ahorita.",
    "Probé mil cosas para el dolor de pies; la respuesta era más simple.",
    "Caminar debería sentirse así SIEMPRE.",
    "Hay compras de gusto y compras de calidad de vida. Esta es la segunda.",
  ],
  antiderrapante: [
    "Piso mojado, jabón, prisa… y yo tan tranquila.",
    "El resbalón que NO me di, gracias a esto.",
    "En mi casa ya nadie patina, y les digo por qué.",
  ],
  piel: [
    "Piel de verdad se nota a un metro de distancia.",
    "Lo barato se cuartea; la piel genuina envejece bonito.",
    "Tócenlos… bueno no pueden, pero créanme: es piel piel.",
  ],
};

/** MOTIVOS originales por rasgo (el porqué comprar, en español). */
const MOTIVOS_RASGO: Record<string, string[]> = {
  frio: [
    "La borrega de adentro es calientita de verdad, no de foto.",
    "Guardan el calor sin que sude el pie: el equilibrio perfecto.",
    "El piso helado de la madrugada ya no se siente NADA.",
    "Son como traer los pies en cobija, pero pudiendo caminar.",
    "Aguantan el invierno entero sin aplastarse ni deformarse.",
    "Del sillón a la cama sin que se enfríe ni un dedo.",
    "El forro abriga hasta en los días de 5 grados.",
    "Té caliente en la mano, pies calientes abajo: felicidad completa.",
    "Para las noches de diciembre no existe nada mejor.",
    "Se sienten calientitas desde el segundo uno, sin 'entrar en calor'.",
  ],
  calor: [
    "El pie respira todo el día: cero sudor, cero olores.",
    "Ligeras como andar descalza, pero con suela de verdad.",
    "El material no se calienta ni dejándolas al sol.",
    "Frescura de alberca en plena ciudad.",
    "Ni con 40 grados se sienten pegajosas.",
  ],
  lluvia: [
    "El agua resbala y el pie queda seco, aunque llueva parejo.",
    "Pisé tres charcos de camino y llegué con calcetines secos.",
    "La suela agarra en piso mojado como si nada.",
    "Se secan rapidísimo: mañana están listas otra vez.",
    "La costura sellada no deja pasar ni una gota.",
    "Temporada de lluvias completa y siguen como nuevas.",
  ],
  navidad: [
    "Es EL regalo que sí se usa: diario, no una vez al año.",
    "Calientitas para las posadas y presentables para la cena.",
    "El intercambio tiene presupuesto, y estas entran perfecto.",
    "A la abuela le regalé unas iguales y no se las quita.",
    "Vienen tan bonitas que ni hay que envolverlas… bueno, sí.",
    "Diciembre es frío, cena y familia: van con las tres cosas.",
  ],
  seguridad: [
    "El casquillo protege sin que la bota pese como ladrillo.",
    "Cumplen norma y aun así llegas a casa con pies vivos.",
    "El antiderrapante agarra en aceite, agua y polvo fino.",
    "Costura reforzada: seis meses de obra y ni una despegada.",
    "La inversión que se paga con cada golpe que NO llega.",
  ],
  confort: [
    "La plantilla abraza el arco justo donde duele el día.",
    "Es memory foam de verdad: recuerda tu pisada, no la caja.",
    "Ocho horas de pie y la espalda ni se quejó.",
    "Amortiguan cada paso; las rodillas lo agradecen a gritos.",
    "Se sienten hechas a la medida desde el primer día.",
  ],
  antiderrapante: [
    "La suela se aferra al piso mojado como llanta nueva.",
    "Regadera, cocina o patio: cero patinadas.",
    "Diseñadas para pisos donde otros se van de lado.",
  ],
  piel: [
    "Piel genuina que se amolda al pie y dura años, no meses.",
    "Envejecen bonito: cada uso las deja mejor.",
    "El olor y el tacto de la piel real no se imitan.",
  ],
};

/** CIERRES originales por rasgo (el remate del guion). */
const CIERRES_RASGO: Record<string, string[]> = {
  frio: [
    "Que dure el frío: ya estoy lista.",
    "Invierno: 0. Mis pies: 1.",
    "Calientitos los pies, contenta la vida.",
    "Este invierno se pasa rico.",
  ],
  calor: [
    "Al calor se le gana desde los pies.",
    "Verano resuelto.",
    "Frescos hasta septiembre, mínimo.",
  ],
  lluvia: [
    "Que llueva: traigo ventaja.",
    "Lluvia sí, pies mojados no.",
    "La temporada de aguas ya no me asusta.",
  ],
  navidad: [
    "Feliz Navidad… para mis pies primero.",
    "Regalo resuelto, diciembre feliz.",
    "En esta casa, la Navidad llega calientita.",
    "Apúntenlo en la carta de deseos.",
  ],
  seguridad: [
    "Trabaja duro, pisa seguro.",
    "La seguridad no es gasto, es regreso a casa.",
    "Equipo completo, turno tranquilo.",
  ],
  confort: [
    "Mis pies por fin viven bien.",
    "La comodidad ya no se negocia.",
    "Caminar volvió a dar gusto.",
  ],
  antiderrapante: [
    "Firmes en cualquier piso.",
    "Cero resbalones este año: la meta.",
  ],
  piel: [
    "Calidad de la de antes.",
    "Piel real, compra real.",
  ],
};

/** Mezcla el material del rasgo (con doble peso) con el material base. */
function conRasgos(
  mapa: Record<string, string[]>,
  rasgos: string[],
  base: string[],
): string[] {
  const propios = rasgos.flatMap((r) => mapa[r] ?? []);
  return propios.length ? [...propios, ...propios, ...base] : base;
}

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

export type Publico = "mujer" | "hombre";

export interface Concepto {
  id: string;
  etiqueta: string;
  tipos: TipoCalzado[] | "todos";
  publicos: Publico[];
  /** Solo aparece para calzado de niños (presenta la mamá). */
  soloNinos?: boolean;
  /** Rasgos del producto con los que este concepto tiene afinidad. */
  rasgos?: string[];
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
    rasgos: ["confort", "frio"],
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
      "one continuous handheld take: sitting by the entryway she talks to the camera, slides her feet into the featured slippers, wiggles a foot up towards the lens and leans back with a relieved sigh",
      "one continuous take on the couch: she talks to the camera while holding up the featured slippers, puts them on without leaving the frame and stretches her feet towards the lens",
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
      "one continuous take in the kitchen: mug in one hand, she talks to the camera, tilts the phone down to show the featured slippers on her feet and smoothly back up",
      "one continuous take sitting on the edge of the bed: she slides into the featured slippers while talking, lifts one foot briefly to the camera and smiles",
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
      "one continuous mirror take: she talks to the phone in the mirror, gestures over the outfit from top to bottom and ends pointing both hands at the featured footwear, doing a small turn in place",
      "one continuous take sitting on the bed: she straps on the featured footwear while talking, then stands and the phone tilts smoothly down and up over the full outfit",
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
      "one continuous vanity take: she finishes a makeup touch, lifts the featured footwear into frame and talks about it with going-out excitement",
      "one continuous mirror take in the evening outfit: she talks, does one slow turn in place, and the phone tilts down to the featured footwear and smoothly back",
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
      "one continuous take sitting in the entryway: he laces the featured footwear while talking to the propped phone, stands up and taps the toe on the floor to make the point",
      "one continuous handheld take: he holds the featured footwear up, holds it firmly showing the sole and stitching while talking, then lowers it with a matter-of-fact shrug",
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
      "one continuous hotel-room take: he pulls the featured footwear out of the travel bag, holds it up to the camera while talking and sets it by the bed ready for tomorrow",
      "one continuous balcony take: phone at arm's length, he talks about the trip and lifts the featured footwear into frame, warm sunlight behind",
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
      "one continuous unboxing take: the box opens on camera, honest first reaction, the featured footwear comes up close to the lens, held firmly with a very slight tilt while talking",
      "one continuous take on the couch: lid off, paper aside, the featured footwear held up firmly near the camera with a nod of approval while talking",
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
      "one continuous take: the featured footwear held up close to the camera, fingers pointing at the sole and stitching while talking, keeping the shoe firm and steady to show it still holds up",
      "one continuous doorstep take: wearing the featured footwear, he talks to the phone and tilts it down to show them on-feet and smoothly back up",
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
    rasgos: ["calor"],
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
      "one continuous poolside selfie take: she talks while walking slowly along the wet deck, tilts the phone down to the featured sandals gripping the floor and smoothly back up",
      "one continuous take at the pool steps: she slides the featured sandals on while talking, stands and taps the wet floor to show they do not slip",
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
      "one continuous take by the door in office clothes: she puts the featured footwear on while talking, stands straight and smooths the outfit, ready to leave",
      "one continuous desk take: she stretches a foot into frame showing the featured footwear while telling the camera about the workday",
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
      "one continuous take at the door with the tote bag: she talks while slipping on the featured footwear, lifts the bag and reaches for the handle without a cut",
      "one continuous slow walking take on a real sidewalk: phone at arm's length, bags in the other hand, she talks and briefly tilts the phone to the featured footwear mid-stride",
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
    rasgos: ["confort"],
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
      "one continuous break-room take: sitting for a quick break he talks to the camera, lifts one foot to show the featured footwear and rolls the ankle",
      "one continuous end-of-shift take by the door: tired but fine, he points down at the featured footwear and the phone tilts to them and smoothly back while he talks",
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
    rasgos: ["seguridad"],
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
      "one continuous tailgate take: sitting on the truck he laces the featured boots while talking straight to the propped phone, slaps the toe cap and stands",
      "one continuous workshop take: he holds the featured boots up, holds them firmly showing the sole tread while talking, and sets them down to make the point",
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
    rasgos: ["lluvia"],
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
      "one continuous doorway take with rain visible behind: he talks while putting the featured footwear on, then looks down as the phone smoothly follows to the shoes and back",
      "one continuous take under an awning: rain falling behind, he lifts one foot showing the featured footwear sole to the lens while talking",
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
    rasgos: ["navidad"],
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
      "one continuous table take: the featured footwear beside gift wrap, she holds it up to the camera while telling the story, then lays it on the paper ready to wrap",
      "one continuous couch take: box on the lap, she opens it towards the camera and holds the featured footwear up while retelling the reaction it got",
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
      "one continuous desk take: she holds the featured footwear like evidence, holds it firmly near the lens going over material and stitching while talking, then sets it down with a convinced nod",
      "one continuous take by the shoe rack: the featured footwear in one hand and a known-brand pair in the other, raising each while talking, ending with the featured one up close",
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
      "one continuous living-room take: she holds the kids' featured footwear up, opens and closes the closure with one hand while talking, and flexes the sole to show it (no children on camera)",
      "one continuous take by the shoe rack: she picks up the kids' featured footwear, holds it firmly near the lens showing what survives school and park, still talking (no children on camera)",
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
  // El paquete grande de escenarios vive aparte para no inflar este archivo.
  ...CONCEPTOS_EXTRA,
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
  /** Título/modelo del producto: de aquí salen sus RASGOS (térmico, impermeable…). */
  texto?: string;
  /** Guion largo (video de 30 s): gancho + TRES motivos + cierre. */
  largo?: boolean;
}): ConceptoArmado {
  const publico = publicoDe(datos.genero);
  const esNinos = datos.genero === "nino";
  const rasgos = detectarRasgos(datos.texto ?? "");
  const prohibidos = rasgos.flatMap((r) => CONFLICTOS_RASGO[r] ?? []);
  const candidatos = CONCEPTOS.filter(
    (c) =>
      aplicaTipo(c, datos.tipo) &&
      c.publicos.includes(publico) &&
      Boolean(c.soloNinos) === esNinos &&
      // Un producto de frío jamás cuenta un día de alberca (y viceversa).
      !(c.rasgos ?? []).some((r) => prohibidos.includes(r)),
  );
  // Red de seguridad: unboxing (adultos) o el concepto de mamá (niños).
  let pool = candidatos.length
    ? candidatos
    : CONCEPTOS.filter((c) => c.id === (esNinos ? "para-mis-hijos" : "recien-llegaron"));
  // Afinidad: los conceptos que hablan del rasgo del producto pesan doble
  // (aprox. la mitad de las tiradas), sin matar la variedad del resto.
  const afines = pool.filter((c) => (c.rasgos ?? []).some((r) => rasgos.includes(r)));
  if (afines.length && afines.length < pool.length) {
    const peso = Math.max(1, Math.round(pool.length / afines.length) - 1);
    pool = [...pool, ...Array.from({ length: peso }, () => afines).flat()];
  }
  const concepto = elegir(pool, datos.semilla, 11);

  const perfiles = concepto.perfiles[publico];
  const perfil = elegir(perfiles.length ? perfiles : concepto.perfiles.mujer, datos.semilla, 31);
  const escena = elegir(concepto.escenas, datos.semilla, 13);
  const narrativaBase = elegir(concepto.narrativas, datos.semilla, 17);
  const hook = elegir(conRasgos(GANCHOS_RASGO, rasgos, concepto.hooks), datos.semilla, 19);
  const motivo = elegir(
    conRasgos(MOTIVOS_RASGO, rasgos, concepto.motivos ?? MOTIVOS[datos.tipo]),
    datos.semilla,
    23,
  );
  const cierre = elegir(conRasgos(CIERRES_RASGO, rasgos, concepto.cierres), datos.semilla, 29);

  // Para 30 segundos el guion lleva TRES motivos distintos (sin repetir).
  const motivosPool = conRasgos(MOTIVOS_RASGO, rasgos, concepto.motivos ?? MOTIVOS[datos.tipo]);
  const motivosLargos: string[] = [motivo];
  for (const sal of [41, 43, 47, 53, 59]) {
    if (motivosLargos.length >= 3) break;
    const extra = elegir(motivosPool, datos.semilla, sal);
    if (!motivosLargos.includes(extra)) motivosLargos.push(extra);
  }

  const promptImagen =
    `Photo edit task: keep the EXACT footwear from the provided photo completely ` +
    `untouched and build a realistic scene around it. The scene: ${perfil}, ${ESTILO_PERSONA}, ${escena}, ` +
    `holding or wearing that exact footwear, clearly visible. The result must look ` +
    `like a frame grab from a casual vertical 9:16 phone video: full body or ` +
    `three-quarter body in frame, ordinary lighting, slightly imperfect framing, mild ` +
    `phone-camera grain, real unretouched skin — a regular person's TikTok clip, ` +
    `amateur and spontaneous. NO studio lighting, NO advertising polish, NO cinematic ` +
    `look, NO posing.` + CANDADO_UGC;

  const narrativa =
    `Authentic vertical 9:16 UGC video filmed naturally on a smartphone: ${perfil}, ${ESTILO_PERSONA}. ` +
    `${narrativaBase}.` + IMPERFECCIONES;

  const guionSugerido = llenar(
    datos.largo
      ? `${hook} ${motivosLargos.join(" ")} ${cierre}`
      : `${hook} ${motivo} ${cierre}`,
    datos.tipo,
  );

  return { id: concepto.id, etiqueta: concepto.etiqueta, promptImagen, narrativa, guionSugerido };
}


/** Quién entra a cuadro cuando el video arranca de la foto real. */
function personaDesdeFoto(genero: Genero): string {
  if (genero === "hombre") {
    return "a friendly regular Mexican man in his early 30s in casual everyday clothes";
  }
  if (genero === "nino") {
    return "a friendly young Mexican mom in her early 30s in casual everyday clothes";
  }
  return "a friendly regular Mexican woman in her late 20s in casual everyday clothes";
}

/** Cómo entra la persona a cuadro sin romper la escena de la foto. */
const ENTRADAS = [
  "a hand reaches gently into the frame and picks up the footwear, then the person leans into frame holding it firmly at chest height",
  "the person steps calmly into frame from the side, picks up the footwear and holds it firmly towards the camera",
  "the person leans down into frame, lifts the footwear carefully with both hands and settles it steady near their chest",
];

/**
 * Prompt del UGC con voz de IA en UNA sola etapa: el video ARRANCA
 * exactamente de la foto real del producto (primer cuadro = tu foto, sin
 * IA de por medio) y la persona entra a cuadro a levantarlo. Es la única
 * forma en esta API de que el producto salga idéntico: Soul lo redibujaba
 * y no existe ningún modelo de edición con la llave.
 */
export function promptUGCDesdeFoto(datos: {
  tipo: TipoCalzado;
  genero: Genero;
  semilla: number;
  guion: string;
}): string {
  const entrada = elegir(ENTRADAS, datos.semilla, 37);
  const persona = `${personaDesdeFoto(datos.genero)}, ${ESTILO_PERSONA}`;
  const limpio = datos.guion.trim().replace(/"/g, "'");
  return (
    `The video starts EXACTLY on the provided real product photo — the first frame is ` +
    `identical to it. Then ${entrada}: ${persona}. They look into the camera with ` +
    `natural engaging expressions and talk in upper-class Mexican Spanish with a relaxed 'fresa' accent (natural fillers like 'o sea', 'súper', 'literal' — never caricatured) and accurate lip ` +
    `sync, like recommending the product to a friend, saying EXACTLY this script, ` +
    `word for word, in correct Spanish without changing or inventing words: ` +
    `"${limpio}". ${VOZ_FLUIDA}. While ` +
    `talking they can show it closer to the lens, put it on and take a few natural ` +
    `steps as the handheld camera follows smoothly — everything in ONE single ` +
    `continuous take within the same continuous space: no cuts, no jump transitions, ` +
    `no teleporting, fluid smooth motion, natural speech pauses. It must feel like a ` +
    `real person's TikTok recommendation — NOT an ad, NOT cinematic, no posing.` +
    CANDADO_UGC
  );
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
    ` The person talks directly to the camera in upper-class Mexican Spanish with a relaxed 'fresa' accent (natural fillers like 'o sea', 'súper', 'literal' — never caricatured) and accurate ` +
    `lip sync, like recommending the footwear to a friend, saying EXACTLY this ` +
    `script, word for word, in correct Spanish without changing or inventing ` +
    `words: "${limpio}". ${VOZ_FLUIDA}.` +
    CANDADO_UGC
  );
}
