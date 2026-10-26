/**
 * Guía para que el CREADOR arme su video de un producto (dueño, 26-oct-2026:
 * «que el creador le pueda picar al producto y le salga una ayuda en la
 * generación de contenido: ideas en qué enfocarse, cómo mostrar el producto
 * y cuáles son sus puntos fuertes»).
 *
 * Todo sale de la CATEGORÍA (dueño, mismo día: «tiene que ser relacionado
 * con la categoría»): lo que la vende (una alpargata es su yute y su cuña),
 * qué rasgos del TÍTULO le importan (memory foam, afelpado, corcho…; la
 * suela antiderrapante solo donde hay agua o piso mojado), sus ideas y sus
 * ganchos; luego la temporada y los datos del catálogo. Un rasgo que el
 * título no menciona no sale.
 */
import type { ProductoInfluencer } from "./influencers";
import { categoriaVisible, rangoTallas } from "./catalogo-vista";
import { pesos } from "./tienda";

export interface GuiaContenido {
  /** lo que hace bueno a ESTE producto, en palabras de venta */
  puntosFuertes: string[];
  /** tomas concretas para enseñar cada punto fuerte */
  comoMostrarlo: string[];
  /** ideas de video para la categoría y la temporada */
  ideas: string[];
  /** frases para los primeros 3 segundos */
  ganchos: string[];
  /** datos para decir en el video o ponerlos en la descripción */
  datos: string[];
}

interface Punto {
  fuerte: string;
  mostrar: string;
}

interface Rasgo extends Punto {
  patron: RegExp;
}

/**
 * Lo que puede decir el TÍTULO. Solo cuenta si la categoría lo admite
 * (`Perfil.rasgos`): casi todo el calzado dice «antiderrapante» y en una
 * alpargata o una bota eso no es lo que la vende (dueño, 26-oct-2026: «no me
 * hables de piso mojado o antideslizante en una alpargata o una bota»).
 */
const RASGOS = {
  memory: {
    patron: /memory ?foam|viscoelastic/,
    fuerte: "Plantilla memory foam que se amolda a tu pie: se siente como pisar una almohada.",
    mostrar: "Aprieta la plantilla con el dedo y deja que regrese sola, en cámara lenta.",
  },
  calido: {
    patron: /afelpad|peluche|felpa|borrego|termic|calid|invern/,
    fuerte: "Interior afelpado que mantiene el pie calientito en los días fríos.",
    mostrar: "Mete la mano y enseña el peluche por dentro, muy de cerca; acompáñalo con algo de frío (café caliente, cobija, mañana nublada).",
  },
  impermeable: {
    patron: /impermeable|resistente al agua|resistentes al agua/,
    fuerte: "Resisten el agua: no se te mojan los pies.",
    mostrar: "Échales agua con una jarra y enseña que por dentro siguen secos.",
  },
  antiderrapante: {
    patron: /antiderrapant|antideslizant|anitiderrapant|traccion/,
    fuerte: "Suela antiderrapante.",
    mostrar: "Enseña la suela de cerca.",
  },
  plataforma: {
    patron: /plataforma|suela gruesa/,
    fuerte: "Plataforma que te da altura sin perder comodidad.",
    mostrar: "Toma de lado a la altura del piso para que se vea la altura; antes y después de ponértelos.",
  },
  corcho: {
    patron: /corcho/,
    fuerte: "Plantilla de corcho que con el uso toma la forma de tu pie.",
    mostrar: "Acércate a la textura del corcho y pasa el dedo por la plantilla.",
  },
  ajustable: {
    patron: /hebilla|hebila|broche|correas? ajustable|cordones ajustables|ajustables?\b/,
    fuerte: "Correas o hebillas ajustables: se acomodan a cualquier pie.",
    mostrar: "Ajusta la hebilla o la correa en cámara y enseña cómo queda firme.",
  },
  secado: {
    patron: /secado rapido|transpirable/,
    fuerte: "Secado rápido y transpirables.",
    mostrar: "Mójalos, sacúdelos y enseña cuánto tardan en secarse (corte de tiempo).",
  },
  ligero: {
    patron: /liger/,
    fuerte: "Muy ligeros: no se sienten en el pie.",
    mostrar: "Sostenlos con un dedo o ponlos en una báscula de cocina.",
  },
  arco: {
    patron: /soporte de arco|ergonomic/,
    fuerte: "Soporte de arco para caminar más tiempo sin cansarte.",
    mostrar: "Enseña la curva de la plantilla de lado, con el dedo siguiendo el arco.",
  },
  cierre: {
    patron: /cremallera|cierre/,
    fuerte: "Cierre lateral: te los pones y te los quitas en segundos.",
    mostrar: "Póntelos en un solo movimiento con el cierre y cuenta los segundos.",
  },
  sinAgujetas: {
    // \b: «viscoelástica» NO es un elástico lateral (GT156).
    patron: /slip on|\belastic|chelsea/,
    fuerte: "Se ponen sin agujetas, de un jalón.",
    mostrar: "Póntelos sin usar las manos o con un solo jalón.",
  },
  gamuza: {
    patron: /gamuza|pana|fieltro/,
    fuerte: "Acabado suave tipo gamuza que se ve fino.",
    mostrar: "Pasa la mano por encima con luz natural para que se vea la textura.",
  },
  tactica: {
    patron: /tactic|militar|senderismo|hiker/,
    fuerte: "Botas tácticas: aguantan trabajo pesado, campo y senderismo.",
    mostrar: "Úsalas en terreno real: tierra, piedras, una subida; termina con las botas de cerca.",
  },
  vaquera: {
    patron: /vaquer|western|cowboy/,
    fuerte: "Estilo vaquero con bordado: el toque western que está de moda.",
    mostrar: "Close-up del bordado y la punta; luego cuerpo completo con jeans.",
  },
  calado: {
    patron: /calado|translucid/,
    fuerte: "Diseño calado o translúcido que se ve fresco y diferente.",
    mostrar: "Ponlos a contraluz para que se vea el diseño.",
  },
  detalles: {
    patron: /remach|estoperol|brillo|pedreria|bordad|animal print|estampad|piedras|liston|herrajes/,
    fuerte: "Detalles decorativos que llaman la atención.",
    mostrar: "Close-up de los detalles con una luz que los haga brillar.",
  },
  tacon: {
    patron: /tacon/,
    fuerte: "Tacón cómodo para aguantar toda la fiesta.",
    mostrar: "Enseña cómo caminas con ellos, de cuerpo completo y de los pies.",
  },
  unisex: {
    patron: /unisex|mujer hombre|hombre mujer|hombre y mujer/,
    fuerte: "Unisex: hay para él y para ella.",
    mostrar: "Graba en pareja o con alguien de la familia usando el mismo modelo.",
  },
} satisfies Record<string, Rasgo>;

type IdRasgo = keyof typeof RASGOS;

/** Hasta cuántos puntos fuertes se enseñan: con más se vuelve lista de supermercado. */
export const MAX_PUNTOS = 5;

type Clima = "frio" | "calor" | "lluvia";

/** Lo que vende a cada CATEGORÍA y qué rasgos del título le importan. */
interface Perfil {
  /** puntos fuertes de la categoría misma (una alpargata siempre es de yute) */
  base: Punto[];
  /** rasgos del título que cuentan para la categoría, en orden de importancia */
  rasgos: IdRasgo[];
  /** el mismo rasgo dicho como le sirve a esta categoría */
  textos?: Partial<Record<IdRasgo, Punto>>;
  ideas: string[];
  ganchos: string[];
  clima?: Clima;
}

type Familia =
  | "alpargata"
  | "agua"
  | "lluvia"
  | "bota"
  | "botaInvierno"
  | "tacon"
  | "corcho"
  | "corchoFrio"
  | "eva"
  | "jelly"
  | "mocasin"
  | "sandaliaModa"
  | "pantufla"
  | "otro";

const PERFILES: Record<Familia, Perfil> = {
  alpargata: {
    base: [
      {
        fuerte: "Suela de yute trenzado: el look de verano que va con vestido, short o jeans.",
        mostrar: "Close-up de la suela de yute girando el zapato en tu mano, con luz natural.",
      },
      {
        fuerte: "Cuña que te da altura y estiliza, más estable que un tacón delgado.",
        mostrar: "Camina hacia la cámara de cuerpo completo para que se vea cómo estiliza la pierna.",
      },
    ],
    rasgos: ["sinAgujetas", "ajustable", "detalles"],
    textos: {
      sinAgujetas: { fuerte: "Correa elástica al tobillo: sujeta sin apretar.", mostrar: "Póntelas en cámara y enseña cómo la correa se acomoda sola." },
    },
    ideas: [
      "Tres outfits de verano con las mismas alpargatas: vestido, short y jeans.",
      "Look para boda en playa, brunch o vacaciones, de pies a cabeza.",
      "Alpargatas en la maleta: lo que llevo a la playa o a un pueblo mágico.",
    ],
    ganchos: ["El zapato de verano que va con todo.", "Altura sin sufrir: mira esta cuña.", "Me preguntan dónde compré estas alpargatas."],
    clima: "calor",
  },
  agua: {
    base: [
      {
        fuerte: "Protegen la planta del pie de la arena caliente, las piedras y las conchas.",
        mostrar: "Camina sobre piedras o arena caliente con ellos puestos.",
      },
      {
        fuerte: "Te los dejas puestos dentro y fuera del agua.",
        mostrar: "Entra al agua con ellos y sal caminando sin quitártelos.",
      },
    ],
    rasgos: ["secado", "antiderrapante", "ligero", "unisex"],
    textos: {
      antiderrapante: { fuerte: "Suela que agarra en piedras mojadas del río y bordes de alberca.", mostrar: "Pisa una piedra mojada o la orilla de la alberca y enseña la suela." },
    },
    ideas: [
      "Día de río, playa o alberca: entra al agua con ellos y enseña cómo agarran en las piedras.",
      "Qué llevar a la playa para no quemarte los pies en la arena.",
      "Mójalos y vuelve a ponértelos: lo rápido que se secan.",
    ],
    ganchos: ["Lo que nadie te dice que lleves a la playa.", "Así ya no te lastiman las piedras del río.", "Se secan en minutos, mira."],
    clima: "calor",
  },
  lluvia: {
    base: [
      {
        fuerte: "Impermeables: llegas con los pies secos aunque haya charcos.",
        mostrar: "Pisa un charco o échales agua con una jarra y enseña que por dentro siguen secas.",
      },
    ],
    rasgos: ["antiderrapante", "sinAgujetas", "ligero", "unisex"],
    textos: {
      antiderrapante: { fuerte: "Suela antiderrapante: no te resbalas en banquetas mojadas.", mostrar: "Camina sobre piso mojado y luego enseña la suela de cerca." },
      sinAgujetas: { fuerte: "Estilo Chelsea: te las pones de un jalón antes de salir.", mostrar: "Póntelas en un solo movimiento en la puerta de tu casa." },
    },
    ideas: [
      "La prueba del charco: brinca en uno y enseña que no entra el agua.",
      "Lo que me pongo los días de lluvia para no llegar mojada.",
      "Para jardín, trabajo o pesca: úsalas en algo real de tu día.",
    ],
    ganchos: ["Que llueva lo que quiera.", "Brinqué en un charco para probarlas.", "Ya no llego con los pies mojados."],
    clima: "lluvia",
  },
  bota: {
    base: [
      {
        fuerte: "Botas que le dan carácter a cualquier outfit, del trabajo a la salida.",
        mostrar: "Cuerpo completo caminando hacia la cámara y luego close-up de las botas.",
      },
    ],
    rasgos: ["tactica", "vaquera", "sinAgujetas", "cierre", "impermeable", "plataforma", "tacon", "gamuza", "detalles", "ligero"],
    textos: {
      sinAgujetas: { fuerte: "Estilo Chelsea con elástico lateral: elegantes y se ponen de un jalón.", mostrar: "Póntelas de un jalón y enseña el elástico de cerca." },
      tacon: { fuerte: "Tacón grueso: altura con estabilidad para todo el día.", mostrar: "Toma de lado caminando para que se vea el tacón." },
      detalles: { fuerte: "Detalles que las hacen únicas (bordado, herrajes).", mostrar: "Close-up de los detalles con buena luz." },
    },
    ideas: [
      "Del trabajo a la salida con las mismas botas: dos looks en un video.",
      "Tres formas de combinarlas: jeans, vestido o pantalón de vestir.",
      "Un día completo con ellas: dónde las llevas y cómo se ven al final.",
    ],
    ganchos: ["Las botas que van con todo.", "Llevo todo el día con ellas y mira cómo están.", "Las botas de la temporada."],
    clima: "frio",
  },
  botaInvierno: {
    base: [
      {
        fuerte: "Botas afelpadas por dentro: calor y estilo para salir en temporada de frío.",
        mostrar: "Mete la mano y enseña el peluche por dentro; luego póntelas para salir.",
      },
    ],
    rasgos: ["plataforma", "gamuza", "detalles", "ligero"],
    ideas: [
      "Outfit de invierno de pies a cabeza con estas botas.",
      "Tres looks con las mismas botas: leggings, jeans y vestido con medias.",
      "Mañana fría: de la cama a la calle sin pasar frío.",
    ],
    ganchos: ["Las botas más calientitas que he tenido.", "POV: ya llegó el frío y estás lista.", "Se ven bonitas y no pasas frío."],
    clima: "frio",
  },
  tacon: {
    base: [
      {
        fuerte: "Elegantes para boda, graduación, posada u oficina.",
        mostrar: "Cuerpo completo con el outfit de la ocasión y luego close-up de los pies.",
      },
    ],
    rasgos: ["tacon", "ajustable", "plataforma", "detalles"],
    textos: {
      ajustable: { fuerte: "Correa ajustable: el pie no se sale al caminar ni al bailar.", mostrar: "Abrocha la correa en cámara y camina." },
    },
    ideas: [
      "El look para la boda, la graduación o la posada, de pies a cabeza.",
      "Cuánto aguanto bailando con ellos: graba al inicio y al final de la fiesta.",
      "Del día a la noche: con jeans y luego con vestido.",
    ],
    ganchos: ["Tacones que sí aguantan toda la fiesta.", "El detalle que completa tu look.", "Me los puse 8 horas y mira."],
  },
  corcho: {
    base: [RASGOS.corcho],
    rasgos: ["memory", "ajustable", "plataforma", "gamuza", "detalles", "unisex"],
    ideas: [
      "Tres outfits con las mismas sandalias: casa, mandado y salida.",
      "Un día completo caminando con ellas: cómo terminan los pies al final.",
      "Las sandalias que usa toda la familia: póntelas con tu pareja o tu mamá.",
    ],
    ganchos: ["Las sandalias que todos me preguntan dónde compré.", "No vuelvo a usar otras chanclas.", "Cómodas de verdad, mira."],
    clima: "calor",
  },
  corchoFrio: {
    base: [RASGOS.corcho, RASGOS.calido],
    rasgos: ["gamuza", "ajustable", "unisex"],
    ideas: [
      "Mi rutina de una mañana fría en casa, de la cama al café con estas puestas.",
      "El regalo que sí van a usar: dáselas a papá, mamá o tu pareja y graba su reacción.",
      "Lo que uso para trabajar o estudiar desde casa cuando hace frío.",
    ],
    ganchos: ["¿Pies fríos en las mañanas? Mira esto.", "Corcho y peluche: la combinación perfecta.", "Ya no me las quito en todo el día."],
    clima: "frio",
  },
  eva: {
    base: [
      {
        fuerte: "De EVA: ligeras, se lavan con agua y no pasa nada si se mojan.",
        mostrar: "Lávalas en el lavabo y sécalas con una toalla en segundos.",
      },
    ],
    rasgos: ["antiderrapante", "plataforma", "arco", "ajustable", "unisex"],
    textos: {
      antiderrapante: { fuerte: "Suela antiderrapante: seguras en la regadera, la alberca o la cocina.", mostrar: "Camina sobre piso mojado y luego enseña la suela de cerca." },
    },
    ideas: [
      "Las chanclas para todo: casa, alberca, gimnasio y regadera.",
      "Lo que llevo en la maleta para la playa o la alberca.",
      "Para toda la familia: graba a cada quien con su color.",
    ],
    ganchos: ["Las chanclas que aguantan todo.", "Ligeras y se lavan en segundos.", "Las uso diario y mira cómo están."],
    clima: "calor",
  },
  jelly: {
    base: [
      {
        fuerte: "Estilo jelly: se ven lindos, no se maltratan con el agua y se limpian en segundos.",
        mostrar: "Ponlos a contraluz y luego lávalos bajo el chorro de agua.",
      },
    ],
    rasgos: ["calado", "ajustable", "tacon", "plataforma", "detalles"],
    textos: {
      tacon: { fuerte: "Tacón bajo: un poco de altura sin perder comodidad.", mostrar: "Toma de lado caminando para que se vea el tacón." },
    },
    ideas: [
      "Look retro o de verano con los jelly como protagonistas.",
      "Tres outfits con los mismos jelly: falda, short y jeans.",
      "Jelly de colores: ¿cuál va contigo?",
    ],
    ganchos: ["Los jelly regresaron y se ven así.", "El zapato de verano más lindo.", "Se lavan en segundos, mira."],
    clima: "calor",
  },
  mocasin: {
    base: [
      {
        fuerte: "Mocasín casual: va con jeans o pantalón de vestir y se ve arreglado sin esfuerzo.",
        mostrar: "Cuerpo completo con dos outfits: casual y más formal.",
      },
    ],
    rasgos: ["ligero", "sinAgujetas", "gamuza"],
    textos: {
      sinAgujetas: { fuerte: "Agujetas elásticas: te los pones sin amarrarlos.", mostrar: "Póntelos de un jalón sin tocar las agujetas." },
    },
    ideas: [
      "Del trabajo al fin de semana con los mismos zapatos.",
      "Outfit de hombre arreglado y cómodo en un minuto.",
      "Un día completo caminando con ellos.",
    ],
    ganchos: ["Zapatos que se ven bien y no pesan nada.", "Arreglado sin sufrir.", "Me los pongo sin amarrarlos, mira."],
  },
  sandaliaModa: {
    base: [
      {
        fuerte: "Sandalias planas con diseño: cómodas todo el día sin verse básicas.",
        mostrar: "Close-up del diseño del empeine y luego camina con un outfit casual.",
      },
    ],
    rasgos: ["memory", "arco", "detalles", "ajustable", "plataforma", "unisex"],
    ideas: [
      "Tres outfits con las mismas sandalias: casa, mandado y salida.",
      "Lo que llevo en la maleta para la playa o la alberca.",
      "Un día completo caminando con ellas: cómo terminan los pies al final.",
    ],
    ganchos: ["Las sandalias que todos me preguntan dónde compré.", "Bonitas y cómodas, ¿se puede?", "No vuelvo a usar otras chanclas."],
    clima: "calor",
  },
  pantufla: {
    base: [
      {
        fuerte: "Pantufla cerrada: pie cómodo y calientito en casa.",
        mostrar: "Graba tu rutina en casa con ellas puestas: cama, cocina y sillón.",
      },
    ],
    rasgos: ["calido", "memory", "antiderrapante", "plataforma", "gamuza", "ajustable", "unisex"],
    textos: {
      antiderrapante: { fuerte: "Suela de goma: sales al patio o por el pan sin cambiarte.", mostrar: "Sal a la puerta o al patio con ellas y enseña la suela." },
    },
    ideas: [
      "Mi rutina de una mañana fría en casa, de la cama al café con estas puestas.",
      "El regalo que sí van a usar: dáselas a papá, mamá o tu pareja y graba su reacción.",
      "Lo que uso para trabajar o estudiar desde casa cuando hace frío.",
    ],
    ganchos: ["¿Pies fríos en las mañanas? Mira esto.", "POV: encontraste las pantuflas más calientitas.", "Ya no me las quito en todo el día."],
    clima: "frio",
  },
  otro: {
    base: [],
    rasgos: Object.keys(RASGOS) as IdRasgo[],
    ideas: [
      "Un día completo usándolos: dónde los llevas y cómo se sienten.",
      "Tres formas de combinarlos.",
      "Primeras impresiones: qué esperabas y qué te encontraste.",
    ],
    ganchos: ["Te enseño por qué me encantaron.", "Esto no lo esperaba por este precio.", "Lo que más me gustó de estos."],
  },
};

function sinAcentos(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** La familia sale de la CATEGORÍA; el título solo decide cuando no hay categoría que diga algo. */
function familiaDe(categoria: string, texto: string): Familia {
  const c = sinAcentos(categoria);
  if (/alpargata/.test(c)) return "alpargata";
  if (/agua|aqua/.test(c)) return "agua";
  if (/lluvia/.test(c)) return "lluvia";
  if (/tacon/.test(c)) return "tacon";
  if (/corcho/.test(c)) return /frio/.test(c) ? "corchoFrio" : "corcho";
  if (/jelly/.test(c)) return "jelly";
  if (/eva/.test(c)) return "eva";
  if (/mocasin/.test(c)) return "mocasin";
  if (/ugg/.test(c) && /bota/.test(c)) return "botaInvierno";
  if (/pantufla|ugg/.test(c)) return "pantufla";
  if (/bota/.test(c)) return "bota";
  if (/moda|sandalia|chancla/.test(c)) return "sandaliaModa";
  if (/botas? de lluvia/.test(texto)) return "lluvia";
  if (/acuatic/.test(texto)) return "agua";
  if (/alpargata/.test(texto)) return "alpargata";
  if (/pantufla/.test(texto)) return "pantufla";
  if (/\bbot(a|as|in|ines)\b/.test(texto)) return "bota";
  if (/sandalia|chancla/.test(texto)) return "sandaliaModa";
  return "otro";
}

/** Lo que pesa según el mes en México (0 = enero). */
function temporada(mes: number, clima: Clima | undefined): string | null {
  if (mes === 10) return "Es temporada de Buen Fin: menciona que es buen momento para comprarlos.";
  if (mes === 11) return "Diciembre: hazlo como idea de regalo de Navidad o intercambio.";
  if (mes === 1) return "Febrero: úsalo como regalo de 14 de febrero.";
  if (clima === "frio" && (mes >= 9 || mes <= 1)) return "Ya empezó el frío: es la mejor época para estos.";
  if (clima === "calor" && mes >= 2 && mes <= 7) return "Temporada de calor y vacaciones: enséñalos en exterior y con sol.";
  if (clima === "lluvia" && mes >= 5 && mes <= 8) return "Temporada de lluvias: graba un día nublado o lluvioso.";
  return null;
}

export function guiaDeContenido(p: ProductoInfluencer, hoy: Date = new Date()): GuiaContenido {
  const texto = sinAcentos(`${p.titulo} ${p.bullets.join(" ")}`);
  const categoria = categoriaVisible(p.categoria) ?? "";
  const perfil = PERFILES[familiaDe(categoria, texto)];

  const ids = perfil.rasgos.filter((id) => RASGOS[id].patron.test(texto));
  // el bordado de una vaquera ya va en su punto: no se repite como «detalles»
  const delTitulo = ids.filter((id) => !(id === "detalles" && ids.includes("vaquera"))).map((id) => perfil.textos?.[id] ?? RASGOS[id]);
  const puntos = [...perfil.base, ...delTitulo.filter((r) => !perfil.base.some((b) => b.fuerte === r.fuerte))].slice(0, MAX_PUNTOS);
  const puntosFuertes = puntos.map((r) => r.fuerte);
  const comoMostrarlo = [
    "Abre con el producto en tu mano o en tus pies, nada de logos ni intro: lo primero que se ve es el zapato.",
    ...puntos.map((r) => r.mostrar),
  ];
  if (p.colores.length > 1) comoMostrarlo.push(`Enseña los ${p.colores.length} colores juntos y di cuál es tu favorito.`);

  const ideas = [...perfil.ideas];
  if (p.colores.length >= 3) ideas.push(`¿Cuál color eres? Pon los ${p.colores.length} colores y pide que comenten el suyo.`);
  ideas.push("Unboxing rápido: abre la caja, póntelos y di tu primera impresión en 15 segundos.");
  const deTemporada = temporada(hoy.getMonth(), perfil.clima);
  if (deTemporada) ideas.unshift(deTemporada);

  const ganchos = [...perfil.ganchos];
  if (p.precioDesde != null) ganchos.push(`Esto cuesta menos de ${pesos(Math.ceil(p.precioDesde / 10) * 10)}.`);

  const tallas = [...new Set(p.colores.flatMap((c) => c.tallas))].sort((a, b) => Number(a) - Number(b));
  const datos: string[] = [];
  const cat = categoriaVisible(p.categoria);
  if (p.modelo) datos.push(`Modelo ${p.modelo}${cat ? ` · ${cat.toLocaleLowerCase("es-MX")}` : ""}.`);
  if (p.colores.length) datos.push(`Colores: ${p.colores.map((c) => c.color).join(", ")}.`);
  if (tallas.length) {
    datos.push(`Tallas ${rangoTallas(tallas)} (mexicanas). La talla es el largo del pie en centímetros: invita a medirse el pie antes de pedir.`);
  }
  if (p.precioDesde != null) datos.push(`Precio en TikTok Shop: ${pesos(p.precioDesde)}.`);
  if (p.total != null && p.total > 0) datos.push(`Hay ${p.total.toLocaleString("es-MX")} pares en stock: puedes decir que hay para surtir.`);

  return { puntosFuertes, comoMostrarlo, ideas, ganchos, datos };
}

/** La guía en texto para copiarla y pegarla en las notas del celular. */
export function textoDeGuia(p: ProductoInfluencer, g: GuiaContenido): string {
  const bloque = (titulo: string, xs: string[]) => (xs.length ? [`${titulo}:`, ...xs.map((x) => `• ${x}`), ""] : []);
  return [
    `GETAC ${p.modelo ?? ""} · ideas para tu video`.trim(),
    "",
    ...bloque("Puntos fuertes", g.puntosFuertes),
    ...bloque("Cómo mostrarlo", g.comoMostrarlo),
    ...bloque("Ideas de video", g.ideas),
    ...bloque("Para los primeros 3 segundos", g.ganchos),
    ...bloque("Datos", g.datos),
  ]
    .join("\n")
    .trim();
}
