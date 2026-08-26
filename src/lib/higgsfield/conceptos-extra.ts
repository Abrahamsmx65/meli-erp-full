/**
 * El paquete GRANDE de conceptos UGC: cien escenarios más, en hombre y en
 * mujer, para todos los tipos de producto. Misma mecánica que los conceptos
 * base de ugc.ts: perfiles/escenas/narrativas en inglés (van al modelo),
 * ganchos y cierres en español con {tokens} de concordancia, y todo elegido
 * determinísticamente con la semilla del 🎲.
 *
 * Reglas de la casa: nunca menores en cámara (los conceptos de niños los
 * presenta la mamá o el papá), el producto jamás se rediseña, y los guiones
 * usan SOLO los tokens que `llenar()` conoce.
 */

import type { Concepto } from "./ugc";

export const CONCEPTOS_EXTRA: Concepto[] = [
  // -------------------------------------------------------------------------
  // Pantuflas: la vida en casa
  // -------------------------------------------------------------------------
  {
    id: "domingo-de-pelis",
    etiqueta: "Domingo de pelis",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a hoodie and joggers, settled in for a movie marathon",
        "a Mexican woman in her 30s under a blanket corner, popcorn bowl nearby, cozy Sunday energy",
      ],
      hombre: [
        "a Mexican man in his early 30s in a t-shirt and sweatpants, remote in hand, Sunday mode",
        "a Mexican man in his late 20s on the couch with snacks, relaxed weekend energy",
      ],
    },
    escenas: [
      "on the living room couch with the TV glowing in the background, blanket half on, showing the featured slippers to the propped phone",
      "sitting cross-legged on the rug in front of the couch, snacks on the coffee table, the featured slippers on and visible",
    ],
    narrativas: [
      "one continuous couch take: they talk to the camera, lift a foot with the featured slipper towards the lens, wiggle it, and settle back with the blanket while still talking",
      "one continuous take: sitting on the rug they show the featured slippers on their feet, tap the soles together softly and lean towards the lens for the recommendation",
    ],
    hooks: [
      "Mi domingo perfecto tiene tres ingredientes, y uno son {estas} {palabra}.",
      "Día de pelis en casa: esto es lo primero que me pongo.",
      "Si tu plan de hoy es NO salir, esto te interesa.",
      "El uniforme oficial del domingo, se los presento.",
    ],
    cierres: [
      "Domingo resuelto.",
      "El plan es no tener plan… pero con los pies calientitos.",
      "Ni un lujo, una necesidad.",
    ],
  },
  {
    id: "home-office",
    etiqueta: "Home office",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in a nice blouse and comfy pants, laptop open, working from home",
        "a Mexican woman in her late 20s with headphones around her neck at a tidy desk at home",
      ],
      hombre: [
        "a Mexican man in his 30s in a presentable shirt and joggers below, at his home desk",
        "a Mexican man in his late 20s between video calls, coffee in hand, home office setup behind",
      ],
    },
    escenas: [
      "at a home office desk with the laptop open, leaning back and lifting a foot with the featured slipper into frame",
      "standing by the desk stretching between calls, the featured slippers on, talking to the propped phone",
    ],
    narrativas: [
      "one continuous take at the desk: they talk to the camera, roll the chair back to show the featured slippers on their feet, and joke about the video-call dress code while wiggling a foot",
      "one continuous take: standing up from the desk they stretch, walk two steps in the featured slippers towards the camera and hold one up talking about the workday",
    ],
    hooks: [
      "De la cintura para arriba: junta. De la cintura para abajo: esto.",
      "El secreto del home office no es la silla, son {estas} {palabra}.",
      "Ocho horas de llamadas se sienten distintas con esto puesto.",
      "Mi setup de home office incluye algo que nadie ve en las juntas.",
    ],
    cierres: [
      "Productividad y comodidad sí van juntas.",
      "Que la junta se alargue: yo estoy cómoda… bueno, ya me entendieron.",
      "El mejor 'gasto de oficina' del año.",
    ],
  },
  {
    id: "invierno-en-casa",
    etiqueta: "Frío en casa",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a chunky sweater holding a hot drink, cold-morning energy",
        "a Mexican woman in her 30s wrapped in a cardigan, breath of winter light from the window",
      ],
      hombre: [
        "a Mexican man in his 30s in a fleece jacket indoors, hot coffee in hand",
        "a Mexican man in his late 20s in a beanie and sweater at home, cold season vibes",
      ],
    },
    escenas: [
      "in the kitchen on a cold morning holding a steaming mug, the featured slippers on, talking to the propped phone",
      "by the window with grey winter light, wrapped in a sweater, holding up the featured slippers",
    ],
    narrativas: [
      "one continuous kitchen take: they cradle the mug, look down at the featured slippers, lift one foot towards the lens and talk about cold floors while smiling",
      "one continuous take by the window: they hold the featured slippers up, squeeze the plush interior with one hand, then slip them on and sigh with relief",
    ],
    hooks: [
      "El piso helado de las mañanas ya no me gana.",
      "Llegó el frío, y yo llegué preparada con {estas} {palabra}.",
      "¿También su casa se congela en la mañana? Tengo la solución.",
      "Esto es lo más parecido a un abrazo para los pies.",
    ],
    motivos: [
      "Calientitas de verdad, pero sin que te sude el pie a la hora.",
      "El interior es suavecito y la suela aísla del piso frío.",
      "Son de las que te quitas hasta que te vas a dormir.",
    ],
    cierres: [
      "El invierno se aguanta mejor así.",
      "Pies calientes, humor bueno; así de simple.",
      "Frío afuera, y yo como en hotel adentro.",
    ],
  },
  {
    id: "noche-de-skincare",
    etiqueta: "Noche de skincare",
    tipos: ["pantufla"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a robe with her hair in a claw clip, skincare-night energy",
        "a Mexican woman in her early 30s in cozy pajamas with a headband, bathroom mirror routine vibes",
      ],
      hombre: [],
    },
    escenas: [
      "in the bathroom doorway with skincare products visible on the counter, wearing the featured slippers, talking to the propped phone",
      "sitting on the edge of the bed at night with a lamp on, holding the featured slippers before putting them on",
    ],
    narrativas: [
      "one continuous take: she talks mid-routine, points down at the featured slippers, lifts one towards the lens and slides it back on without leaving the frame",
      "one continuous bedroom take: she shows the featured slippers in her hands, presses the cushioning, puts them on and walks two soft steps towards the camera",
    ],
    hooks: [
      "Mi rutina de noche tiene un paso que nadie menciona.",
      "El self-care también es de los pies para abajo.",
      "Noche de skincare, tecito… y {estas} {palabra}.",
      "El paso final de mi rutina no va en la cara.",
    ],
    cierres: [
      "Rutina completa, de pies a cabeza.",
      "Ese pequeño lujo diario que sí te cambia la noche.",
      "Ya son parte oficial del ritual.",
    ],
  },
  {
    id: "despues-del-gym",
    etiqueta: "Después del gym",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in gym leggings and a loose tee, hair up, just back from working out",
        "a Mexican woman in her 30s with a gym bag dropped by the door, water bottle in hand",
      ],
      hombre: [
        "a Mexican man in his early 30s in gym shorts and a dry-fit shirt, just home from training",
        "a Mexican man in his late 20s with a towel around his neck, post-workout glow",
      ],
    },
    escenas: [
      "by the front door with a gym bag on the floor, sitting to take off sneakers with the featured slippers waiting beside",
      "in the kitchen with a protein shake, wearing the featured slippers, talking to the propped phone",
    ],
    narrativas: [
      "one continuous take: they sit by the door, pull off the gym sneakers, slide into the featured slippers and stretch their legs towards the lens with visible relief",
      "one continuous kitchen take: shake in hand, they lift a foot with the featured slipper, wiggle it and talk about what feet deserve after leg day",
    ],
    hooks: [
      "Después de entrenar, mis pies piden ESTO a gritos.",
      "El verdadero premio post-gym no es el licuado.",
      "Día de pierna + {estas} {palabra} = combinación ganadora.",
      "Nadie te avisa que el gym se disfruta más al llegar a casa.",
    ],
    cierres: [
      "Recuperación nivel: experto.",
      "El estirén de los pies, hecho pantufla.",
      "Me lo gané, y ustedes también.",
    ],
  },
  {
    id: "visitas-en-casa",
    etiqueta: "Para las visitas",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s tidying up the living room before guests arrive",
        "a Mexican woman in her late 20s arranging a basket by the entryway, hostess energy",
      ],
      hombre: [
        "a Mexican man in his 30s setting up the living room for family visits",
        "a Mexican man in his early 30s by the entryway shoe rack, organizing for guests",
      ],
    },
    escenas: [
      "by the entryway with a small basket of the featured slippers ready for guests, holding one pair up to the camera",
      "in the tidy living room holding two pairs of the featured slippers, showing them to the propped phone",
    ],
    narrativas: [
      "one continuous take: they show the guest basket, pick up a pair of the featured slippers, flex the sole and explain the house rule with a smile",
      "one continuous living-room take: holding a pair in each hand they compare sizes, put one pair down neatly and talk about guests loving them",
    ],
    hooks: [
      "En mi casa hay una regla: nadie pasa frío de los pies.",
      "El detalle que TODAS mis visitas me comentan.",
      "¿Quieren ser la casa favorita de la familia? Hagan esto.",
      "Compré varias de {estas} {palabra} y fue la mejor idea del año.",
    ],
    motivos: [
      "Salen tan bien de precio que puedes tener pares para las visitas.",
      "Se sienten acolchadas y no se aplastan aunque las use todo mundo.",
      "Lavables: quedan listas para la siguiente visita.",
    ],
    cierres: [
      "Detalles así hacen la casa.",
      "Mis suegros ya hasta las piden.",
      "Anfitriones nivel: leyenda.",
    ],
  },
  {
    id: "desayuno-tarde",
    etiqueta: "Desayuno tardeado",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in pajama shorts and a big tee, making a late breakfast",
        "a Mexican woman in her 30s flipping pancakes in a sunny kitchen, lazy morning energy",
      ],
      hombre: [
        "a Mexican man in his early 30s making chilaquiles in pajama pants, relaxed morning",
        "a Mexican man in his late 20s pouring coffee in a bright kitchen, day off energy",
      ],
    },
    escenas: [
      "in a sunny kitchen mid-cooking with a pan on the stove, wearing the featured slippers, talking to the propped phone",
      "leaning on the kitchen counter with a plate beside, lifting a foot with the featured slipper into frame",
    ],
    narrativas: [
      "one continuous kitchen take: they cook while talking, step side to side in the featured slippers to show them moving, and end pointing down at them with the spatula",
      "one continuous take: leaning on the counter with coffee they lift the featured slipper towards the lens, tap the sole with a finger and keep chatting",
    ],
    hooks: [
      "Sábado, chilaquiles y {estas} {palabra}: no necesito más.",
      "Cocinar descalza se acabó para mí, les cuento por qué.",
      "El desayuno sabe mejor cuando los pies están contentos.",
      "Media hora de pie en la cocina y ni la sentí.",
    ],
    cierres: [
      "Mañanas lentas, pies felices.",
      "El brunch empieza por los pies, créanme.",
      "Y así, señores, se empieza bien el día.",
    ],
  },
  {
    id: "piso-frio",
    etiqueta: "El piso está helado",
    tipos: ["pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s stepping out of bed in the morning, still sleepy",
        "a Mexican woman in her 30s sitting on the bed edge reaching for her slippers",
      ],
      hombre: [
        "a Mexican man in his 30s sitting on the edge of the bed, morning light through curtains",
        "a Mexican man in his late 20s reaching down for his slippers before standing up",
      ],
    },
    escenas: [
      "sitting on the edge of the bed in soft morning light, the featured slippers waiting on the floor perfectly placed",
      "standing beside the bed just after getting up, sliding a foot into the featured slippers",
    ],
    narrativas: [
      "one continuous bedroom take: they sit up, slide their feet into the featured slippers without looking, smile at the camera and describe the difference from cold tile",
      "one continuous take: they stand, take three comfortable steps towards the propped phone in the featured slippers and hold one up to show the sole",
    ],
    hooks: [
      "El primer paso de la mañana lo cambia todo.",
      "Mi truco para levantarme sin sufrir: tenerlas JUNTO a la cama.",
      "El piso a las 6 de la mañana es otra cosa sin protección.",
      "Estrategia anti-piso-helado, tomen nota.",
    ],
    cierres: [
      "Despertar también puede ser amable.",
      "Cero pies fríos, cero mal humor.",
      "El gran cambio chiquito de mis mañanas.",
    ],
  },
  // -------------------------------------------------------------------------
  // Sandalias: outfits, calor y calle
  // -------------------------------------------------------------------------
  {
    id: "brunch-con-amigas",
    etiqueta: "Brunch con amigas",
    tipos: ["sandalia"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a linen dress and gold accessories, ready for brunch",
        "a Mexican woman in her early 30s in high-waist jeans and a cute top, getting ready to go out",
      ],
      hombre: [],
    },
    escenas: [
      "by the mirror at home fully dressed for brunch, holding up the featured sandals as the final touch",
      "sitting on a chair by the door putting on the featured sandals, small purse beside",
    ],
    narrativas: [
      "one continuous take: she shows the outfit to the camera, lifts the featured sandals, puts them on standing with one hand on the wall and does a small turn",
      "one continuous take: sitting by the door she buckles the featured sandals, stands up, steps towards the lens and frames the full look with her hands",
    ],
    hooks: [
      "Brunch a las 11 y yo ya sé qué me voy a poner: esto.",
      "Las amigas SIEMPRE me preguntan por {estas} {palabra}.",
      "El toque final de todos mis outfits de fin de semana.",
      "Si hay mimosas de por medio, hay {palabra} cómodas. Regla mía.",
    ],
    cierres: [
      "Nos vemos en el brunch.",
      "Lindas Y cómodas: sí se puede.",
      "Mi outfit dice gracias.",
    ],
  },
  {
    id: "vacaciones-playa",
    etiqueta: "Modo vacaciones",
    tipos: ["sandalia", "sandalia_agua"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s packing a beach tote, sunglasses on her head, vacation glow",
        "a Mexican woman in her 30s in a flowy cover-up, straw hat nearby, holiday energy",
      ],
      hombre: [
        "a Mexican man in his early 30s in a linen shirt packing a duffel for the beach",
        "a Mexican man in his late 20s in shorts and sunglasses, terrace light, vacation mode",
      ],
    },
    escenas: [
      "at home packing an open suitcase on the bed, placing the featured sandals on top of the vacation clothes",
      "on a bright terrace with a straw bag beside, holding the featured sandals up against the light",
    ],
    narrativas: [
      "one continuous take: they pack while talking, hold the featured sandals up as the essential item, flex the sole to show how light they are and drop them in the suitcase",
      "one continuous terrace take: they show the featured sandals in hand, put them on standing and take two relaxed steps towards the camera",
    ],
    hooks: [
      "Lo primero que empaco para la playa no es el traje de baño.",
      "Mis vacaciones no empiezan sin {estas} {palabra}.",
      "Maleta lista en 10 minutos, pero esto va SIEMPRE.",
      "Si cabe en la maleta una sola cosa más, son {ellas}.",
    ],
    cierres: [
      "Nos vemos en la arena.",
      "Modo vacaciones: activado.",
      "La playa puede esperar… bueno no, ya vámonos.",
    ],
  },
  {
    id: "tarde-de-terraza",
    etiqueta: "Tarde de terraza",
    tipos: ["sandalia"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in a summer dress with a lemonade, golden hour terrace light",
        "a Mexican woman in her late 20s in shorts and a top on a plant-filled balcony",
      ],
      hombre: [
        "a Mexican man in his 30s in a polo and bermudas on a terrace with warm light",
        "a Mexican man in his late 20s with a cold drink on a balcony at sunset",
      ],
    },
    escenas: [
      "on a plant-filled terrace at golden hour, sitting with legs crossed showing the featured sandals",
      "leaning on the balcony rail with a drink, the featured sandals on, phone propped against a pot",
    ],
    narrativas: [
      "one continuous terrace take: they talk relaxed, stretch a leg to show the featured sandal towards the lens, and rotate the ankle gently in the warm light",
      "one continuous take: they step away from the rail, walk two steps towards the camera in the featured sandals and lift one slightly by the strap to show it",
    ],
    hooks: [
      "Tardecita, algo fresco de tomar… y {estas} {palabra}.",
      "La hora dorada les queda increíble, ¿o no?",
      "Mi momento favorito del día tiene dress code relajado.",
      "Éstas ya son mis {palabra} oficiales de tardear.",
    ],
    cierres: [
      "Salud por las tardes así.",
      "Verano en los pies todo el año.",
      "Simple, rico, perfecto.",
    ],
  },
  {
    id: "mercadito-fin-de-semana",
    etiqueta: "Vueltas al mercadito",
    tipos: ["sandalia", "tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with a tote bag and sunglasses, ready for weekend errands",
        "a Mexican woman in her 30s in a casual dress with a straw bag by the door",
      ],
      hombre: [
        "a Mexican man in his early 30s with a canvas tote, casual weekend fit",
        "a Mexican man in his late 20s in a cap and shorts heading out for the tianguis",
      ],
    },
    escenas: [
      "by the front door with a market tote, putting on the featured footwear before heading out",
      "back home unloading fruit from a tote on the kitchen counter, the featured footwear still on",
    ],
    narrativas: [
      "one continuous take: they put on the featured footwear by the door, stand, bounce lightly on their toes to show comfort and grab the tote talking to the camera",
      "one continuous kitchen take: unpacking the tote they look down at the featured footwear, lift a foot into frame and count the hours they walked without pain",
    ],
    hooks: [
      "Dos horas de tianguis y mis pies ni se enteraron.",
      "El uniforme de los mandados de sábado, se los enseño.",
      "Para el mercadito no hay tacones que valgan: esto sí.",
      "Caminé TODO el mercado y volví como si nada.",
    ],
    cierres: [
      "Mandado terminado, pies intactos.",
      "Los sábados se caminan mejor así.",
      "Baratas las fresas… y la comodidad también.",
    ],
  },
  {
    id: "evento-en-jardin",
    etiqueta: "Evento en jardín",
    tipos: ["sandalia", "tacon"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in an elegant flowy dress, garden-party ready",
        "a Mexican woman in her late 20s in a midi dress with delicate jewelry, event makeup done",
      ],
      hombre: [],
    },
    escenas: [
      "at home in front of the mirror in an event dress, holding the featured footwear as the final decision",
      "sitting elegantly on the couch edge fastening the featured footwear, clutch bag beside",
    ],
    narrativas: [
      "one continuous take: she compares the featured footwear against the dress in the mirror, puts them on and turns once to show the full look to the camera",
      "one continuous take: she fastens the strap, stands, walks two graceful steps towards the lens and gestures at the outfit head to toe",
    ],
    hooks: [
      "Evento en jardín: el error es llevar el calzado equivocado.",
      "Para bodas de jardín, ESTO es lo que se lleva.",
      "El outfit del evento por fin quedó, y empezó por los pies.",
      "Cuatro horas de evento, cero ganas de descalzarme. Milagro.",
    ],
    motivos: [
      "No se entierran en el pasto y se ven elegantísimas.",
      "Aguantan el evento completo: ceremonia, fotos y pista.",
      "Van perfecto con vestido largo o midi, y no torturan.",
    ],
    cierres: [
      "Lista para el jardín, sin sufrir.",
      "Que empiece la fiesta.",
      "Invitada cómoda, invitada feliz.",
    ],
  },
  {
    id: "vestido-y-listo",
    etiqueta: "Vestido y listo",
    tipos: ["sandalia"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s slipping on a simple dress, effortless-chic energy",
        "a Mexican woman in her early 30s with a minimal dress and a nice bag, clean look",
      ],
      hombre: [],
    },
    escenas: [
      "in the bedroom in a simple dress, picking the featured sandals from a small shoe shelf",
      "by the mirror doing the last outfit check, the featured sandals already on",
    ],
    narrativas: [
      "one continuous take: she grabs the featured sandals from the shelf, puts them on and shows the before-after effect on the same dress with her hands",
      "one continuous mirror take: she frames the look, points at the featured sandals, crouches to touch the strap and stands back up talking",
    ],
    hooks: [
      "Fórmula infalible: vestido sencillo + {estas} {palabra}.",
      "Cuando no sé qué ponerme, esta combinación me salva.",
      "El mismo vestido se ve 10 veces mejor con esto.",
      "Outfit de 2 minutos que parece de media hora.",
    ],
    cierres: [
      "Y lista en dos minutos, literal.",
      "Menos es más, cuando el calzado ayuda.",
      "De nada por la fórmula.",
    ],
  },
  {
    id: "pedicure-lista",
    etiqueta: "Recién salida del pedicure",
    tipos: ["sandalia"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with a fresh pedicure, holding the featured sandals proudly",
        "a Mexican woman in her 30s sitting with one leg crossed showing off fresh nail polish",
      ],
      hombre: [],
    },
    escenas: [
      "sitting on the couch edge with a fresh pedicure visible, putting on the featured sandals carefully",
      "standing by the mirror looking down at the fresh pedicure framed by the featured sandals",
    ],
    narrativas: [
      "one continuous take: she slides the featured sandals on carefully protecting the polish, extends the foot to the lens and turns the ankle to show how the design frames it",
      "one continuous take: she points down at the pedicure and the featured sandals together, crouches to adjust the strap and stands talking about the match",
    ],
    hooks: [
      "Pedicure nuevo merece {palabra} que lo luzcan.",
      "¿De qué sirve el pedicure si nadie lo ve? Exacto.",
      "Salgo del pedicure directo a ponerme {estas}.",
      "El dúo perfecto: uñas listas y {estas} {palabra}.",
    ],
    cierres: [
      "Pies presentables las 24 horas.",
      "Ahora sí, que se vea la inversión.",
      "Detalles que hacen el look.",
    ],
  },
  {
    id: "caminata-centro",
    etiqueta: "Caminando el centro",
    tipos: ["sandalia", "tenis", "mocasin"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with a crossbody bag, tourist-in-your-own-city energy",
        "a Mexican woman in her early 30s with iced coffee, ready to walk the historic center",
      ],
      hombre: [
        "a Mexican man in his 30s with a cap and a small backpack, city-walking fit",
        "a Mexican man in his late 20s in comfortable casual clothes, day-out energy",
      ],
    },
    escenas: [
      "by the door with a small bag, putting on the featured footwear for a long city walk",
      "back home with tired-but-happy energy, sitting to show the featured footwear after the walk",
    ],
    narrativas: [
      "one continuous take: they lace or slip on the featured footwear by the door, stand, do a little heel-toe bounce and promise the camera a full-day test",
      "one continuous take: sitting after the walk they hold up the featured footwear, show the sole barely dusty and count the kilometers on their fingers",
    ],
    hooks: [
      "Quince mil pasos por el centro, y les debo una disculpa a mis pies… de las veces que no traían esto.",
      "Turistear tu propia ciudad requiere el calzado correcto.",
      "Caminamos TODO el centro; esto fue lo mejor que traje puesto.",
      "La prueba definitiva de unas {palabra}: un domingo en el centro.",
    ],
    cierres: [
      "Aprobadas para caminar sin final.",
      "El centro se disfruta el doble sin pies llorando.",
      "Listas para la siguiente caminata.",
    ],
  },
  {
    id: "look-de-aeropuerto",
    etiqueta: "Look de aeropuerto",
    tipos: ["sandalia", "tenis", "mocasin"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in comfy-chic travel clothes with a small carry-on beside",
        "a Mexican woman in her early 30s in a matching set and light jacket, travel-day energy",
      ],
      hombre: [
        "a Mexican man in his 30s in joggers and a clean hoodie, boarding pass in his phone",
        "a Mexican man in his late 20s with a backpack and neck pillow, ready for a flight",
      ],
    },
    escenas: [
      "at home with a carry-on suitcase upright, wearing the featured footwear, doing the final travel-outfit check",
      "sitting on the suitcase edge at home, putting on the featured footwear before leaving for the airport",
    ],
    narrativas: [
      "one continuous take: they show the travel outfit top to bottom, point at the featured footwear, slip one off and on to show how easy it is at security",
      "one continuous take: they put on the featured footwear, stand, pull the suitcase two steps towards the camera and gesture 'ready'",
    ],
    hooks: [
      "Regla de viaje número uno: el aeropuerto se camina cómodo.",
      "Mi look de aeropuerto SIEMPRE empieza por los pies.",
      "Vuelo a las 7am: esto es lo único que no negocio.",
      "Se quitan y se ponen en segundos: seguridad del aeropuerto, resuelta.",
    ],
    cierres: [
      "Nos vemos en la sala de abordar.",
      "Viajar cómoda no está peleado con verse bien.",
      "Modo viajero: activado.",
    ],
  },
  {
    id: "calor-de-ciudad",
    etiqueta: "Ola de calor",
    tipos: ["sandalia", "sandalia_agua"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in shorts and a linen top fanning herself, heat-wave energy",
        "a Mexican woman in her 30s with a cold drink pressed to her cheek, sunny day at home",
      ],
      hombre: [
        "a Mexican man in his early 30s in a light shirt with the fan on behind, hot afternoon",
        "a Mexican man in his late 20s in shorts with an agua fresca, surviving-the-heat energy",
      ],
    },
    escenas: [
      "at home with a fan visible in the background, holding the featured sandals up as the heat solution",
      "on a sunny patio in light clothes, the featured sandals on, cold drink in hand",
    ],
    narrativas: [
      "one continuous take: they fan themselves, hold the featured sandals to the lens, put them on and exhale in relief exaggerating the freshness",
      "one continuous patio take: they lift a foot with the featured sandal, rotate the ankle, and toast to the camera with the cold drink",
    ],
    hooks: [
      "Con este calor, los tenis cerrados son castigo.",
      "35 grados afuera y mis pies frescos como si nada.",
      "La ciudad está que arde; mis pies, en la playa.",
      "Mi kit anti-calor: agua fría, sombra y {estas} {palabra}.",
    ],
    cierres: [
      "El calor se aguanta mejor con los pies libres.",
      "Frescura desde abajo, se los juro.",
      "Verano: 0, yo: 1.",
    ],
  },
  // -------------------------------------------------------------------------
  // Sandalias de agua: alberca, playa y usos rudos con agua
  // -------------------------------------------------------------------------
  {
    id: "dia-de-playa",
    etiqueta: "Día de playa",
    tipos: ["sandalia_agua"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a cover-up with a beach bag, sunscreen vibes",
        "a Mexican woman in her 30s in a swimsuit top and shorts, beach-day prep",
      ],
      hombre: [
        "a Mexican man in his early 30s in swim shorts and a tank, cooler bag beside",
        "a Mexican man in his late 20s with a towel over his shoulder, beach-ready",
      ],
    },
    escenas: [
      "at home packing the beach bag with a towel and sunscreen, holding the featured water sandals",
      "on a sunny patio in beach clothes, the featured water sandals on, showing them to the propped phone",
    ],
    narrativas: [
      "one continuous take: they pack the beach bag, hold the featured water sandals to the lens, bend them slightly to show the flexible material and drop them in the bag",
      "one continuous patio take: wearing the featured water sandals they lift one foot, point at the grippy sole and mime a confident step as if on wet stone",
    ],
    hooks: [
      "Para la playa NO se llevan los tenis, se llevan {estas}.",
      "Arena caliente, piedras, muelle mojado: {ellas} pueden con todo.",
      "El error número uno en la playa es el calzado; ya no lo cometo.",
      "Kit playero honesto: bloqueador, sombrero y {estas} {palabra}.",
    ],
    cierres: [
      "El mar nos vemos.",
      "Playa sin resbalones, gracias.",
      "Y se enjuagan y listo, como nuevas.",
    ],
  },
  {
    id: "regadera-del-gym",
    etiqueta: "Regadera del gym",
    tipos: ["sandalia_agua"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with a gym bag and a towel, locker-room energy",
        "a Mexican woman in her early 30s in athletic wear holding a toiletry bag",
      ],
      hombre: [
        "a Mexican man in his 30s with a duffel bag and flip-flop wisdom to share",
        "a Mexican man in his late 20s in gym clothes holding a towel and shower kit",
      ],
    },
    escenas: [
      "at home packing the gym bag, holding up the featured water sandals as the non-negotiable item",
      "sitting on a bench at home with the gym bag open, the featured water sandals in hand",
    ],
    narrativas: [
      "one continuous take: they pack the bag, hold the featured water sandals to the camera, point at the textured sole and explain the locker-room rule",
      "one continuous take: sitting on the bench they flex the featured water sandal in their hands, show the quick-dry material and slide it into the bag's side pocket",
    ],
    hooks: [
      "Regla de oro del gym: a la regadera NUNCA descalzo.",
      "Lo que nadie te dice cuando te inscribes al gym.",
      "En mi maleta del gym esto va antes que la toalla.",
      "Piso mojado del vestidor: cero confianza. {estas} {palabra}: toda.",
    ],
    motivos: [
      "No resbalan ni en azulejo enjabonado, y se secan en minutos.",
      "El material no guarda olores ni se mancha.",
      "Ligeras: ni se sienten en la maleta.",
    ],
    cierres: [
      "Higiene y agarre, todo en uno.",
      "El gym completo, hasta la regadera.",
      "Créanme: sus pies lo agradecen.",
    ],
  },
  {
    id: "rio-y-camping",
    etiqueta: "Río y campamento",
    tipos: ["sandalia_agua", "bota_industrial"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in outdoor clothes with a small backpack, nature-trip energy",
        "a Mexican woman in her 30s in quick-dry shorts and a cap, river-day ready",
      ],
      hombre: [
        "a Mexican man in his early 30s in trekking shorts with a cooler, weekend-trip mode",
        "a Mexican man in his late 20s in outdoor gear packing the car trunk",
      ],
    },
    escenas: [
      "by the car trunk packing for a river weekend, the featured footwear on top of the gear",
      "on the patio with camping gear laid out, holding the featured footwear to the camera",
    ],
    narrativas: [
      "one continuous take: they pack the trunk, hold the featured footwear up, flex the sole to show grip and toss-place it gently on the gear pile",
      "one continuous take: kneeling by the laid-out gear they lift the featured footwear, point at the straps and sole texture, and nod at the camera",
    ],
    hooks: [
      "Fin de semana de río: esto es lo más importante de la maleta.",
      "Piedras mojadas del río, conozcan a su rival.",
      "Para el camping llevo poco, pero esto no falla.",
      "El agua está increíble… si traes con qué pisar.",
    ],
    cierres: [
      "La naturaleza se disfruta con buen paso.",
      "Listos para el río.",
      "Aventura sí, torceduras no.",
    ],
  },
  {
    id: "parque-acuatico",
    etiqueta: "Parque acuático",
    tipos: ["sandalia_agua"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s packing a family-size pool bag, day-trip captain energy",
        "a Mexican woman in her late 20s in a swim top and shorts with a waterproof pouch",
      ],
      hombre: [
        "a Mexican man in his 30s with a cooler and towels, family-trip organizer energy",
        "a Mexican man in his late 20s in swim shorts holding a day-pass wristband",
      ],
    },
    escenas: [
      "at home with a big pool bag and towels, holding up the featured water sandals",
      "by the door with the cooler ready, wearing the featured water sandals, doing the checklist out loud",
    ],
    narrativas: [
      "one continuous take: they run the day-trip checklist on their fingers, hold the featured water sandals as the underrated hero and press the sole to show the grip",
      "one continuous take: wearing the featured water sandals they mime the walk from wet pavement to slide stairs, pointing down at each imaginary step",
    ],
    hooks: [
      "Día de parque acuático: el piso mojado no perdona.",
      "Todos empacan toalla; los que saben, empacan {estas}.",
      "Del camastro al tobogán sin patinadas, así se hace.",
      "El pase del parque cuesta; la caída en el piso mojado, más.",
    ],
    cierres: [
      "Diversión completa, cero sustos.",
      "Ahora sí: al tobogán.",
      "Se los dice alguien que ya se resbaló una vez.",
    ],
  },
  {
    id: "lavando-el-coche",
    etiqueta: "Lavando el coche",
    tipos: ["sandalia_agua"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in shorts and an old tee, hose in hand, Sunday chores energy",
      ],
      hombre: [
        "a Mexican man in his 30s in shorts and a cap, bucket and sponge ready, driveway energy",
        "a Mexican man in his late 20s with a hose over his shoulder, weekend car-wash mode",
      ],
    },
    escenas: [
      "in the driveway with a bucket and sponge beside, wearing the featured water sandals, hose in hand",
      "next to the freshly washed car with water on the pavement, the featured water sandals visibly wet",
    ],
    narrativas: [
      "one continuous driveway take: they talk while rinsing, step confidently on the wet pavement in the featured water sandals and point down at the grip",
      "one continuous take: they lift one wet featured sandal towards the lens, show the water running off and stomp lightly to show nothing slips",
    ],
    hooks: [
      "Lavar el coche descalzo o en chanclas viejas: hasta hoy.",
      "Piso mojado, jabón y cero resbalones. Les cuento.",
      "El sábado de lavar el coche por fin es seguro.",
      "Esto no es solo para la alberca, y se los demuestro.",
    ],
    cierres: [
      "Coche limpio, tobillos completos.",
      "Chamba de sábado, resuelta.",
      "Multiusos como pocas cosas.",
    ],
  },
  {
    id: "jardin-mojado",
    etiqueta: "El jardín en la mañana",
    tipos: ["sandalia_agua", "pantufla"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her 30s with a watering can among plants, morning-garden energy",
        "a Mexican woman in her late 20s picking herbs from pots on a dewy patio",
      ],
      hombre: [
        "a Mexican man in his early 30s watering plants on the patio, coffee in the other hand",
        "a Mexican man in his late 30s checking his little garden in the morning",
      ],
    },
    escenas: [
      "on a dewy patio among potted plants with a watering can, wearing the featured footwear",
      "by the garden hose with wet grass around, showing the featured footwear to the propped phone",
    ],
    narrativas: [
      "one continuous garden take: they water plants while talking, step on the wet grass in the featured footwear and lift a foot to show the dry sole line",
      "one continuous take: they crouch by a pot, stand, walk two steps on wet pavement in the featured footwear and give the camera a satisfied nod",
    ],
    hooks: [
      "Regar las plantas sin mojarse los pies: logro desbloqueado.",
      "El pasto mojado de la mañana ya no me detiene.",
      "Mis plantas felices y mis pies secos: ganar-ganar.",
      "Ritual de la mañana: café, plantas y {estas} {palabra}.",
    ],
    cierres: [
      "Jardín regado, día empezado.",
      "Las plantas también aplauden.",
      "Simple y funcional, como me gusta.",
    ],
  },
  // -------------------------------------------------------------------------
  // Botas: calle, noche, viaje y clima
  // -------------------------------------------------------------------------
  {
    id: "noche-de-concierto",
    etiqueta: "Noche de concierto",
    tipos: ["bota", "tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a band tee and jeans, concert-night energy",
        "a Mexican woman in her early 30s in a leather jacket doing a last outfit check",
      ],
      hombre: [
        "a Mexican man in his 30s in a dark jacket and jeans, tickets on his phone",
        "a Mexican man in his late 20s in a graphic tee, pre-concert hype",
      ],
    },
    escenas: [
      "in the bedroom with a concert outfit laid on the bed, holding the featured footwear as the final piece",
      "by the mirror in the full concert fit, stepping into the featured footwear",
    ],
    narrativas: [
      "one continuous take: they show the outfit on the bed, lift the featured footwear, put them on and do a little excited bounce to test them for the pit",
      "one continuous mirror take: they finish the look with the featured footwear, turn to the camera and mime standing three hours without pain, counting on fingers",
    ],
    hooks: [
      "Concierto = tres horas de pie. El calzado NO se improvisa.",
      "El outfit del concierto empieza por donde vas a sufrir… o no.",
      "Aprendí a la mala que a un concierto no se va con cualquier cosa.",
      "Hoy toca mi banda favorita y mis pies van protegidos.",
    ],
    motivos: [
      "Aguantan horas de pie y hasta los brincos del cierre.",
      "La suela amortigua de verdad; llegas al encore como al inicio.",
      "Si te pisan en la multitud, ni lo sientes.",
    ],
    cierres: [
      "Nos vemos en la primera fila.",
      "Que dure el concierto lo que quiera.",
      "Pies listos, playlist lista.",
    ],
  },
  {
    id: "cita-de-noche",
    etiqueta: "Cita de noche",
    tipos: ["bota", "tacon", "mocasin", "zapato"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a date-night outfit, earrings on, final touches",
        "a Mexican woman in her early 30s in an elegant blouse and jeans, perfume bottle in hand",
      ],
      hombre: [
        "a Mexican man in his 30s in a well-fitted shirt, watch on, date-night prep",
        "a Mexican man in his late 20s buttoning a clean overshirt, cologne nearby",
      ],
    },
    escenas: [
      "by the mirror in the date-night outfit, holding the featured footwear as the final decision",
      "sitting on the bed edge putting on the featured footwear, dressed up and ready",
    ],
    narrativas: [
      "one continuous take: they debate two options out loud, choose the featured footwear, put them on and give the mirror a confident look before turning to the camera",
      "one continuous take: they put on the featured footwear, stand, adjust the outfit and walk two steady steps towards the lens with date-night confidence",
    ],
    hooks: [
      "Cita a las 8; la decisión más importante ya está tomada.",
      "El outfit de cita se define aquí abajo, créanme.",
      "Primera impresión también son los zapatos, no se hagan.",
      "Confianza para una cita: 50% actitud, 50% {palabra} correctos.",
    ],
    cierres: [
      "Deséenme suerte.",
      "La segunda cita ya es cosa mía.",
      "Puntos extra asegurados.",
    ],
  },
  {
    id: "fin-en-el-rancho",
    etiqueta: "Fin de semana en el rancho",
    tipos: ["bota", "bota_industrial"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in jeans and a denim jacket, countryside-weekend energy",
        "a Mexican woman in her late 20s with a flannel shirt, packing for the ranch",
      ],
      hombre: [
        "a Mexican man in his 30s in a denim shirt and cap, ranch-weekend mode",
        "a Mexican man in his late 30s loading the truck for the countryside",
      ],
    },
    escenas: [
      "by the truck loading a small bag for the ranch, wearing the featured boots",
      "on a rural-looking patio with dirt ground, showing the featured boots to the propped phone",
    ],
    narrativas: [
      "one continuous take: they load the bag, stomp the featured boots lightly on the dirt to show they mean business and talk about what the ranch demands",
      "one continuous take: they lift one featured boot to the lens, tap the firm sole with a knuckle, and pan their own phone down to show both on",
    ],
    hooks: [
      "Al rancho no se llevan tenis blancos, eso ya lo aprendí.",
      "Fin de semana de tierra, piedras y {estas} {palabra}.",
      "El campo pide calzado de verdad; les enseño el mío.",
      "Rumbo al rancho: esto es lo único que me pongo allá.",
    ],
    cierres: [
      "El campo se respeta, y se pisa bien.",
      "Nos vemos entre potreros.",
      "Botas puestas, fin de semana arreglado.",
    ],
  },
  {
    id: "look-de-otono",
    etiqueta: "Ya es clima de botas",
    tipos: ["bota"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a trench coat and scarf, first-cold-day excitement",
        "a Mexican woman in her early 30s in a knit sweater and jeans, autumn palette outfit",
      ],
      hombre: [],
    },
    escenas: [
      "by the closet pulling the featured boots out as the season officially starts",
      "by the mirror in a full autumn outfit, the featured boots as the anchor of the look",
    ],
    narrativas: [
      "one continuous take: she pulls the featured boots from the closet like a ceremony, hugs them jokingly, puts them on and shows the full outfit",
      "one continuous mirror take: she frames the autumn look with her hands ending at the featured boots, crouches to touch them and stands with a happy spin",
    ],
    hooks: [
      "Oficialmente declaro inaugurada la temporada de botas.",
      "El primer día de frío es MI día favorito, y esta es la razón.",
      "Adiós sandalias, hola {estas} bellezas.",
      "El clima por fin está de mi lado.",
    ],
    cierres: [
      "Que dure el friíto, por favor.",
      "La mejor temporada del año, sin discusión.",
      "Otoño: te estaba esperando.",
    ],
  },
  {
    id: "viaje-de-carretera",
    etiqueta: "Viaje en carretera",
    tipos: ["bota", "tenis", "mocasin"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with a road-trip tote and snacks, co-pilot energy",
        "a Mexican woman in her early 30s with sunglasses and a comfy-chic travel outfit",
      ],
      hombre: [
        "a Mexican man in his 30s with car keys and a small duffel, road-trip driver mode",
        "a Mexican man in his late 20s loading a backpack into the car, playlist ready",
      ],
    },
    escenas: [
      "next to the car with the door open and a small bag, wearing the featured footwear",
      "sitting on the car's rocker panel with the door open, showing the featured footwear",
    ],
    narrativas: [
      "one continuous take: they toss the bag in, lean on the car and lift one foot with the featured footwear explaining the hours of driving ahead",
      "one continuous take: sitting at the car door they tap the featured footwear soles together, talk about pedals and comfort, and swing into the seat",
    ],
    hooks: [
      "Cinco horas de carretera piden calzado inteligente.",
      "El copiloto duerme; el conductor necesita estar cómodo.",
      "Road trip sorpresa, pero el calzado siempre va planeado.",
      "Kilómetros por delante y cero pendientes aquí abajo.",
    ],
    cierres: [
      "Carretera, allá vamos.",
      "Manejar cómodo también es seguridad.",
      "Y en cada parada, se ven bien las fotos.",
    ],
  },
  {
    id: "jeans-perfectos",
    etiqueta: "Con jeans van perfectas",
    tipos: ["bota", "tenis", "mocasin"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in well-fitted jeans doing outfit combinations",
        "a Mexican woman in her early 30s with three jeans laid on the bed, styling session energy",
      ],
      hombre: [
        "a Mexican man in his 30s in dark jeans trying combinations in front of the mirror",
        "a Mexican man in his late 20s with two pairs of jeans on the bed, deciding",
      ],
    },
    escenas: [
      "in the bedroom with jeans laid out on the bed, holding the featured footwear against each pair",
      "by the mirror in jeans, wearing the featured footwear, adjusting the hem to show the match",
    ],
    narrativas: [
      "one continuous take: they hold the featured footwear against two different jeans, nod at both, put them on and show the final combination at the mirror",
      "one continuous take: wearing jeans and the featured footwear they roll the hem once, point at the silhouette and turn to each side for the camera",
    ],
    hooks: [
      "La prueba de fuego de {unas} {palabra}: cómo se ven con jeans.",
      "Todos mis jeans le quedan bien; eso casi no pasa.",
      "El combo jeans + {estas} {palabra} nunca falla, y lo demuestro.",
      "Si dudas qué ponerte con jeans, la respuesta es esta.",
    ],
    cierres: [
      "Combinación aprobada, con todos los jeans.",
      "Básicos que no son básicos.",
      "El clóset agradece cosas así de fáciles.",
    ],
  },
  {
    id: "primera-lluvia",
    etiqueta: "Empezó a llover",
    tipos: ["bota", "bota_industrial"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with an umbrella by the door, rainy-day outfit",
        "a Mexican woman in her early 30s looking out a rain-streaked window, cozy but ready to go out",
      ],
      hombre: [
        "a Mexican man in his 30s in a rain jacket checking the sky from the doorway",
        "a Mexican man in his late 20s with an umbrella and backpack, rainy commute ready",
      ],
    },
    escenas: [
      "by the front door with rain visible outside, putting on the featured boots with an umbrella beside",
      "under the porch with rain falling behind, showing the featured boots to the propped phone",
    ],
    narrativas: [
      "one continuous take: they put on the featured boots by the door, grab the umbrella, and step confidently towards the camera as the rain sounds outside",
      "one continuous porch take: they lift one featured boot, run a finger along the sealed seam, and stomp lightly on the wet edge to show nothing gets in",
    ],
    hooks: [
      "Empezó la temporada de lluvias y yo empecé preparada.",
      "Charcos: 0. Yo: todos.",
      "El pie mojado en la oficina es lo peor que existe; solución aquí.",
      "Llueve y por primera vez no me cambio los planes.",
    ],
    motivos: [
      "La suela agarra en piso mojado y el agua no traspasa.",
      "Los charcos dejaron de ser un problema; el pantalón llega seco.",
      "Se limpian con un trapo y quedan como si nada.",
    ],
    cierres: [
      "Que llueva lo que quiera.",
      "Temporada de lluvias: dominada.",
      "Seco de aquí abajo, feliz de aquí arriba.",
    ],
  },
  {
    id: "salida-con-amigos",
    etiqueta: "Salida con los amigos",
    tipos: ["bota", "tenis", "zapato"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a casual-cool night outfit, texting the group chat",
      ],
      hombre: [
        "a Mexican man in his early 30s in a clean casual fit, checking the group chat",
        "a Mexican man in his late 20s grabbing his jacket and keys, night-out energy",
      ],
    },
    escenas: [
      "by the door grabbing jacket and keys, wearing the featured footwear, night-out energy",
      "in the bedroom doing a quick fit check with the featured footwear on",
    ],
    narrativas: [
      "one continuous take: they check their phone, show the featured footwear with a quick down-pan of their own camera, grab the keys and head towards the door talking",
      "one continuous take: quick fit check in the mirror, they point at the featured footwear, do a small confident step-turn and nod at the camera",
    ],
    hooks: [
      "El chat ya decidió: hoy se sale. Yo ya estaba listo desde aquí abajo.",
      "Viernes, tacos y después quién sabe: calzado a la altura.",
      "Estos son mis {palabra} de 'no sé a dónde vamos pero voy bien'.",
      "Para las salidas que empiezan tranquilas y terminan quién sabe.",
    ],
    cierres: [
      "Donde caiga la noche, voy cómodo.",
      "El plan cambia; {las} {palabra}, no.",
      "Nos vemos al rato.",
    ],
  },
  {
    id: "dia-de-fotos",
    etiqueta: "Para las fotos del outfit",
    tipos: ["bota", "sandalia", "tacon", "tenis"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s arranging her outfit for content photos, creator energy",
        "a Mexican woman in her early 30s with a tripod visible, planning outfit shots",
      ],
      hombre: [],
    },
    escenas: [
      "in a bright corner of the apartment with a tripod hint visible, wearing the featured footwear, styling for photos",
      "by a clean wall with nice light, doing outfit poses with the featured footwear as the focal point",
    ],
    narrativas: [
      "one continuous take: she tries two quick poses, crouches to point at the featured footwear, and explains why every photo lately includes them",
      "one continuous take: she shows the outfit, pans her own phone down to the featured footwear and back up, and strikes the final relaxed pose",
    ],
    hooks: [
      "¿Ya notaron que salen en TODAS mis fotos? Hay una razón.",
      "El truco para que el outfit se vea caro está aquí abajo.",
      "Mis fotos mejoraron cuando entendí esto de los zapatos.",
      "Content day: y adivinen quiénes son las protagonistas.",
    ],
    cierres: [
      "Foto que sale, foto donde aparecen.",
      "El detalle que levanta cualquier foto.",
      "Ya son parte del feed oficial.",
    ],
  },
  {
    id: "clima-loco",
    etiqueta: "El clima está loco",
    tipos: ["bota", "tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s holding a light jacket, checking the weather app dramatically",
        "a Mexican woman in her early 30s between an umbrella and sunglasses on the entry table",
      ],
      hombre: [
        "a Mexican man in his 30s looking between sunglasses and an umbrella, confused by the sky",
        "a Mexican man in his late 20s with a hoodie half on, weather-app frustration energy",
      ],
    },
    escenas: [
      "by the entry table with both sunglasses and an umbrella, wearing the featured footwear, weather-confused",
      "at the window pointing at the changing sky, then down at the featured footwear",
    ],
    narrativas: [
      "one continuous take: they compare umbrella and sunglasses jokingly, shrug, and point at the featured footwear as the one decision that works either way",
      "one continuous take: they show the sky through the window, look at the camera, lift a foot with the featured footwear and nod like 'this is the answer'",
    ],
    hooks: [
      "Sol a las 10, diluvio a las 2: mi ciudad, señores.",
      "No sé qué clima va a hacer, pero sé qué me voy a poner.",
      "El pronóstico miente; {estas} {palabra} no.",
      "Para ciudades con 4 estaciones en un día, esto.",
    ],
    cierres: [
      "Llueva o truene, voy lista.",
      "El clima hace lo suyo; yo lo mío.",
      "Adaptabilidad, pero hecha calzado.",
    ],
  },
  // -------------------------------------------------------------------------
  // Botas industriales / hiking: trabajo rudo y monte
  // -------------------------------------------------------------------------
  {
    id: "dia-en-la-obra",
    etiqueta: "Día en la obra",
    tipos: ["bota_industrial"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in a work vest and jeans, hard-working site energy",
      ],
      hombre: [
        "a Mexican man in his 30s in a reflective vest and work jeans, lunch-break energy",
        "a Mexican man in his 40s in a work shirt with dust on the sleeves, foreman vibes",
      ],
    },
    escenas: [
      "in a garage-workshop corner with tools on a bench, wearing the featured work boots, work vest on",
      "sitting on a toolbox during a break, the featured work boots front and center, dusty floor",
    ],
    narrativas: [
      "one continuous take: they talk straight to the camera like advising a coworker, tap the featured boot's toe cap with a wrench handle, and stand firm to show stability",
      "one continuous take: sitting on the toolbox they lift one featured boot across the knee, point at the sole pattern and the stitching, and nod with respect",
    ],
    hooks: [
      "En la obra, el que ahorra en botas paga en el doctor.",
      "Ocho horas parado en concreto: estas son mis aliadas.",
      "Un compa me preguntó por mis botas; va la respuesta completa.",
      "El equipo de trabajo más importante no es el taladro.",
    ],
    cierres: [
      "Herramienta puesta, jornada segura.",
      "En la obra se sabe quién trae buenas botas.",
      "Inversión, no gasto. Así de fácil.",
    ],
  },
  {
    id: "taller-mecanico",
    etiqueta: "En el taller",
    tipos: ["bota_industrial"],
    publicos: ["hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in a work shirt with a rag in the back pocket, workshop energy",
      ],
      hombre: [
        "a Mexican man in his 30s in a mechanic shirt wiping his hands with a rag",
        "a Mexican man in his late 20s in coveralls tied at the waist, workshop-break energy",
      ],
    },
    escenas: [
      "in a home-garage workshop with a workbench behind, wearing the featured work boots, wiping hands with a rag",
      "leaning on a tool cabinet, the featured work boots planted on the concrete floor",
    ],
    narrativas: [
      "one continuous take: they wipe their hands, plant the featured boot on a low step to show the sole, and talk about oil, floors that stain, and boots that survive",
      "one continuous take: leaning on the cabinet they lift a featured boot, scratch the toe cap with a knuckle to show the protection, and set it back down firmly",
    ],
    hooks: [
      "Piso con aceite y herramienta pesada: aquí no se juega.",
      "En el taller he visto caer de todo… menos a mí.",
      "Las botas del taller se escogen con cabeza; les explico.",
      "Grasa, gasolina y fierros: mis botas ni se inmutan.",
    ],
    motivos: [
      "El casquillo aguanta el golpe que no viste venir.",
      "La suela no patina ni con aceite en el piso.",
      "Se limpian fácil y no se cuartean con la grasa.",
    ],
    cierres: [
      "Seguridad primero, siempre.",
      "El taller respeta al que viene preparado.",
      "Herramienta completa, de pies a cabeza.",
    ],
  },
  {
    id: "turno-en-bodega",
    etiqueta: "Turno en la bodega",
    tipos: ["bota_industrial", "tenis"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a warehouse vest with a badge lanyard, shift-ready",
      ],
      hombre: [
        "a Mexican man in his early 30s in a warehouse vest, thermos in hand, pre-shift energy",
        "a Mexican man in his late 20s with a back-support belt, logistics-worker vibes",
      ],
    },
    escenas: [
      "by the door before the shift with a lunch bag and thermos, wearing the featured footwear",
      "at home after the shift, sitting with visible relief, the featured footwear still on",
    ],
    narrativas: [
      "one continuous take: they grab the thermos, look at the camera and explain the kilometers a warehouse shift walks while lifting one featured boot into frame",
      "one continuous take: sitting after the shift they slowly stretch their legs, point at the featured footwear and count the hours standing without complaints",
    ],
    hooks: [
      "Un turno en bodega son 12 kilómetros caminados; hagan cuentas.",
      "Mi turno dura 10 horas; mis pies antes duraban 6.",
      "El escáner, la faja… y lo más importante va en los pies.",
      "Para los que chambeamos parados TODO el día.",
    ],
    cierres: [
      "Turno terminado, pies enteros.",
      "La chamba rinde cuando nada te duele.",
      "Se lo recomiendo a todo el turno completo.",
    ],
  },
  {
    id: "jornada-de-12-horas",
    etiqueta: "Jornada de 12 horas",
    tipos: ["bota_industrial", "tenis", "zapato"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in practical work clothes, long-shift veteran energy",
      ],
      hombre: [
        "a Mexican man in his 30s in work clothes with a lunchbox, long-day energy",
        "a Mexican man in his late 30s checking his watch by the door, double-shift mode",
      ],
    },
    escenas: [
      "by the door at dawn with a lunchbox, wearing the featured footwear, long-day-ahead energy",
      "arriving home at night, keys in hand, sitting with the featured footwear still on",
    ],
    narrativas: [
      "one continuous take: they check the time, lift a featured boot into frame and promise the camera a verdict at hour twelve, confident smile",
      "one continuous take: arriving home they drop the keys, sit, look at the featured footwear and deliver the verdict: still comfortable, day survived",
    ],
    hooks: [
      "Doce horas de jornada: aquí no sobrevive cualquier calzado.",
      "Salgo a las 6 y regreso a las 8; mis pies ya no sufren el viaje.",
      "La prueba más dura no es el gym, es mi jornada.",
      "Directo desde la hora 12, les tengo el veredicto.",
    ],
    cierres: [
      "Jornada larga, calzado a la altura.",
      "El cuerpo agradece; el bolsillo también.",
      "Mañana, otra vez. Y aquí seguimos.",
    ],
  },
  {
    id: "casquillo-a-prueba",
    etiqueta: "El casquillo a prueba",
    tipos: ["bota_industrial"],
    publicos: ["hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in work gear demonstrating boot safety features",
      ],
      hombre: [
        "a Mexican man in his 30s in a work shirt, holding the featured safety boot like show-and-tell",
        "a Mexican man in his late 20s at a workbench, safety-gear reviewer energy",
      ],
    },
    escenas: [
      "at a workbench holding the featured safety boot up like an exhibit, tools in the background",
      "sitting on a stool with the featured safety boot on his knee, pointing at the toe cap",
    ],
    narrativas: [
      "one continuous take: they knock firmly on the toe cap with their knuckles so the camera hears it, point at the reinforced stitching and the sole, and put it back on",
      "one continuous take: boot across the knee, they trace the protection zones with a finger like a map, then stand and plant both feet solid",
    ],
    hooks: [
      "¿Escuchan eso? Es el casquillo. Y un día me va a salvar el pie.",
      "Les presento la parte de mis botas que espero nunca usar.",
      "Esto no es moda: es seguridad con la que trabajo diario.",
      "Un martillazo al pie decide quién trae buenas botas.",
    ],
    motivos: [
      "Casquillo firme, costura reforzada y suela que no patina: el paquete completo.",
      "Protegen sin ser pesadas; eso casi no se encuentra.",
      "Cumplen norma y de todos modos son cómodas.",
    ],
    cierres: [
      "Más vale casquillo sin golpe que golpe sin casquillo.",
      "La seguridad no se negocia.",
      "Trabajen tranquilos; para eso son.",
    ],
  },
  {
    id: "ruta-de-senderismo",
    etiqueta: "Ruta de senderismo",
    tipos: ["bota_industrial", "tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in hiking leggings with a small hydration pack",
        "a Mexican woman in her early 30s in outdoor gear checking a trail map on her phone",
      ],
      hombre: [
        "a Mexican man in his 30s in trekking pants with a light backpack, trail-day energy",
        "a Mexican man in his late 20s stretching before a hike, cap and sunglasses on",
      ],
    },
    escenas: [
      "by the car with a small backpack, tightening the laces of the featured hiking boots",
      "on a gravel path edge, one featured boot up on a rock, trail-guide energy",
    ],
    narrativas: [
      "one continuous take: they tighten the laces, stand, tap each toe on the ground twice and tell the camera what today's trail throws at them",
      "one continuous take: with one boot on the rock they point at the sole grip, look up the imaginary trail and wave the camera to follow",
    ],
    hooks: [
      "Subida de 2 horas: el 80% del éxito está en los pies.",
      "El cerro no perdona tenis de moda, se los digo por experiencia.",
      "Ruta nueva hoy; equipo de confianza siempre.",
      "Para bajar sin patinar se necesita ESTA suela.",
    ],
    motivos: [
      "El agarre en piedra suelta y tierra es otra cosa.",
      "El tobillo va sujeto: cero torceduras en bajadas.",
      "Aguantan lodo, grava y río… y se limpian fácil.",
    ],
    cierres: [
      "La cima nos espera.",
      "El monte se disfruta con buen paso.",
      "Nos vemos arriba.",
    ],
  },
  {
    id: "equipo-nuevo-de-trabajo",
    etiqueta: "Estrenando equipo de trabajo",
    tipos: ["bota_industrial"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s unboxing new work gear on a workbench",
      ],
      hombre: [
        "a Mexican man in his 30s opening a box of new work boots on the tailgate of a truck",
        "a Mexican man in his late 20s comparing his destroyed old boots with the new pair",
      ],
    },
    escenas: [
      "at a truck tailgate with a box open, lifting the featured work boots out for the first time",
      "at a workbench with the worn-out old boots beside the brand-new featured pair",
    ],
    narrativas: [
      "one continuous take: they open the box, lift the featured boots, check the sole and the stitching like an inspector and give the approval nod",
      "one continuous take: they hold the destroyed old boot next to the new featured one, compare soles sole-to-sole, and retire the old one with a pat",
    ],
    hooks: [
      "Después de un año, mis botas viejas ya pedían relevo.",
      "Estreno de equipo: y esto es lo primero que reviso.",
      "Así se ve un año de trabajo duro… y así se ve el reemplazo.",
      "Nuevas botas de chamba: la inspección completa.",
    ],
    cierres: [
      "Listas para el primer rayón.",
      "Un año más de servicio, mínimo.",
      "El relevo quedó en buenas manos… bueno, pies.",
    ],
  },
  {
    id: "fin-de-turno",
    etiqueta: "Fin del turno",
    tipos: ["bota_industrial", "tenis", "zapato"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s arriving home in work clothes, end-of-day relief",
      ],
      hombre: [
        "a Mexican man in his 30s arriving home with his lunchbox, loosening his vest",
        "a Mexican man in his late 30s sitting on the entryway bench, long-day-done energy",
      ],
    },
    escenas: [
      "on the entryway bench just home from work, unlacing the featured footwear slowly",
      "in the kitchen with a cold glass of water, the featured footwear still on, end-of-day calm",
    ],
    narrativas: [
      "one continuous take: they sit, unlace the featured footwear, hold one up and thank it half-jokingly for the day it survived",
      "one continuous kitchen take: glass in hand they look down at the featured footwear, lift one foot and review the day: hours, kilometers, zero complaints",
    ],
    hooks: [
      "Fin del turno: la hora de la verdad para cualquier calzado.",
      "El día estuvo pesado; mis pies dicen lo contrario.",
      "Llegué, me senté, y por primera vez no fue por dolor.",
      "Reporte de fin de turno: todo en orden aquí abajo.",
    ],
    cierres: [
      "Mañana se repite, y aquí estaremos.",
      "Descanso ganado a la buena.",
      "Así se cierra un día bien trabajado.",
    ],
  },
  // -------------------------------------------------------------------------
  // Tenis: pasos, escuela, chamba y vida diaria
  // -------------------------------------------------------------------------
  {
    id: "diez-mil-pasos",
    etiqueta: "Reto de 10 mil pasos",
    tipos: ["tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in athleisure checking her step counter",
        "a Mexican woman in her early 30s in leggings and a cap, daily-walk energy",
      ],
      hombre: [
        "a Mexican man in his 30s in shorts checking his smartwatch, walking-streak energy",
        "a Mexican man in his late 20s in joggers stretching lightly before a walk",
      ],
    },
    escenas: [
      "by the door showing a step-counter on the phone, wearing the featured sneakers",
      "back from a walk, slightly glowing, showing the completed step count and the featured sneakers",
    ],
    narrativas: [
      "one continuous take: they show the step goal on the phone, point down at the featured sneakers, bounce twice on their toes and head for the door",
      "one continuous take: back home they show the completed counter, lift one featured sneaker into frame and tap the cushioned sole with a finger",
    ],
    hooks: [
      "Reto de 10 mil pasos diarios: día 47 y sigo viva.",
      "El secreto no es la disciplina, es no acabar con los pies muertos.",
      "Diez mil pasos se dicen fácil; el calzado hace la mitad.",
      "Mi contador dice 12,438; mis pies dicen gracias.",
    ],
    cierres: [
      "Mañana van otros diez mil.",
      "Caminar se volvió mi parte favorita del día.",
      "El reto sigue; el dolor, ya no.",
    ],
  },
  {
    id: "dia-de-clases",
    etiqueta: "Día de clases",
    tipos: ["tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 20s with a backpack and a laptop sleeve, uni-student energy",
        "a Mexican woman in her mid 20s with a tote full of notebooks, campus-day look",
      ],
      hombre: [
        "a Mexican man in his early 20s with a backpack over one shoulder, student energy",
        "a Mexican man in his mid 20s with headphones around his neck and a coffee, campus mode",
      ],
    },
    escenas: [
      "by the door with a backpack, putting on the featured sneakers for a full campus day",
      "at a desk at home with notebooks, stretching legs to show the featured sneakers after classes",
    ],
    narrativas: [
      "one continuous take: they shoulder the backpack, tie the featured sneakers fast, stand and check the time like running late but comfortable",
      "one continuous take: after classes they drop the backpack, sit, lift one featured sneaker and count the buildings crossed between classes",
    ],
    hooks: [
      "De un edificio a otro por TODO el campus: mi día normal.",
      "Ocho clases, tres edificios, un solo par de {palabra}.",
      "El outfit de la uni cambia; los tenis, jamás.",
      "Corrí a mi clase de las 7 y llegué… caminando cómodo.",
    ],
    cierres: [
      "La uni se aguanta mejor así.",
      "Aprobados con mención honorífica.",
      "Del salón a la vida, sin cambiarme.",
    ],
  },
  {
    id: "vuelo-temprano",
    etiqueta: "Vuelo de madrugada",
    tipos: ["tenis", "mocasin"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in comfy layers with a neck pillow, 5am-flight energy",
        "a Mexican woman in her early 30s with a carry-on and a large coffee, early-airport mode",
      ],
      hombre: [
        "a Mexican man in his 30s in a hoodie with a backpack, red-eye-flight energy",
        "a Mexican man in his late 20s yawning with boarding pass in hand, early-morning travel",
      ],
    },
    escenas: [
      "at home before dawn with a carry-on and a coffee, wearing the featured footwear",
      "sitting on the suitcase at the door, slipping the featured footwear on half-asleep",
    ],
    narrativas: [
      "one continuous take: half-asleep with coffee they point at the featured footwear as the one smart decision of the morning, and roll the suitcase towards the door",
      "one continuous take: they slip the featured footwear on without hands, look at the camera impressed, and grab the carry-on with a sleepy thumbs up",
    ],
    hooks: [
      "Vuelo a las 6am: a esa hora solo se piensa en comodidad.",
      "Terminal 2 de madrugada, y yo caminando como en nubes.",
      "Cuando el despertador suena a las 4, esto no se discute.",
      "Kilómetro y medio de terminal: medido y aprobado.",
    ],
    cierres: [
      "Nos vemos aterrizando.",
      "Madrugar duele menos así.",
      "Buen viaje para mí, por favor.",
    ],
  },
  {
    id: "gym-ligero",
    etiqueta: "Al gym sin drama",
    tipos: ["tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in matching workout set, gym-bag packed",
        "a Mexican woman in her early 30s doing a light stretch at home before the gym",
      ],
      hombre: [
        "a Mexican man in his 30s in a dry-fit shirt with a shaker, pre-workout energy",
        "a Mexican man in his late 20s tying the featured sneakers on the entry bench",
      ],
    },
    escenas: [
      "on the entry bench tying the featured sneakers, gym bag beside, workout fit on",
      "at home doing a light warm-up stretch, the featured sneakers on and centered",
    ],
    narrativas: [
      "one continuous take: they tie the featured sneakers, stand, do two light jumps to show the cushioning and grab the gym bag mid-sentence",
      "one continuous take: they stretch, look down at the featured sneakers, lift one to show the sole flex with their hands and nod ready",
    ],
    hooks: [
      "Caminadora, pesas y clase de spinning: un solo par lo aguanta.",
      "Mi excusa era 'no tengo tenis para el gym'. Se acabó.",
      "Para entrenar no necesitas 5 pares; necesitas el correcto.",
      "Cardio sin que las rodillas pasen la factura: empieza abajo.",
    ],
    cierres: [
      "Nos vemos en la caminadora.",
      "Una excusa menos, una sentadilla más.",
      "El gym ya no tiene pretextos.",
    ],
  },
  {
    id: "parque-con-la-familia",
    etiqueta: "Domingo en el parque",
    tipos: ["tenis", "sandalia"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s with a picnic tote and a thermos, family-Sunday energy",
        "a Mexican woman in her mid 30s in comfortable mom-on-the-go clothes",
      ],
      hombre: [
        "a Mexican man in his 30s with a soccer ball under his arm and a backpack of snacks",
        "a Mexican man in his mid 30s with a picnic blanket rolled under his arm",
      ],
    },
    escenas: [
      "by the door with a picnic tote and a ball, wearing the featured footwear, Sunday-plan energy",
      "back from the park with the blanket under the arm, showing the featured footwear still fresh",
    ],
    narrativas: [
      "one continuous take: they gather the picnic things, point at the featured footwear and predict the kilometers a park Sunday really means",
      "one continuous take: back home they drop the ball, lift one featured shoe to show it survived grass, dirt path and a quick cascarita",
    ],
    hooks: [
      "Un 'vamos al parque' son 4 horas de pie; los papás me entienden.",
      "Domingo de parque: pasto, tierra, cascarita… y yo tranquila.",
      "El picnic es opcional; caminar cómodo, no.",
      "Sobreviví al domingo familiar y mis pies también.",
    ],
    cierres: [
      "Domingo cumplido con honores.",
      "El parque nos vuelve a ver el próximo fin.",
      "Familia feliz, pies felices.",
    ],
  },
  {
    id: "uniforme-de-diario",
    etiqueta: "Mi uniforme de diario",
    tipos: ["tenis", "mocasin", "zapato"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in her signature simple outfit, capsule-wardrobe energy",
        "a Mexican woman in her early 30s with three nearly identical outfits on hangers behind",
      ],
      hombre: [
        "a Mexican man in his 30s in his repeat-fit uniform: clean tee, jeans and the featured footwear",
        "a Mexican man in his late 20s with a rack of similar shirts behind, minimalist energy",
      ],
    },
    escenas: [
      "by a simple clothes rack with repeated outfits, wearing the featured footwear as the constant",
      "in front of the mirror in the daily uniform, pointing down at the featured footwear",
    ],
    narrativas: [
      "one continuous take: they show the repeated outfits on the rack, then point at the featured footwear as the piece that makes the uniform work, and shrug happily",
      "one continuous take: mirror check of the daily fit, they tap the featured footwear toe on the floor twice and tell the camera the days-per-week count",
    ],
    hooks: [
      "Me visto igual casi diario, y este es el porqué de aquí abajo.",
      "Mi uniforme personal tiene una pieza que no cambio.",
      "Decidir menos en las mañanas empezó por los pies.",
      "Cinco días a la semana, el mismo acierto.",
    ],
    cierres: [
      "Uniforme aprobado, mente despejada.",
      "Menos decisiones, mejores mañanas.",
      "Lo simple, cuando funciona, no se toca.",
    ],
  },
  {
    id: "chamba-de-pie",
    etiqueta: "Chamba de pie todo el día",
    tipos: ["tenis", "zapato", "mocasin"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in a service-job polo, name tag hint, shift-ready",
        "a Mexican woman in her early 30s in a work apron, behind-the-counter energy",
      ],
      hombre: [
        "a Mexican man in his 30s in a work polo with a lanyard, retail-floor energy",
        "a Mexican man in his late 20s in a barista apron, double-shift mode",
      ],
    },
    escenas: [
      "at home in the work uniform before the shift, putting on the featured footwear",
      "after the shift, apron over the chair, sitting and showing the featured footwear",
    ],
    narrativas: [
      "one continuous take: uniform on, they lace the featured footwear, stand and mime the counter-to-kitchen walk they do two hundred times a day",
      "one continuous take: after the shift they hang the apron, sit, lift a featured shoe and rate the day from their feet's point of view",
    ],
    hooks: [
      "Los que trabajamos de pie sabemos: el calzado ES el sueldo emocional.",
      "Ocho horas atendiendo gente; mis pies ya no son el problema.",
      "Cambié de {palabra} y mi turno cambió, así de simple.",
      "Nadie te avisa que el uniforme más importante va abajo.",
    ],
    cierres: [
      "Al turno de mañana, sin miedo.",
      "Trabajar de pie sin morir en el intento: se puede.",
      "Corran la voz en su chamba.",
    ],
  },
  {
    id: "paseo-con-el-perro",
    etiqueta: "Paseando al perro",
    tipos: ["tenis", "sandalia_agua"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s holding a dog leash and poop bags, morning-walk energy",
        "a Mexican woman in her early 30s in casual clothes wrapping a leash around her hand",
      ],
      hombre: [
        "a Mexican man in his 30s with a leash over his shoulder, park-route regular energy",
        "a Mexican man in his late 20s holding a ball launcher and a leash, dog-dad mode",
      ],
    },
    escenas: [
      "by the door holding a leash (no dog on camera yet), wearing the featured footwear",
      "back from the walk with the leash hanging by the door, showing the featured footwear",
    ],
    narrativas: [
      "one continuous take: leash in hand they explain the twice-a-day route, lift one featured shoe and tap the sole showing what park paths demand",
      "one continuous take: hanging the leash they look down at the featured footwear, lift a foot to show it clean and comment on dodging the sprinklers",
    ],
    hooks: [
      "Dos vueltas diarias al parque, llueva o truene: mi perro no negocia.",
      "El paseo de las 7am me tenía los tenis destrozados… tenía.",
      "Mi perro camina 5 km diarios; yo también, aunque no quiera.",
      "Los del club del paseo matutino me van a entender.",
    ],
    cierres: [
      "Mi perro aprueba este mensaje.",
      "Vuelta de la noche, allá vamos.",
      "Paseos largos, cero pretextos.",
    ],
  },
  {
    id: "domingo-de-vueltas",
    etiqueta: "Domingo de vueltas",
    tipos: ["tenis", "sandalia", "mocasin"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with a list on her phone, errand-run energy",
        "a Mexican woman in her early 30s with reusable bags in hand, Sunday-mission mode",
      ],
      hombre: [
        "a Mexican man in his 30s with car keys and a pickup list, errand-day energy",
        "a Mexican man in his late 20s checking a to-do list out loud, mission mode",
      ],
    },
    escenas: [
      "by the door reading the errand list out loud, wearing the featured footwear",
      "back home with bags accomplished, sitting and pointing at the featured footwear",
    ],
    narrativas: [
      "one continuous take: they count the errands on their fingers, look down at the featured footwear and nod like 'we got this', grabbing the keys",
      "one continuous take: dropping the bags they collapse on the chair dramatically, lift a featured shoe and admit the day was long but painless",
    ],
    hooks: [
      "Súper, tintorería, ferretería y casa de mi mamá: domingo normal.",
      "Siete pendientes, un solo par de {palabra}.",
      "El día de vueltas se sobrevive con estrategia… y buen paso.",
      "Mi lista tenía 9 paradas; mis pies, cero quejas.",
    ],
    cierres: [
      "Lista tachada, semana lista.",
      "Las vueltas se hacen solas así.",
      "Ahora sí: sillón, merecido.",
    ],
  },
  {
    id: "recien-lavados",
    etiqueta: "Quedaron como nuevos",
    tipos: ["tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s holding freshly cleaned sneakers with visible satisfaction",
        "a Mexican woman in her early 30s by a drying rack with clean sneakers, care-day energy",
      ],
      hombre: [
        "a Mexican man in his 30s holding a just-cleaned pair like a trophy",
        "a Mexican man in his late 20s with a soft brush and the cleaned featured sneakers",
      ],
    },
    escenas: [
      "by the laundry area holding the freshly cleaned featured sneakers to the light",
      "at a table with a soft brush beside, the featured sneakers looking box-fresh",
    ],
    narrativas: [
      "one continuous take: they rotate the clean featured sneakers under the light, point at the white parts and tell the camera how they washed them",
      "one continuous take: they hold the featured sneakers next to their face like a commercial joke, laugh, and show sole and fabric close to the lens",
    ],
    hooks: [
      "Los lavé pensando 'ya valieron'… y miren esto.",
      "Seis meses de uso y quedaron COMO NUEVOS.",
      "El chisme es que estos {palabra} sí aguantan lavadas.",
      "Antes de tirarlos, lávenlos. Bueno, si son de estos.",
    ],
    motivos: [
      "El material aguanta lavadas y no se deforma ni amarillea.",
      "Se secan rápido y quedan sin manchas.",
      "Comprar calidad se nota justo en el primer lavado.",
    ],
    cierres: [
      "Como recién sacados de la caja.",
      "Otros seis meses de vida, mínimo.",
      "Cuidarlos sí vale la pena cuando responden.",
    ],
  },
  // -------------------------------------------------------------------------
  // Tacones: eventos, oficina y noche
  // -------------------------------------------------------------------------
  {
    id: "boda-en-puerta",
    etiqueta: "Tengo una boda",
    tipos: ["tacon", "zapato"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in an elegant guest dress, invitation on the dresser",
        "a Mexican woman in her early 30s with event makeup done, jewelry going on",
      ],
      hombre: [
        "a Mexican man in his 30s in a suit shirt and slacks, tie hanging loose, wedding-guest prep",
        "a Mexican man in his late 20s checking a formal outfit in the mirror",
      ],
    },
    escenas: [
      "by the dresser with an invitation visible, holding the featured footwear as the outfit's final piece",
      "sitting elegantly putting on the featured footwear, formal outfit nearly complete",
    ],
    narrativas: [
      "one continuous take: they show the invitation, then the featured footwear, put them on and do the ceremony-to-dance-floor endurance pledge to the camera",
      "one continuous take: they fasten the featured footwear, stand tall, smooth the outfit and give a formal little spin ending in a smile",
    ],
    hooks: [
      "Boda el sábado: el vestido fue fácil, ESTO era lo importante.",
      "Ceremonia, banquete y pista: seis horas. Elijan bien, se los ruego.",
      "A la quinta boda del año por fin aprendí este truco.",
      "Los novios duran para siempre; el dolor de pies no debería.",
    ],
    motivos: [
      "Aguantan de la ceremonia hasta la última canción.",
      "Elegantes pero con el pie sujeto: nada de andar resbalándose.",
      "La plantilla acolchada se siente desde el primer paso.",
    ],
    cierres: [
      "Que viva el amor… y los pies sin ampollas.",
      "Lista para la pista.",
      "Me verán bailar hasta el final.",
    ],
  },
  {
    id: "graduacion",
    etiqueta: "Mi graduación",
    tipos: ["tacon", "zapato"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 20s with a graduation sash hint on the chair, big-day energy",
        "a Mexican woman in her mid 20s with formal dress and done hair, milestone-day glow",
      ],
      hombre: [
        "a Mexican man in his early 20s in a formal shirt with a folded gown on the bed",
        "a Mexican man in his mid 20s adjusting a tie, graduation-day nerves and pride",
      ],
    },
    escenas: [
      "in the bedroom with a graduation gown hint on the bed, putting on the featured footwear",
      "by the mirror in the formal graduation outfit, the featured footwear completing it",
    ],
    narrativas: [
      "one continuous take: they put on the featured footwear, stand, take a practice walk like crossing the stage and mime receiving the diploma with a laugh",
      "one continuous take: final mirror check, they point at the featured footwear, straighten up proud and give the camera the 'ya nos graduamos' nod",
    ],
    hooks: [
      "Cuatro años de estudio y 20 metros de escenario: que no me falle el paso.",
      "El outfit de graduación se planea; el caminar al estrado, más.",
      "Hoy me gradúo, y voy pisando seguro.",
      "La foto del título es para siempre; el calzado tenía que estar a la altura.",
    ],
    cierres: [
      "Por los que vienen: lo logramos.",
      "Directo al estrado, sin tropiezos.",
      "Generación con estilo, qué quieren que les diga.",
    ],
  },
  {
    id: "oficina-ejecutiva",
    etiqueta: "Lunes de oficina ejecutiva",
    tipos: ["tacon"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in a blazer and tailored pants, leadership energy",
        "a Mexican woman in her late 20s in office attire with a structured bag, corporate-chic",
      ],
      hombre: [],
    },
    escenas: [
      "by the mirror in full office attire, stepping into the featured heels",
      "at the entry table grabbing a structured bag, the featured heels on, boss energy",
    ],
    narrativas: [
      "one continuous take: she steps into the featured heels, straightens the blazer, and does the confident office walk towards the camera ending in a direct look",
      "one continuous take: bag on the shoulder she checks the featured heels once more, taps one heel on the floor to show stability and heads out mid-sentence",
    ],
    hooks: [
      "Lunes, junta a las 9 y estos tacones que me hacen sentir imparable.",
      "El poder también se camina, y se camina cómodo.",
      "Nueve horas de oficina en tacones: sí se puede, CON estos.",
      "Mi outfit de 'hoy se firma el proyecto'.",
    ],
    motivos: [
      "La altura perfecta: presencia sin castigo.",
      "El taconeo se siente firme, nada de tambalearse en juntas.",
      "A las 6pm siguen igual de cómodos que a las 9am.",
    ],
    cierres: [
      "A cerrar la semana como se debe.",
      "Ejecutiva y cómoda: las dos cosas.",
      "El lunes no me gana.",
    ],
  },
  {
    id: "cena-elegante",
    etiqueta: "Cena elegante",
    tipos: ["tacon", "zapato", "mocasin"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in a satin dress, fine-dining night energy",
        "a Mexican woman in her late 20s with an elegant updo, reservation-at-8 glow",
      ],
      hombre: [
        "a Mexican man in his 30s in a blazer over a fine knit, dinner-reservation energy",
        "a Mexican man in his late 20s doing cufflinks or watch, upscale-dinner prep",
      ],
    },
    escenas: [
      "in evening attire by warm lamp light, putting on the featured footwear as the final touch",
      "by the door with an elegant coat over the arm, the featured footwear catching the light",
    ],
    narrativas: [
      "one continuous take: they put on the featured footwear under warm light, stand and adjust the outfit, and walk two elegant steps towards the lens",
      "one continuous take: coat over the arm they look down at the featured footwear, angle the foot so the light catches it and give a subtle approving nod",
    ],
    hooks: [
      "Reservación a las 8:30: el look tenía que estar impecable.",
      "Para cenas así, los detalles importan… todos.",
      "Elegancia de pies a cabeza, literalmente de pies.",
      "El restaurante es fancy; mi paso, más.",
    ],
    cierres: [
      "Buen provecho para nosotros.",
      "Noches así se caminan con estilo.",
      "La reservación estaba a mi altura.",
    ],
  },
  {
    id: "noche-de-antro",
    etiqueta: "Noche de antro",
    tipos: ["tacon", "bota"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 20s in a going-out outfit, pre-party playlist energy",
        "a Mexican woman in her late 20s doing final touches with going-out makeup",
      ],
      hombre: [],
    },
    escenas: [
      "in the bedroom with going-out energy, music-video lighting from a warm lamp, holding the featured footwear",
      "by the mirror in the full night-out fit, stepping into the featured footwear",
    ],
    narrativas: [
      "one continuous take: she holds the featured footwear to the camera, puts them on, and does a two-step dance move to test them with a laugh",
      "one continuous take: full fit check in the mirror, she points at the featured footwear, does a slow turn and ends with confident direct eye contact",
    ],
    hooks: [
      "Hoy se baila TODA la noche, y vengo preparada.",
      "El test definitivo de unos tacones es la pista del antro.",
      "Mis amigas llevan flats de repuesto; yo ya no.",
      "De 10pm a 3am sin sentarme: reto aceptado.",
    ],
    cierres: [
      "Nos vemos en la pista.",
      "La noche es larga y yo estoy lista.",
      "Que suene la que sabemos.",
    ],
  },
  {
    id: "madrina-de-xv",
    etiqueta: "Madrina del evento",
    tipos: ["tacon"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 30s in an elegant formal dress, godmother-of-the-event energy",
        "a Mexican woman in her early 40s with a formal hairstyle, family-event pride",
      ],
      hombre: [],
    },
    escenas: [
      "in an elegant formal dress by the dresser, putting on the featured heels with ceremony",
      "holding the featured heels next to the formal dress on the hanger, comparing the match",
    ],
    narrativas: [
      "one continuous take: she holds the featured heels against the dress to show the match, puts them on and stands with the posture the occasion deserves",
      "one continuous take: heels on, she walks a slow elegant line towards the camera, turns and tells the camera the hours the event will last",
    ],
    hooks: [
      "De madrina no se puede fallar, y menos de los pies.",
      "El evento dura 8 horas; la madrina, completa hasta el final.",
      "El vestido llegó primero, pero esto era lo que faltaba.",
      "Señoras: elegancia y comodidad SÍ existen juntas.",
    ],
    cierres: [
      "Esta madrina baila hasta el final.",
      "Que empiece el vals.",
      "Todo listo para las fotos.",
    ],
  },
  {
    id: "tacones-que-si-aguantan",
    etiqueta: "Tacones que sí aguantan",
    tipos: ["tacon"],
    publicos: ["mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s holding the featured heels like presenting evidence",
        "a Mexican woman in her early 30s sitting with the featured heels on her lap, review mode",
      ],
      hombre: [],
    },
    escenas: [
      "sitting on the couch with the featured heels on her lap, honest-review posture",
      "standing holding one featured heel by the arch, pointing at its parts like a teacher",
    ],
    narrativas: [
      "one continuous take: she points at the heel, the insole and the front width one by one, then puts them on and stands to prove the stable walk",
      "one continuous take: heels on, she goes up on them, holds the position steady, walks a line and turns without wobbling, narrating each step",
    ],
    hooks: [
      "Llevo años diciendo 'los tacones son tortura'; vengo a retractarme.",
      "El problema no eran mis pies, eran mis tacones.",
      "Les explico POR QUÉ estos no torturan, punto por punto.",
      "Compré tacones sin llorar después: historia real.",
    ],
    cierres: [
      "Se acabó el mito: era cuestión de encontrar los buenos.",
      "Mis pies y yo firmamos la paz.",
      "Ahora sí, tacones sin miedo.",
    ],
  },
  // -------------------------------------------------------------------------
  // Mocasines y zapatos: oficina, formal y versátil
  // -------------------------------------------------------------------------
  {
    id: "lunes-de-oficina",
    etiqueta: "Lunes de oficina",
    tipos: ["mocasin", "zapato"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in smart-casual office wear, Monday-morning coffee in hand",
      ],
      hombre: [
        "a Mexican man in his 30s in a crisp shirt tucking in the last side, office-Monday energy",
        "a Mexican man in his late 20s with a laptop bag and travel mug, commute-ready",
      ],
    },
    escenas: [
      "by the door with a laptop bag, stepping into the featured shoes for the office week",
      "at the entry mirror doing the Monday check: shirt, watch, and the featured shoes",
    ],
    narrativas: [
      "one continuous take: they slip into the featured shoes without using hands, look up impressed, grab the laptop bag and give the camera the 'vamos' nod",
      "one continuous mirror take: they run the Monday checklist out loud ending at the featured shoes, tap one toe on the floor and head out mid-sentence",
    ],
    hooks: [
      "El lunes se gana o se pierde desde que te vistes.",
      "Cinco días de oficina empiezan aquí abajo.",
      "Mi kit de lunes: café, playlist y {estas} {palabra}.",
      "Verse formal sin sufrir TODO el día: se puede, les enseño.",
    ],
    cierres: [
      "Feliz lunes, ahora sí.",
      "La semana ya arrancó con el pie derecho.",
      "Oficina: aquí vamos.",
    ],
  },
  {
    id: "junta-importante",
    etiqueta: "Junta importante",
    tipos: ["mocasin", "zapato", "tacon"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in a sharp blazer reviewing notes, big-meeting energy",
      ],
      hombre: [
        "a Mexican man in his 30s in a jacket adjusting his collar, presentation-day focus",
        "a Mexican man in his late 30s with a folder under his arm, decisive energy",
      ],
    },
    escenas: [
      "by the mirror in sharp business attire, the featured shoes as the finishing touch",
      "at the desk at home grabbing a folder and keys, wearing the featured shoes",
    ],
    narrativas: [
      "one continuous take: they straighten the jacket, look down at the featured shoes, nod like closing the deal already, and walk firmly towards the camera",
      "one continuous take: folder in hand they pause at the mirror, point at the featured shoes and rehearse one confident line to the camera with a smile",
    ],
    hooks: [
      "Hoy se presenta EL proyecto; el look no podía fallar.",
      "A las juntas importantes se llega pisando firme, literal.",
      "La primera impresión sube desde los zapatos, créanme.",
      "Presentación a las 10: confianza puesta desde las 8.",
    ],
    cierres: [
      "A cerrar ese trato.",
      "El proyecto es bueno; el paso, mejor.",
      "Deséenme éxito, aunque ya lo traigo puesto.",
    ],
  },
  {
    id: "viernes-casual",
    etiqueta: "Viernes casual",
    tipos: ["mocasin", "tenis"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in jeans and a nice blouse, casual-Friday energy",
      ],
      hombre: [
        "a Mexican man in his 30s in dark jeans and a polo, Friday-office mood",
        "a Mexican man in his late 20s swapping his formal shoes for the featured pair, TGIF energy",
      ],
    },
    escenas: [
      "in the bedroom swapping the week's formal outfit for Friday casual, the featured footwear ready",
      "by the mirror in the casual-Friday fit, pointing at the featured footwear",
    ],
    narrativas: [
      "one continuous take: they place the formal shoes aside, slip into the featured footwear, and their whole posture relaxes as they turn to the camera happy",
      "one continuous take: they show the casual fit, point at the featured footwear as the key Friday piece, and do a little end-of-week shoulder dance",
    ],
    hooks: [
      "Viernes casual: el mejor invento corporativo de la historia.",
      "Cambio de zapatos, cambio de humor. Así funciona.",
      "El viernes se viste distinto y se camina distinto.",
      "De la oficina a donde sea, sin escala en casa.",
    ],
    cierres: [
      "Feliz viernes a todos.",
      "Que empiece el fin de semana.",
      "El viernes también se pisa rico.",
    ],
  },
  {
    id: "viaje-de-trabajo",
    etiqueta: "Viaje de trabajo",
    tipos: ["mocasin", "zapato"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s packing a compact carry-on with business clothes",
      ],
      hombre: [
        "a Mexican man in his 30s folding a jacket into a carry-on, business-trip mode",
        "a Mexican man in his late 30s with a garment bag over the arm, frequent-flyer energy",
      ],
    },
    escenas: [
      "at home packing a business carry-on, placing the featured shoes on top as the one pair for everything",
      "by the door with a garment bag and a carry-on, wearing the featured shoes",
    ],
    narrativas: [
      "one continuous take: they pack while talking, hold up the featured shoes explaining they cover the flight, the meetings and the dinner, and place them in",
      "one continuous take: they check the itinerary on the phone, look down at the featured shoes and nod at the camera: one pair, three days, zero problems",
    ],
    hooks: [
      "Viaje de trabajo: 3 días, una maleta y UN par que sirva para todo.",
      "El truco del viajero de negocios está en los pies.",
      "Vuelo, junta y cena con el cliente: mismos zapatos, cero drama.",
      "Empacar ligero se logra con piezas que hacen doble turno.",
    ],
    cierres: [
      "Maleta cerrada, viaje resuelto.",
      "Nos vemos en la terminal.",
      "Un par bien elegido vale por tres.",
    ],
  },
  {
    id: "sin-agujetas",
    etiqueta: "Se ponen en un segundo",
    tipos: ["mocasin"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s with car keys in hand, running-late-but-fine energy",
      ],
      hombre: [
        "a Mexican man in his 30s grabbing his things in a hurry, slip-on-and-go energy",
        "a Mexican man in his late 20s timing himself putting shoes on, playful test energy",
      ],
    },
    escenas: [
      "by the door in a slight hurry, sliding into the featured loafers hands-free",
      "sitting on the entry bench with a phone timer visible, the featured loafers ready for the test",
    ],
    narrativas: [
      "one continuous take: keys in hand they slide into the featured loafers without stopping, celebrate the two-second win and head for the door",
      "one continuous take: they start the timer, slip both featured loafers on, stop the timer and show the screen to the camera laughing",
    ],
    hooks: [
      "Se me hizo tarde… bueno, se me hacía. Ya no.",
      "Reto: ponerse los zapatos en menos de 3 segundos.",
      "Sin agujetas, sin agacharse, sin drama. Miren esto.",
      "El invento que mis mañanas necesitaban.",
    ],
    cierres: [
      "Dos segundos, listo, adiós.",
      "Las prisas ya no me despeinan.",
      "Eficiencia también en los pies.",
    ],
  },
  {
    id: "entrevista-de-trabajo",
    etiqueta: "Entrevista de trabajo",
    tipos: ["zapato", "mocasin", "tacon"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her mid 20s in interview attire reviewing her CV, hopeful energy",
      ],
      hombre: [
        "a Mexican man in his mid 20s in a pressed shirt holding a printed CV, interview-day nerves",
        "a Mexican man in his early 30s adjusting his collar, career-jump energy",
      ],
    },
    escenas: [
      "by the mirror in interview attire with a CV folder on the table, the featured shoes on",
      "sitting putting on the featured shoes carefully, interview outfit complete",
    ],
    narrativas: [
      "one continuous take: they rehearse a greeting to the mirror, look down at the featured shoes, straighten up with confidence and pick up the CV folder",
      "one continuous take: they put on the featured shoes like armor, stand, take a composed breath and give the camera the 'wish me luck' look",
    ],
    hooks: [
      "Entrevista a las 11: que hablen mi CV… y mi presencia.",
      "Dicen que te miran de arriba a abajo; abajo también hay que estar listo.",
      "El puesto es mío; el outfit ya hizo su parte.",
      "Primera impresión: un solo intento. Vine preparado.",
    ],
    motivos: [
      "Se ven impecables sin gritar 'estreno': justo el tono para una entrevista.",
      "Cómodos para la espera, la caminata y los nervios.",
      "Combinan con el traje y con el pantalón de vestir: una compra, mil usos.",
    ],
    cierres: [
      "Les cuento cómo me fue.",
      "A ese puesto le tengo ganas.",
      "Contratado… bueno, casi.",
    ],
  },
  {
    id: "estreno-en-la-oficina",
    etiqueta: "Estreno en la oficina",
    tipos: ["zapato", "mocasin"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s opening a shoe box on her desk at home, small-joy energy",
      ],
      hombre: [
        "a Mexican man in his 30s unboxing the featured shoes next to his office bag",
        "a Mexican man in his late 20s holding the featured shoes up before their first office day",
      ],
    },
    escenas: [
      "at the home desk with an open shoe box, lifting the featured shoes for their first office day",
      "by the door dressed for work, putting on the featured shoes fresh out of the box",
    ],
    narrativas: [
      "one continuous take: they open the box, check the featured shoes closely, put them on and take the ceremonial first steps towards the camera",
      "one continuous take: dressed for the office they put on the brand-new featured shoes, flex a foot to show comfort from minute one and grab their bag",
    ],
    hooks: [
      "Estrenar zapatos en lunes debería ser tradición nacional.",
      "El miedo de estrenar es la ampolla del primer día; aquí no pasó.",
      "Zapatos nuevos, actitud nueva: así de fácil funciona.",
      "Primer día de estos {palabra} en la oficina: reporte en vivo.",
    ],
    cierres: [
      "Estreno aprobado desde el día uno.",
      "La oficina va a preguntar, ya sé.",
      "Cero ampollas, puro estilo.",
    ],
  },
  {
    id: "del-trabajo-a-la-cena",
    etiqueta: "Del trabajo a la cena",
    tipos: ["zapato", "mocasin", "tacon", "bota"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s swapping a blazer for earrings, office-to-dinner transition",
        "a Mexican woman in her early 30s letting her hair down after the workday, evening plan energy",
      ],
      hombre: [
        "a Mexican man in his 30s rolling his sleeves and losing the tie, office-to-dinner switch",
        "a Mexican man in his late 20s swapping his laptop bag for just keys and wallet",
      ],
    },
    escenas: [
      "by the mirror doing the office-to-dinner outfit switch, the featured footwear staying on",
      "at the entry table leaving the work bag and grabbing the evening essentials, featured footwear on",
    ],
    narrativas: [
      "one continuous take: they remove the blazer or tie, adjust the rest, point at the featured footwear staying put, and head out with evening energy",
      "one continuous take: quick mirror transition, they show the same featured footwear works for both halves of the day and give a knowing look to the camera",
    ],
    hooks: [
      "Sales de la oficina a las 7 y la cena es a las 7:30: ¿te cambias? No.",
      "El truco del outfit doble turno está en elegir bien AQUÍ.",
      "De la junta a la cena sin pasar por casa: logrado.",
      "Un par que sirve de sol a sol Y de noche: existe.",
    ],
    cierres: [
      "La agenda llena ya no me estresa.",
      "Doble turno, mismo estilo.",
      "Cena, allá voy.",
    ],
  },
  {
    id: "domingo-familiar",
    etiqueta: "Comida del domingo",
    tipos: ["zapato", "mocasin", "sandalia", "tenis"],
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s in nice-but-comfy Sunday clothes, family-lunch energy",
        "a Mexican woman in her late 20s holding a dessert to take to grandma's house",
      ],
      hombre: [
        "a Mexican man in his 30s in a fresh polo holding car keys, Sunday-lunch mode",
        "a Mexican man in his late 20s carrying a bag of bread for the family table",
      ],
    },
    escenas: [
      "by the door holding a dessert or bread bag for the family lunch, wearing the featured footwear",
      "at the entry mirror in Sunday-nice clothes, the featured footwear completing the look",
    ],
    narrativas: [
      "one continuous take: dessert in hand they explain the Sunday ritual, show the featured footwear with a down-pan of the phone, and open the door mid-goodbye",
      "one continuous take: they check the Sunday look in the mirror, point at the featured footwear as the 'arreglado pero cómodo' key and grab the keys",
    ],
    hooks: [
      "Comida en casa de la abuela: hay que ir presentable, dice mi mamá.",
      "El domingo familiar pide un look 'arreglado sin exagerar'.",
      "Entre la sobremesa y el fútbol, el domingo se alarga; mejor ir cómodo.",
      "Look aprobado por mamá Y cómodo: el santo grial.",
    ],
    cierres: [
      "Nos vemos en la sobremesa.",
      "Domingo en familia, como debe ser.",
      "La abuela aprueba; eso es todo lo que importa.",
    ],
  },
  {
    id: "zapatos-de-confianza",
    etiqueta: "El par de confianza",
    tipos: ["zapato", "mocasin"],
    publicos: ["hombre", "mujer"],
    perfiles: {
      mujer: [
        "a Mexican woman in her early 30s holding her go-to shoes with affection, trusted-item energy",
      ],
      hombre: [
        "a Mexican man in his 30s holding his trusted everyday shoes like an old friend",
        "a Mexican man in his late 30s polishing his go-to pair with a soft cloth",
      ],
    },
    escenas: [
      "sitting with the featured shoes in hand and a soft cloth beside, caretaker energy",
      "by a small shoe shelf where the featured shoes clearly hold the prime spot",
    ],
    narrativas: [
      "one continuous take: they give the featured shoes a last pass with the cloth, hold them to the light, and tell the camera how many occasions these have solved",
      "one continuous take: they point at the shelf hierarchy, take the featured shoes from the top spot, and list on their fingers where these have gone with them",
    ],
    hooks: [
      "Todos tenemos UN par que nunca falla; les presento el mío.",
      "Boda, junta, viaje y hasta un bautizo: estos han ido a todo.",
      "Si mi clóset se incendiara, esto es lo que salvo.",
      "El par al que siempre regreso, y por qué.",
    ],
    cierres: [
      "Confianza que se gana a pasos.",
      "Cada quien tiene su par; este es el mío.",
      "Los básicos buenos no son gasto, son patrimonio.",
    ],
  },
  // -------------------------------------------------------------------------
  // Transversales: formatos que venden para cualquier producto
  // -------------------------------------------------------------------------
  {
    id: "problema-solucion",
    etiqueta: "Problema y solución",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s starting visibly annoyed about a daily foot problem, then relieved",
        "a Mexican woman in her early 30s with 'I've had enough' energy that turns into a satisfied smile",
      ],
      hombre: [
        "a Mexican man in his 30s starting frustrated about uncomfortable shoes, then genuinely relieved",
        "a Mexican man in his late 20s with fed-up energy that flips to convinced",
      ],
    },
    escenas: [
      "sitting on the couch edge holding the featured footwear as 'the fix', frustration-to-relief arc",
      "by the door mid-story, the featured footwear held up right as the story turns",
    ],
    narrativas: [
      "one continuous take: they start venting the problem with expressive frustration, then lift the featured footwear into frame as the turning point, put them on and let the relief show in their whole posture",
      "one continuous take: they mime the old daily struggle, freeze, present the featured footwear to the lens like the plot twist, and end walking comfortably towards the camera",
    ],
    hooks: [
      "¿También llegan con los pies destrozados a su casa? Esto va para ustedes.",
      "Tenía un problema TODOS los días… hasta hace dos semanas.",
      "Si te truena la espalda por culpa de tus zapatos, quédate.",
      "El problema no eras tú, era tu calzado. Punto.",
    ],
    cierres: [
      "Problema resuelto, siguiente pregunta.",
      "Ojalá alguien me lo hubiera dicho antes.",
      "De nada, futuro yo… y futuros ustedes.",
    ],
  },
  {
    id: "unboxing-asmr",
    etiqueta: "Unboxing ASMR",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman's well-kept hands opening a shoe box on a clean table, face mostly out of frame, intimate close-up energy",
        "a Mexican woman in her late 20s leaning over a shoe box, camera focused on her hands and the product",
      ],
      hombre: [
        "a Mexican man's hands carefully opening a shoe box on a wooden table, face mostly out of frame",
        "a Mexican man in his 30s leaning over the box, the camera close on hands, paper and product",
      ],
    },
    escenas: [
      "close-up on a clean table: hands lifting the box lid slowly, tissue paper crisp around the featured footwear",
      "close-up: hands peeling the seal and unwrapping the tissue paper from the featured footwear, textures front and center",
    ],
    narrativas: [
      "one continuous close-up take, mostly hands: the lid slides off slowly, the tissue paper crinkles audibly, fingers trace the texture and stitching of the featured footwear, and both hands present it steady to the lens — minimal talking, sounds carry the video",
      "one continuous macro-style take: the seal peels, the paper unfolds, fingertips tap the sole and run along the material of the featured footwear, ending with a slow satisfied reveal to the camera",
    ],
    hooks: [
      "Súbanle al volumen a este unboxing…",
      "Escuchen esto, no digo nada más.",
      "El paquete que estaba esperando por fin llegó.",
      "Modo ASMR: activado.",
    ],
    motivos: [
      "El sonido del papel, la textura del material… se antoja hasta por audio.",
      "De la caja al pie sin filtros: así llega tal cual.",
      "Hay compras que se disfrutan desde que abres la caja.",
    ],
    cierres: [
      "Y así se abre una buena compra.",
      "El resto del unboxing… ya está en mis pies.",
      "¿Le llegó el ASMR? A mí sí.",
    ],
  },
  {
    id: "resena-tres-puntos",
    etiqueta: "Reseña directa en 3 puntos",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with fast, punchy creator energy, holding the featured footwear to the camera",
        "a Mexican woman in her early 30s with confident reviewer energy, straight to the lens",
      ],
      hombre: [
        "a Mexican man in his 30s with direct high-energy reviewer vibes, product in hand",
        "a Mexican man in his late 20s talking fast and sharp, holding the featured footwear firmly",
      ],
    },
    escenas: [
      "standing center frame holding the featured footwear at chest height, direct-to-camera energy",
      "sitting close to the camera with the featured footwear in hand, rapid-review setup",
    ],
    narrativas: [
      "one continuous punchy take: they hold the featured footwear firmly, count three quick points on their fingers — comfort, quality, price — showing the relevant part of the product at each point, and close looking straight into the lens",
      "one continuous take: high energy from second one, they flip the featured footwear once to show sole then top, land the three points fast and end with a mic-drop gesture",
    ],
    hooks: [
      "Deja de hacer scroll: 3 puntos y te dejo ir.",
      "Reseña honesta en 15 segundos, va.",
      "Tres razones, cero rodeos.",
      "Me pidieron la reseña; aquí está, cortita y al grano.",
    ],
    cierres: [
      "Punto. Se los dije rápido y claro.",
      "Tres de tres; ustedes deciden.",
      "Reseña completa, tiempo respetado.",
    ],
  },
  {
    id: "antes-y-despues",
    etiqueta: "Antes y después",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s doing a clear before-after demonstration with expressive contrast",
        "a Mexican woman in her early 30s acting the tired 'before' and the renewed 'after'",
      ],
      hombre: [
        "a Mexican man in his 30s playing exhausted 'before' and comfortable 'after' with visible contrast",
        "a Mexican man in his late 20s doing an expressive transformation bit",
      ],
    },
    escenas: [
      "in the living room with the worn-out old footwear on one side and the featured pair on the other",
      "sitting with the old beaten pair in one hand and the featured pair in the other, comparison ready",
    ],
    narrativas: [
      "one continuous take: they slump showing the 'before' with the old worn footwear, then switch to the featured pair in the same spot and their whole posture, walk and face transform — same place, new energy",
      "one continuous take: old pair up first with a grimace, featured pair up next with a grin; they put the featured pair on and do the confident after-walk towards the lens",
    ],
    hooks: [
      "El antes y el después que mis pies necesitaban.",
      "Así me veía caminando hace un mes… y así me veo hoy.",
      "La transformación no fue en el gym, fue aquí abajo.",
      "Del 'ya no aguanto' al 'ni los siento': documentado.",
    ],
    cierres: [
      "El cambio se nota, ¿o no?",
      "No vuelvo al antes ni de broma.",
      "La mejor actualización del año.",
    ],
  },
  {
    id: "dia-en-mi-vida",
    etiqueta: "Un día en mi vida",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s narrating her daily routine with warm vlog energy",
        "a Mexican woman in her early 30s mid-routine at home, natural day-in-the-life vibes",
      ],
      hombre: [
        "a Mexican man in his 30s narrating his day with relaxed vlog energy",
        "a Mexican man in his late 20s mid-morning-routine, coffee in hand, casual narration",
      ],
    },
    escenas: [
      "mid-morning-routine in the kitchen with coffee, the featured footwear naturally on",
      "moving through the apartment mid-routine, the featured footwear part of the day without posing",
    ],
    narrativas: [
      "one continuous take: they narrate the day's plan while moving naturally through the space — coffee, keys, bag — with the featured footwear present in every step, ending with a quick honest word about them to the camera",
      "one continuous take: routine in motion, they pause once, look down as if just remembering the featured footwear, give them a casual honest mention, and continue the day",
    ],
    hooks: [
      "Un día normal en mi vida, sin guion… bueno, casi.",
      "Se vienen conmigo hoy: café, pendientes y pasos, muchos pasos.",
      "POV: mi rutina de diario, con el detalle que la sostiene.",
      "Mi día en 15 segundos, empezando por lo importante.",
    ],
    cierres: [
      "Y así, un día más.",
      "Lo cotidiano también se disfruta.",
      "Mañana se repite, y qué bueno.",
    ],
  },
  {
    id: "pov-te-los-compraste",
    etiqueta: "POV: por fin los compraste",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with 'treat yourself' satisfaction, package finally in hands",
        "a Mexican woman in her early 30s with giddy just-arrived-package energy",
      ],
      hombre: [
        "a Mexican man in his 30s with quiet satisfaction holding the awaited box",
        "a Mexican man in his late 20s with 'finally pulled the trigger' energy",
      ],
    },
    escenas: [
      "at the door holding the just-delivered box with visible anticipation",
      "on the couch with the box on the lap, savoring the moment before opening",
    ],
    narrativas: [
      "one continuous take: they hold the box, take a dramatic breath, open it and lift the featured footwear with the satisfaction of a long-considered purchase, trying one on immediately",
      "one continuous take: box on the lap, they narrate the weeks of doubt, open it, and the smile at the featured footwear says the doubt is over; first try-on in frame",
    ],
    hooks: [
      "POV: por fin te compraste lo que llevabas meses viendo.",
      "Los tuve en el carrito TRES semanas. Se acabó el sufrimiento.",
      "Hoy me llegó el 'me lo merezco' en caja.",
      "La compra que pospuse mil veces, ya está aquí.",
    ],
    cierres: [
      "Valieron cada peso y cada semana de espera.",
      "Mi único arrepentimiento: no comprarlos antes.",
      "El carrito por fin descansa.",
    ],
  },
  {
    id: "una-semana-despues",
    etiqueta: "Una semana después",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with honest check-in energy, the featured footwear showing light use",
        "a Mexican woman in her early 30s doing the one-week verdict, notes-on-phone energy",
      ],
      hombre: [
        "a Mexican man in his 30s giving the one-week honest report, product in hand",
        "a Mexican man in his late 20s doing a follow-up review, straightforward energy",
      ],
    },
    escenas: [
      "sitting with the featured footwear in hand showing honest light wear after one week",
      "standing wearing the featured footwear, week-review energy, pointing at specific spots",
    ],
    narrativas: [
      "one continuous take: they hold the featured footwear close to the lens, point at how each part held up after a week — sole, material, shape — and give the honest verdict wearing them",
      "one continuous take: they recap the week's use on their fingers (days, places, hours), lift one foot with the featured footwear and close with the would-I-rebuy answer",
    ],
    hooks: [
      "Ya pasó una semana: les debía este veredicto.",
      "Siete días de uso REAL, sin filtros: va el reporte.",
      "¿Aguantaron la primera semana? Respuesta corta: miren.",
      "Actualización prometida: una semana después.",
    ],
    cierres: [
      "Semana uno: superada. Les cuento en un mes.",
      "Veredicto honesto: van para largo.",
      "Los compraría otra vez hoy mismo.",
    ],
  },
  {
    id: "vs-los-viejos",
    etiqueta: "Contra mis viejos",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s holding her destroyed old pair next to the featured one, comparison energy",
        "a Mexican woman in her early 30s doing a side-by-side verdict with both pairs",
      ],
      hombre: [
        "a Mexican man in his 30s with his beat-up old pair and the featured pair, judge energy",
        "a Mexican man in his late 20s comparing soles of both pairs to the camera",
      ],
    },
    escenas: [
      "at a table with the worn old pair and the featured pair side by side, tribunal energy",
      "holding one of each — the old one and the featured one — at chest height for comparison",
    ],
    narrativas: [
      "one continuous take: they raise the old pair with a sigh and the featured pair with pride, compare soles sole-to-sole near the lens, and retire the old ones with a respectful pat",
      "one continuous take: point-by-point comparison holding both — shape, sole, material — ending with the featured pair going on their feet and the old pair going in a box",
    ],
    hooks: [
      "Mis viejos me duraron 3 años; veamos si estos los superan.",
      "Comparación en vivo: los de antes contra los de ahora.",
      "Le fui fiel a mis viejos hasta que vi ESTO.",
      "Jubilé a mis {palabra} de siempre, y esta es la razón.",
    ],
    cierres: [
      "Gracias por su servicio; hay relevo.",
      "La nueva generación llegó fuerte.",
      "El veredicto fue unánime.",
    ],
  },
  {
    id: "cuanto-costaron",
    etiqueta: "¿Y cuánto costaron?",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with 'you won't believe the price' energy, playful suspense",
        "a Mexican woman in her early 30s doing the price-reveal bit with a knowing smile",
      ],
      hombre: [
        "a Mexican man in his 30s with smart-shopper energy, holding the featured footwear",
        "a Mexican man in his late 20s doing the guess-the-price game with the camera",
      ],
    },
    escenas: [
      "holding the featured footwear to the camera with price-tease energy, home background",
      "sitting with the featured footwear on the knee, playing guess-the-price with the audience",
    ],
    narrativas: [
      "one continuous take: they show the featured footwear from every angle asking the camera to guess, build suspense with the fingers counting, and react to the 'reveal' with honest satisfaction",
      "one continuous take: they list what these look like they cost versus what they actually deliver, showing material and sole up close, and end with the smart-purchase nod",
    ],
    hooks: [
      "Adivinen cuánto costaron. No, menos. MENOS.",
      "Me han preguntado el precio como 20 veces; va la respuesta.",
      "Se ven caros, ¿verdad? Ese es el chiste.",
      "Relación calidad-precio: les presento al campeón.",
    ],
    motivos: [
      "Se ven del doble de lo que costaron, mínimo.",
      "Comparé en tres lados antes de comprar: aquí gana por paliza.",
      "A ese precio, esta calidad casi no existe.",
    ],
    cierres: [
      "Compra inteligente se llama esto.",
      "El precio se los dejo en la publicación.",
      "De nada por el dato.",
    ],
  },
  {
    id: "lo-que-pedi-vs-llego",
    etiqueta: "Lo que pedí vs. lo que llegó",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s holding her phone with the product listing next to the real product",
        "a Mexican woman in her early 30s comparing screen and reality with pleasant surprise",
      ],
      hombre: [
        "a Mexican man in his 30s holding the phone listing beside the real featured footwear",
        "a Mexican man in his late 20s doing the expectation-vs-reality check, impressed",
      ],
    },
    escenas: [
      "holding the phone with the listing photo next to the real featured footwear, comparison in frame",
      "at a table with the delivery box open, phone propped showing the listing, featured footwear in hand",
    ],
    narrativas: [
      "one continuous take: they hold the phone screen beside the real featured footwear matching angles, move both closer to the lens, and confirm detail by detail that it arrived as promised",
      "one continuous take: they scroll the listing out loud, lift the real product to match each photo, and give the camera the 'esta vez sí' verdict",
    ],
    hooks: [
      "Lo que pedí versus lo que llegó: edición sin sustos.",
      "Todos hemos sido estafados en línea; hoy NO fue el caso.",
      "Pedí con miedo, abrí con miedo… y miren esto.",
      "La foto contra la realidad: juzguen ustedes.",
    ],
    cierres: [
      "Idénticos a la foto: confianza recuperada.",
      "Esta vez internet cumplió.",
      "Pedido con miedo, aprobado con gusto.",
    ],
  },
  {
    id: "me-lo-preguntan-mucho",
    etiqueta: "Me lo preguntan mucho",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s answering the most-asked question with friendly energy",
        "a Mexican woman in her early 30s doing a 'you asked, I answer' piece to the camera",
      ],
      hombre: [
        "a Mexican man in his 30s answering the repeated question with good-natured energy",
        "a Mexican man in his late 20s reading an imaginary comment and answering it",
      ],
    },
    escenas: [
      "sitting close to the camera with the featured footwear in hand, Q&A energy",
      "standing wearing the featured footwear, answering the question everyone asks",
    ],
    narrativas: [
      "one continuous take: they read the recurring question out loud with a smile, lift the featured footwear and answer it thoroughly showing the exact detail people ask about",
      "one continuous take: they count the times they've been asked this week, then answer once and for all, demonstrating on the featured footwear as they go",
    ],
    hooks: [
      "Cada vez que salgo con {estas} {palabra} me preguntan lo mismo.",
      "Bueno, ya: la respuesta que me piden cada semana.",
      "En la comida de ayer me lo volvieron a preguntar. Va de nuevo.",
      "La pregunta que no falla: '¿y esos dónde?'.",
    ],
    cierres: [
      "Ya saben la respuesta; corran la voz.",
      "Siguiente pregunta, por favor.",
      "Y sí: valen la pena.",
    ],
  },
  {
    id: "storytime-de-la-compra",
    etiqueta: "Storytime de la compra",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s in storytelling mode, expressive hands, cozy corner",
        "a Mexican woman in her early 30s telling the backstory with chisme energy",
      ],
      hombre: [
        "a Mexican man in his 30s telling the purchase story with amused energy",
        "a Mexican man in his late 20s in storyteller mode, leaning towards the camera",
      ],
    },
    escenas: [
      "sitting comfortably close to the camera with the featured footwear beside, storytime setup",
      "on the couch with storytelling energy, the featured footwear on their lap as the protagonist",
    ],
    narrativas: [
      "one continuous take: they tell the mini-story of how they found these — the doubt, the sign, the decision — holding the featured footwear up at the story's turning point, and end with the moral wearing them",
      "one continuous take: chisme-energy storytelling with expressive hands, the featured footwear raised like evidence at each plot point, closing with the happy ending on their feet",
    ],
    hooks: [
      "Storytime de cómo {estas} {palabra} llegaron a mi vida.",
      "Les tengo un chisme, y el protagonista está en mis pies.",
      "Todo empezó un martes cualquiera en mi celular…",
      "La historia detrás de mi mejor compra del año.",
    ],
    cierres: [
      "Fin del storytime; principio de la recomendación.",
      "Y vivieron cómodos para siempre.",
      "Moraleja: háganle caso a las señales.",
    ],
  },
  {
    id: "cinco-segundos",
    etiqueta: "Te convenzo en 5 segundos",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with challenge energy, timer face, product held high",
        "a Mexican woman in her early 30s with quick-pitch energy straight to the lens",
      ],
      hombre: [
        "a Mexican man in his 30s with bet-you-can't-resist energy, product in hand",
        "a Mexican man in his late 20s doing the five-second pitch with a grin",
      ],
    },
    escenas: [
      "center frame holding the featured footwear up like a countdown is running",
      "close to the camera with one hand showing five fingers, the featured footwear in the other",
    ],
    narrativas: [
      "one continuous take: they count down from five on their fingers while firing one crisp selling point per second, showing the featured footwear's key detail at each count, and land the close exactly at zero",
      "one continuous take: rapid-fire pitch with the featured footwear rotating once between hands, ending frozen towards the lens with a 'ya te convencí' smile",
    ],
    hooks: [
      "Cinco segundos para convencerte, corre el tiempo. YA.",
      "Apuesto a que no llegas al final sin quererlos.",
      "Cinco, cuatro, tres… ya casi te convenzo.",
      "Si esto no te convence en 5 segundos, no era para ti.",
    ],
    cierres: [
      "Cero. ¿Ya viste? Te lo dije.",
      "Tiempo. Y sí: te convencí.",
      "Cinco segundos bien invertidos.",
    ],
  },
  {
    id: "lo-bueno-y-lo-malo",
    etiqueta: "Lo bueno y lo no tan bueno",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with balanced honest-reviewer energy, notes-ready posture",
        "a Mexican woman in her early 30s doing a fair pros-and-cons piece",
      ],
      hombre: [
        "a Mexican man in his 30s with credible honest-review energy, product in hand",
        "a Mexican man in his late 20s doing the fair-review format, straight talk",
      ],
    },
    escenas: [
      "sitting with the featured footwear in hand, honest-review posture, neutral background",
      "at a table with the featured footwear centered, reviewer setup",
    ],
    narrativas: [
      "one continuous take: they list the genuine strengths showing each on the featured footwear, then one honest minor con with a shrug, and land on the overall verdict wearing them",
      "one continuous take: pros counted on one hand, the small con admitted openly, the featured footwear held to the lens for the final balanced call",
    ],
    hooks: [
      "Reseña honesta: lo bueno Y lo no tan bueno.",
      "Nadie les dice los peros; yo sí.",
      "¿Perfectos? No. ¿Los recomiendo? Escuchen primero.",
      "La reseña sin filtro que me hubiera gustado ver antes de comprar.",
    ],
    motivos: [
      "Lo bueno pesa mucho más que el detallito, y eso casi nunca pasa.",
      "El único pero se olvida a los dos días de uso.",
      "Con todo y su detalle, siguen ganando por goleada.",
    ],
    cierres: [
      "Balance final: sí, con ganas.",
      "Honestidad completa: los volvería a comprar.",
      "Ustedes tienen el contexto completo; decidan.",
    ],
  },
  {
    id: "mi-top-del-closet",
    etiqueta: "El top 1 de mi clóset",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s doing a closet ranking with podium energy",
        "a Mexican woman in her early 30s presenting her closet's MVP",
      ],
      hombre: [
        "a Mexican man in his 30s doing his closet's power ranking, product as champion",
        "a Mexican man in his late 20s crowning his most-used pair",
      ],
    },
    escenas: [
      "by an open closet with a few pairs visible, lifting the featured footwear as the winner",
      "with three pairs lined up on the floor, picking up the featured one for the top spot",
    ],
    narrativas: [
      "one continuous take: they gesture at the lineup, do a quick mock-ceremony crowning the featured footwear, and put them on as the champion's lap towards the camera",
      "one continuous take: countdown from third to first place pointing at each pair, the featured footwear raised high at number one with celebration energy",
    ],
    hooks: [
      "Ranking oficial de mi clóset, y el número uno no se discute.",
      "Tengo varios, pero SIEMPRE regreso a estos.",
      "Si solo pudiera quedarme con un par, ya sé cuál.",
      "El MVP de mi clóset, temporada tras temporada.",
    ],
    cierres: [
      "Campeón indiscutible.",
      "El podio tiene dueño.",
      "Top 1, sin debate.",
    ],
  },
  {
    id: "detalle-que-nadie-nota",
    etiqueta: "El detalle que nadie nota",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with 'let me show you something' energy, product close to the lens",
        "a Mexican woman in her early 30s doing a craftsmanship close-up piece",
      ],
      hombre: [
        "a Mexican man in his 30s showing construction details like a connoisseur",
        "a Mexican man in his late 20s pointing out hidden quality details",
      ],
    },
    escenas: [
      "holding the featured footwear very close to the camera, pointing at a specific construction detail",
      "sitting with the featured footwear under good light, detail-inspection energy",
    ],
    narrativas: [
      "one continuous take: they bring the featured footwear close to the lens, trace the stitching, the sole join and the inner padding with a finger, naming why each one matters",
      "one continuous take: they angle the featured footwear under the light to show the hidden details, tap each one, and zoom-lean at the finish with a 'por eso duran' nod",
    ],
    hooks: [
      "Hay un detalle en {estas} {palabra} que casi nadie nota… y lo es todo.",
      "Acérquense, porque esto no se ve a primera vista.",
      "La diferencia entre calzado bueno y barato está AQUÍ.",
      "Les enseño a reconocer calidad en 15 segundos.",
    ],
    motivos: [
      "La costura viene doble y pareja: eso no lo hace el calzado barato.",
      "La suela va cosida, no solo pegada; por eso no se despegan.",
      "El acolchado interior está donde de verdad se necesita.",
    ],
    cierres: [
      "Ahora ya saben qué revisar.",
      "Los detalles no se ven, se sienten… y duran.",
      "Calidad silenciosa, la mejor.",
    ],
  },
  {
    id: "prueba-de-caminata",
    etiqueta: "La prueba de caminar",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s doing a live walk test with commentator energy",
        "a Mexican woman in her early 30s narrating her own steps like a sports review",
      ],
      hombre: [
        "a Mexican man in his 30s doing the walk test up and down, reviewer narration",
        "a Mexican man in his late 20s testing flex, grip and bounce on camera",
      ],
    },
    escenas: [
      "in a hallway or living room with walking space, wearing the featured footwear, test-day energy",
      "standing mid-frame ready to demonstrate steps, the featured footwear laced and set",
    ],
    narrativas: [
      "one continuous take: they walk towards and away from the camera narrating what they feel — heel, arch, push-off — then flex a sole with their hands to show it moves with the foot",
      "one continuous take: normal steps, quick steps and one gentle pivot in the featured footwear, each move narrated, ending with the verdict straight to the lens",
    ],
    hooks: [
      "La prueba de caminata en vivo, sin edición: va.",
      "Se ven bien, sí, ¿pero cómo CAMINAN? Ahorita vemos.",
      "Talón, arco y punta: el test completo en 15 segundos.",
      "Caminemos juntos y les voy contando.",
    ],
    cierres: [
      "Prueba superada, sin asterisco.",
      "Caminan igual de bien que se ven.",
      "Aprobados en movimiento, que es donde importa.",
    ],
  },
  {
    id: "guia-de-talla",
    etiqueta: "¿Qué talla pido?",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with helpful shopping-guide energy, product in hand",
        "a Mexican woman in her early 30s doing a fit-guide piece with clear gestures",
      ],
      hombre: [
        "a Mexican man in his 30s giving practical sizing advice, product held up",
        "a Mexican man in his late 20s doing the fit check demonstration",
      ],
    },
    escenas: [
      "sitting with the featured footwear in hand, sizing-guide energy, direct and helpful",
      "wearing the featured footwear and pointing at the fit around toe and heel",
    ],
    narrativas: [
      "one continuous take: they answer the size question clearly, put the featured footwear on and press the toe area to show the space, tracing where the foot sits",
      "one continuous take: they show the width and the heel grip on the worn featured footwear, give the 'pide tu talla' verdict and a tip for in-between sizes",
    ],
    hooks: [
      "La pregunta del millón: ¿se pide la talla normal o media más?",
      "Antes de comprar, vean esto: les ahorro una devolución.",
      "Guía de talla honesta, de alguien que ya los trae puestos.",
      "¿Talla exacta o media más? Resuelto en 15 segundos.",
    ],
    motivos: [
      "La horma es fiel a la talla: pide la tuya de siempre.",
      "El ancho es amable con pies normales y anchitos.",
      "El talón sujeta sin morder desde el primer día.",
    ],
    cierres: [
      "Pidan con confianza; ya saben cómo talla.",
      "Devoluciones evitadas: de nada.",
      "Talla resuelta, compra segura.",
    ],
  },
  {
    id: "los-volveria-a-comprar",
    etiqueta: "¿Los volvería a comprar?",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s answering the final verdict question, settled and sure",
        "a Mexican woman in her early 30s with long-term-review energy",
      ],
      hombre: [
        "a Mexican man in his 30s giving the would-I-rebuy verdict with calm certainty",
        "a Mexican man in his late 20s doing the final-verdict format",
      ],
    },
    escenas: [
      "sitting relaxed with the featured footwear on, verdict-time energy",
      "holding the featured footwear that shows honest loved-use, straight to the camera",
    ],
    narrativas: [
      "one continuous take: they pose the question out loud, take a fake thinking pause, and answer with total certainty listing the three reasons on their fingers, featured footwear raised at the end",
      "one continuous take: they show the honest wear of the loved pair, compare it to the day they arrived, and answer the rebuy question with zero hesitation",
    ],
    hooks: [
      "La única pregunta que importa: ¿los volvería a comprar?",
      "Después de meses de uso, mi respuesta final.",
      "Esta es la prueba definitiva de cualquier compra.",
      "¿Otra vez? Va la respuesta sin pensarlo… bueno, pensadísima.",
    ],
    cierres: [
      "Sin dudarlo: otra vez y en otro color.",
      "La respuesta corta es sí; la larga, también.",
      "Recompra asegurada; eso lo dice todo.",
    ],
  },
  {
    id: "regalo-acertado",
    etiqueta: "El regalo que sí atiné",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s wrapping or holding a gift-ready shoe box, proud-gifter energy",
        "a Mexican woman in her early 30s with a bow on a shoe box, gift-story mode",
      ],
      hombre: [
        "a Mexican man in his 30s holding a gift-ready box, nailed-the-gift energy",
        "a Mexican man in his late 20s telling the gift story with satisfaction",
      ],
    },
    escenas: [
      "at a table with a shoe box and simple gift wrap, preparing the featured footwear as a gift",
      "holding the wrapped-ready box to the camera, gift-mission-accomplished energy",
    ],
    narrativas: [
      "one continuous take: they place the featured footwear in the box like treasure, close it with the bow, and tell the camera who it's for and why it's a guaranteed win",
      "one continuous take: gift-story mode — the panic of choosing, the discovery, and the featured footwear raised as the answer — ending with the wrapped box patted twice",
    ],
    hooks: [
      "Por fin un regalo que NO van a cambiar en enero.",
      "Le atiné al regalo de mi papá, y les cuento el secreto.",
      "Regalar calzado da miedo… si no sabes esto.",
      "El regalo que me pidieron 'igualito' después de verlo.",
    ],
    motivos: [
      "Es de esos regalos que se usan DIARIO, no que se guardan.",
      "Con la guía de talla no hay pierde, y el cambio es fácil.",
      "Queda bien con todos y para todo: regalo sin riesgo.",
    ],
    cierres: [
      "Misión regalo: cumplida.",
      "Me van a pedir la publicación, ya sé.",
      "El sobrino consentido ahora soy yo.",
    ],
  },
  {
    id: "rutina-de-manana",
    etiqueta: "Mi rutina de salir de casa",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s mid-morning-routine, keys and bag choreography",
        "a Mexican woman in her early 30s doing the leaving-home ritual with practiced speed",
      ],
      hombre: [
        "a Mexican man in his 30s doing his out-the-door routine: wallet, phone, keys",
        "a Mexican man in his late 20s in the morning rush, but with a system",
      ],
    },
    escenas: [
      "by the entry table doing the wallet-phone-keys check, the featured footwear as the final step",
      "moving through the apartment gathering things, ending at the featured footwear by the door",
    ],
    narrativas: [
      "one continuous take: the leaving-home choreography — bag, keys, one last mirror glance — landing on the featured footwear as the final satisfying step before the door",
      "one continuous take: they narrate their exit routine at real speed, slip into the featured footwear last, and pause one second to appreciate it before leaving",
    ],
    hooks: [
      "Mi rutina de salir de casa termina SIEMPRE igual.",
      "Cartera, llaves, teléfono… y el paso final más importante.",
      "El último paso antes de salir define todo el día.",
      "Rutina de salida en 15 segundos, aprendan la coreografía.",
    ],
    cierres: [
      "Y ahora sí: el mundo puede empezar.",
      "Rutina cerrada, día abierto.",
      "El paso final, siempre el mejor.",
    ],
  },
  {
    id: "cerrando-el-dia",
    etiqueta: "Cerrando el día",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s at night with wind-down energy, soft lamp light",
        "a Mexican woman in her early 30s in end-of-day calm, reflective and warm",
      ],
      hombre: [
        "a Mexican man in his 30s at night with the day finally done, relaxed review energy",
        "a Mexican man in his late 20s in evening calm, honest end-of-day recap",
      ],
    },
    escenas: [
      "in warm evening lamp light sitting comfortably, the featured footwear coming off after a full day",
      "by the entry at night, placing the featured footwear on the rack with end-of-day care",
    ],
    narrativas: [
      "one continuous take: they take the featured footwear off slowly, hold one up and review the day it just survived — hours, places, steps — with tired gratitude",
      "one continuous take: they place the featured footwear on its spot on the rack, give it a little pat, and summarize to the camera why today was comfortable",
    ],
    hooks: [
      "Fin del día: la hora en que tus zapatos dicen la verdad.",
      "Trece horas después, el veredicto de la noche.",
      "El día estuvo largo; la queja de mis pies, ausente.",
      "Así se cierra un día bien caminado.",
    ],
    cierres: [
      "Mañana repetimos.",
      "Buenas noches, nos vemos a las 7.",
      "Días largos, pies en paz.",
    ],
  },
  {
    id: "me-la-recomendaron",
    etiqueta: "Me los recomendaron",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s telling how her friend wouldn't stop recommending these",
        "a Mexican woman in her early 30s giving credit to the friend who insisted",
      ],
      hombre: [
        "a Mexican man in his 30s admitting his friend was right about these",
        "a Mexican man in his late 20s telling the 'my compa insisted' story",
      ],
    },
    escenas: [
      "sitting with the featured footwear in hand, telling the recommendation story",
      "wearing the featured footwear, phone in the other hand as if about to text the friend",
    ],
    narrativas: [
      "one continuous take: they reenact the friend's insistence with a laugh, show the featured footwear as the surrender, and admit to the camera the friend was completely right",
      "one continuous take: they mime texting the friend a thank-you, lift the featured footwear to the lens, and pass the recommendation forward to the audience",
    ],
    hooks: [
      "Mi amiga me lo dijo TRES veces antes de que le hiciera caso.",
      "Cuando un compa insiste tanto, o es pirámide o es verdad. Era verdad.",
      "Vengo a darle la razón públicamente a quien me los recomendó.",
      "Me lo recomendaron tanto que caí… y qué bueno.",
    ],
    cierres: [
      "Ahora la que recomienda soy yo.",
      "Gracias, comadre; tenías razón.",
      "La cadena de recomendación sigue con ustedes.",
    ],
  },
  {
    id: "el-par-que-mas-uso",
    etiqueta: "El par que más uso",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s doing the stats of her most-worn pair, playful data energy",
        "a Mexican woman in her early 30s presenting her most-repeated purchase",
      ],
      hombre: [
        "a Mexican man in his 30s counting how many days a week these get worn",
        "a Mexican man in his late 20s doing the most-used-item confession",
      ],
    },
    escenas: [
      "holding the featured footwear that shows honest loved use, stats-presentation energy",
      "by the shoe rack pointing at the empty prime spot, the featured footwear in hand because they're always in use",
    ],
    narrativas: [
      "one continuous take: they count on their fingers the days per week these get worn, show the honest wear points with affection, and put them on like the daily default they are",
      "one continuous take: they point at the rack's prime spot, explain it's always empty because the featured footwear never rests, and demonstrate the grab-and-go habit",
    ],
    hooks: [
      "Estadística real: los uso 5 de 7 días. Mínimo.",
      "El par más trabajador de mi clóset, sin competencia.",
      "Si mis {palabra} cobraran por jornada, ya serían ricos.",
      "Confesión: repito calzado casi diario, y ni me apena.",
    ],
    cierres: [
      "El uso diario es la mejor reseña.",
      "Cinco de siete, semana tras semana.",
      "Lo más usado es lo mejor comprado.",
    ],
  },
  {
    id: "compra-inteligente",
    etiqueta: "Compra inteligente",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s with savvy-shopper energy explaining cost per use",
        "a Mexican woman in her early 30s doing smart-money talk with warm confidence",
      ],
      hombre: [
        "a Mexican man in his 30s doing the cost-per-use math on his fingers",
        "a Mexican man in his late 20s with practical-buyer energy, product in hand",
      ],
    },
    escenas: [
      "sitting with the featured footwear in hand, doing relaxed math-to-camera",
      "standing with the featured footwear on, counting the math on their fingers",
    ],
    narrativas: [
      "one continuous take: they do the cost-per-use math out loud on their fingers, show the featured footwear's condition after all that use, and land the 'sale a pesos por día' punchline",
      "one continuous take: they compare buying cheap twice versus buying right once, holding the featured footwear as exhibit A, and close with the smart-buyer nod",
    ],
    hooks: [
      "Hagamos cuentas: esto me sale en PESOS por día.",
      "Comprar barato dos veces o comprar bien una: matemáticas simples.",
      "Mi cerebro de comprador inteligente hizo estas cuentas.",
      "El costo por uso es la única métrica que importa; va la mía.",
    ],
    motivos: [
      "Entre lo que duran y lo que se usan, salen regaladas.",
      "Es de las compras que se pagan solas en un mes.",
      "Calidad que se nota en la primera semana y en el sexto mes.",
    ],
    cierres: [
      "Cuentas claras, compra hecha.",
      "Eso es invertir, no gastar.",
      "Su lado financiero me lo agradece.",
    ],
  },
  {
    id: "en-la-maleta",
    etiqueta: "Siempre van en mi maleta",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s packing a trip, the featured footwear as the fixed item",
        "a Mexican woman in her early 30s with packing-pro energy, list in hand",
      ],
      hombre: [
        "a Mexican man in his 30s packing his duffel with a system, the featured footwear first in",
        "a Mexican man in his late 20s doing the what's-in-my-bag format",
      ],
    },
    escenas: [
      "at the bed with an open suitcase, placing the featured footwear in first, packing-ritual energy",
      "showing the packed bag's contents one by one, the featured footwear as the highlight",
    ],
    narrativas: [
      "one continuous take: they pack the featured footwear FIRST, explain the rule to the camera, and build the rest of the suitcase around them",
      "one continuous take: the what's-in-my-bag rundown item by item, saving the featured footwear for last with the 'esto NUNCA falta' emphasis",
    ],
    hooks: [
      "Viaje corto o largo, esto entra a la maleta PRIMERO.",
      "Mi regla de empacar tiene un solo artículo fijo.",
      "Qué llevo en la maleta: edición 'lo que nunca falta'.",
      "Puedo olvidar el cargador, pero esto jamás.",
    ],
    cierres: [
      "Maleta lista; el resto es paisaje.",
      "El fijo de todos mis viajes.",
      "Viajen ligero, pero viajen bien pisados.",
    ],
  },
  {
    id: "mito-o-verdad",
    etiqueta: "Mito o verdad",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    perfiles: {
      mujer: [
        "a Mexican woman in her late 20s doing a myth-busting format with playful judge energy",
        "a Mexican woman in her early 30s testing claims one by one, verdict gestures",
      ],
      hombre: [
        "a Mexican man in his 30s doing the myth-or-fact format with gameshow energy",
        "a Mexican man in his late 20s judging common claims with thumbs up or down",
      ],
    },
    escenas: [
      "center frame with the featured footwear in hand, gameshow-judge energy",
      "sitting at a table with the featured footwear as the evidence for each verdict",
    ],
    narrativas: [
      "one continuous take: they state three common beliefs about this kind of footwear and judge each with thumbs — myth, myth, TRUTH — proving the last one on the featured pair",
      "one continuous take: myth-versus-fact rapid round, the featured footwear raised as evidence at each verdict, ending with the one truth that matters",
    ],
    hooks: [
      "Mito o verdad, edición calzado. Empezamos.",
      "Tres cosas que todos creen; solo una es cierta.",
      "Vengo a tumbar mitos con pruebas en mano.",
      "Lo que te dijeron del calzado cómodo… casi todo es mito.",
    ],
    cierres: [
      "Mitos: 0. Verdades: esta.",
      "Caso cerrado, señoría.",
      "Ahora ya saben qué creer.",
    ],
  },
  // -------------------------------------------------------------------------
  // Niños: SIEMPRE presenta mamá o papá; nunca menores en cámara
  // -------------------------------------------------------------------------
  {
    id: "regreso-a-clases-ninos",
    etiqueta: "Regreso a clases",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    soloNinos: true,
    perfiles: {
      mujer: [
        "a Mexican mom in her early 30s with school-supply bags around, back-to-school mission energy, holding the kids' featured footwear (no children on camera)",
        "a Mexican mom in her late 20s checking a school list on her phone, holding the kids' featured footwear (no children on camera)",
      ],
      hombre: [
        "a Mexican dad in his 30s among school supplies, holding the kids' featured footwear (no children on camera)",
      ],
    },
    escenas: [
      "at the dining table with notebooks and school supplies spread out, the kids' featured footwear as the star purchase (no children on camera)",
      "by the door with a new backpack hanging, holding up the kids' featured footwear (no children on camera)",
    ],
    narrativas: [
      "one continuous take: she checks the school list out loud, crosses off 'zapatos' with a victory gesture, and shows the kids' featured footwear to the camera — sole, closure and reinforcement (no children on camera)",
      "one continuous take: among the school supplies she lifts the kids' featured footwear, flexes the sole, shows the easy closure and stacks it as mission complete (no children on camera)",
    ],
    hooks: [
      "Lista de regreso a clases: lo más difícil ya está tachado.",
      "Cada agosto la misma guerra… este año la gané temprano.",
      "El uniforme es fácil; los zapatos son LA decisión.",
      "Mamás y papás: el regreso a clases empieza por los pies.",
    ],
    motivos: [
      "Aguantan el ciclo completo: escuela, recreo y educación física.",
      "El cierre lo manejan solitos: cero batallas en la mañana.",
      "La punta reforzada sobrevive las patadas al balón.",
    ],
    cierres: [
      "Regreso a clases: dominado.",
      "Un pendiente menos, y era el grande.",
      "Este ciclo escolar vamos preparados.",
    ],
  },
  {
    id: "parque-sin-pendientes",
    etiqueta: "Al parque sin pendientes",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    soloNinos: true,
    perfiles: {
      mujer: [
        "a Mexican mom in her early 30s packing the park bag, practical-mom energy, holding the kids' featured footwear (no children on camera)",
        "a Mexican mom in her late 20s by the door with a water bottle and snacks bag, holding the kids' featured footwear (no children on camera)",
      ],
      hombre: [
        "a Mexican dad in his 30s with a ball and the park bag, holding the kids' featured footwear (no children on camera)",
      ],
    },
    escenas: [
      "by the door with the park bag and a ball, holding up the kids' featured footwear (no children on camera)",
      "at the entry bench with the small featured footwear in hand, showing the sole grip (no children on camera)",
    ],
    narrativas: [
      "one continuous take: she shows the park checklist, lifts the kids' featured footwear and presses the sole grip with her thumb explaining slides, ladders and dirt (no children on camera)",
      "one continuous take: he spins the ball once, holds up the kids' featured footwear, points at the toe protection and the secure closure, and nods 'listos' (no children on camera)",
    ],
    hooks: [
      "Tarde de parque: mi único pendiente ya no son sus pies.",
      "Resbaladillas, arena y carreras: estos sí aguantan la tarde.",
      "El parque destruye zapatos… bueno, destruía.",
      "Sábado de parque y cero raspones que lamentar.",
    ],
    motivos: [
      "La suela agarra en resbaladilla, pasamanos y tierra.",
      "La punta reforzada aguanta frenones y patadas.",
      "Se sacuden y quedan; la arena no se les queda dentro.",
    ],
    cierres: [
      "Al parque, sin miedo al éxito.",
      "Que corran todo lo que quieran.",
      "Tarde de parque: aprobada.",
    ],
  },
  {
    id: "crecen-rapidisimo",
    etiqueta: "Crecen rapidísimo",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    soloNinos: true,
    perfiles: {
      mujer: [
        "a Mexican mom in her early 30s holding two sizes of the kids' featured footwear, growth-spurt disbelief energy (no children on camera)",
        "a Mexican mom in her late 20s by the shoe rack with outgrown pairs lined up, holding the kids' featured footwear (no children on camera)",
      ],
      hombre: [
        "a Mexican dad in his 30s comparing the outgrown pair with the new featured one (no children on camera)",
      ],
    },
    escenas: [
      "at the shoe rack with a line of outgrown small shoes, holding the new kids' featured footwear (no children on camera)",
      "at the table with last season's pair beside the new featured pair, size comparison ready (no children on camera)",
    ],
    narrativas: [
      "one continuous take: she lines up the outgrown pairs like a timeline, laughs in disbelief, and presents the new kids' featured footwear explaining why the price makes growing up affordable (no children on camera)",
      "one continuous take: he holds the old tiny pair against the new featured one, shakes his head smiling at how fast they grow, and shows the quality-price of the replacement (no children on camera)",
    ],
    hooks: [
      "Le compré zapatos en marzo. Ya no le quedan. ES JUNIO.",
      "Los niños crecen por semana, el gasto no tiene por qué.",
      "La colección de zapatos que ya no le quedan a mi hijo.",
      "Cambiar de talla cada 4 meses solo funciona con precios así.",
    ],
    motivos: [
      "A este precio, cambiar de talla no duele.",
      "Duran más que la talla: los hereda el hermano.",
      "Calidad de los caros, precio de los que sí puedes recomprar.",
    ],
    cierres: [
      "Que crezcan sano; el zapato ya está resuelto.",
      "La siguiente talla ya está en camino.",
      "Papás: esta es la jugada.",
    ],
  },
  {
    id: "uniforme-que-aguanta",
    etiqueta: "El uniforme sí aguanta",
    tipos: "todos",
    publicos: ["mujer", "hombre"],
    soloNinos: true,
    perfiles: {
      mujer: [
        "a Mexican mom in her early 30s by the washing machine with the kids' featured footwear just cleaned, survivor-story energy (no children on camera)",
        "a Mexican mom in her late 20s inspecting the kids' featured footwear after months of school, impressed (no children on camera)",
      ],
      hombre: [
        "a Mexican dad in his 30s holding the kids' featured footwear after a school semester, inspection energy (no children on camera)",
      ],
    },
    escenas: [
      "by the washing machine holding the freshly cleaned kids' featured footwear (no children on camera)",
      "at the table inspecting the kids' featured footwear seams and sole after months of use (no children on camera)",
    ],
    narrativas: [
      "one continuous take: she shows the just-washed kids' featured footwear, points at the intact stitching and sole after months of school abuse, and gives the survivor verdict (no children on camera)",
      "one continuous take: he runs a finger along the seams like an inspector, flexes the sole, and declares the semester survived with honors (no children on camera)",
    ],
    hooks: [
      "Cuatro meses de escuela después… miren cómo están.",
      "Mi hijo es una máquina de destruir zapatos. Estos siguen vivos.",
      "Reporte de medio ciclo escolar: sobrevivieron.",
      "Los lavé esperando lo peor, y me sorprendieron.",
    ],
    motivos: [
      "Costuras enteras y suela pegada después de meses de recreo.",
      "Se lavan y quedan presentables para toda la semana.",
      "Un solo par aguantó lo que antes eran dos.",
    ],
    cierres: [
      "Sobrevivieron al recreo: máximo honor.",
      "El ciclo escolar los respeta.",
      "Comprobado por el inspector más rudo: mi hijo.",
    ],
  },
];
