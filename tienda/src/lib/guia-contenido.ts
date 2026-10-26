/**
 * Guía para que el CREADOR arme su video de un producto (dueño, 26-oct-2026:
 * «que el creador le pueda picar al producto y le salga una ayuda en la
 * generación de contenido: ideas en qué enfocarse, cómo mostrar el producto
 * y cuáles son sus puntos fuertes»).
 *
 * Nada se inventa: los puntos fuertes salen de lo que dice el TÍTULO de la
 * publicación (antiderrapante, memory foam, afelpado, corcho…), las ideas de
 * la categoría y la temporada, y los datos de los colores, tallas, precio y
 * existencia que ya trae el catálogo. Una característica que el título no
 * menciona no sale.
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

interface Rasgo {
  id: string;
  patron: RegExp;
  fuerte: string;
  mostrar: string;
}

/** El orden es el de importancia: los primeros mandan cuando hay muchos. */
const RASGOS: Rasgo[] = [
  {
    id: "memory",
    patron: /memory ?foam|viscoelastic/,
    fuerte: "Plantilla memory foam que se amolda a tu pie: se siente como pisar una almohada.",
    mostrar: "Aprieta la plantilla con el dedo y deja que regrese sola, en cámara lenta.",
  },
  {
    id: "calido",
    patron: /afelpad|peluche|felpa|borrego|termic|calid|invern|frio/,
    fuerte: "Interior afelpado que mantiene el pie calientito en los días fríos.",
    mostrar: "Mete la mano y enseña el peluche por dentro, muy de cerca; acompáñalo con algo de frío (café caliente, cobija, mañana nublada).",
  },
  {
    id: "impermeable",
    patron: /impermeable|resistente al agua|resistentes al agua|hule|pvc/,
    fuerte: "Impermeables: el agua no pasa.",
    mostrar: "Échales agua con una jarra o pisa un charco y enseña que por dentro siguen secos.",
  },
  {
    id: "antiderrapante",
    patron: /antiderrapant|antideslizant|anitiderrapant|traccion/,
    fuerte: "Suela antiderrapante: no se resbalan en piso mojado ni en el baño.",
    mostrar: "Camina sobre piso mojado o un azulejo y luego enseña la suela de cerca.",
  },
  {
    id: "plataforma",
    patron: /plataforma|suela gruesa/,
    fuerte: "Plataforma que te da altura sin perder comodidad.",
    mostrar: "Toma de lado a la altura del piso para que se vea la altura; antes y después de ponértelos.",
  },
  {
    id: "corcho",
    patron: /corcho/,
    fuerte: "Plantilla de corcho que con el uso toma la forma de tu pie.",
    mostrar: "Acércate a la textura del corcho y pasa el dedo por la plantilla.",
  },
  {
    id: "ajustable",
    patron: /hebilla|hebila|broche|correas? ajustable|cordones ajustables|ajustables?\b/,
    fuerte: "Correas o hebillas ajustables: se acomodan a cualquier pie.",
    mostrar: "Ajusta la hebilla o la correa en cámara y enseña cómo queda firme.",
  },
  {
    id: "secado",
    patron: /secado rapido|transpirable/,
    fuerte: "Secado rápido y transpirables: perfectos para agua y calor.",
    mostrar: "Mójalos, sacúdelos y enseña cuánto tardan en secarse (corte de tiempo).",
  },
  {
    id: "ligero",
    patron: /liger|ultraliger/,
    fuerte: "Muy ligeros: no se sienten en el pie.",
    mostrar: "Sostenlos con un dedo o ponlos en una báscula de cocina.",
  },
  {
    id: "arco",
    patron: /soporte de arco|ergonomic/,
    fuerte: "Soporte de arco para caminar más tiempo sin cansarte.",
    mostrar: "Enseña la curva de la plantilla de lado, con el dedo siguiendo el arco.",
  },
  {
    id: "cierre",
    patron: /cremallera|cierre/,
    fuerte: "Cierre lateral: te los pones y te los quitas en segundos.",
    mostrar: "Póntelos en un solo movimiento con el cierre y cuenta los segundos.",
  },
  {
    id: "sinAgujetas",
    // \b: «viscoelástica» NO es un elástico lateral (GT156).
    patron: /slip on|\belastic|chelsea/,
    fuerte: "Se ponen sin agujetas, de un jalón.",
    mostrar: "Póntelos sin usar las manos o con un solo jalón.",
  },
  {
    id: "gamuza",
    patron: /gamuza|pana|fieltro/,
    fuerte: "Acabado suave tipo gamuza que se ve fino.",
    mostrar: "Pasa la mano por encima con luz natural para que se vea la textura.",
  },
  {
    id: "eva",
    patron: /\beva\b|jelly/,
    fuerte: "Material que no pesa y se lava fácil con agua.",
    mostrar: "Lávalos en el lavabo y sécalos con una toalla en segundos.",
  },
  {
    id: "detalles",
    patron: /remach|estoperol|brillo|pedreria|bordad|animal print|estampad|piedras|liston|herrajes/,
    fuerte: "Detalles decorativos que llaman la atención.",
    mostrar: "Close-up de los detalles con una luz que los haga brillar.",
  },
  {
    id: "tacon",
    patron: /tacon/,
    fuerte: "Tacón cómodo para aguantar toda la fiesta.",
    mostrar: "Enseña cómo caminas con ellos, de cuerpo completo y de los pies.",
  },
  {
    id: "unisex",
    patron: /unisex|mujer hombre|hombre mujer|hombre y mujer/,
    fuerte: "Unisex: hay para él y para ella.",
    mostrar: "Graba en pareja o con alguien de la familia usando el mismo modelo.",
  },
];

/** Hasta cuántos puntos fuertes se enseñan: con más se vuelve lista de supermercado. */
export const MAX_PUNTOS = 5;

type Familia = "frio" | "sandalia" | "bota" | "lluvia" | "agua" | "tacon" | "otro";

function sinAcentos(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function familiaDe(categoria: string, texto: string): Familia {
  const c = sinAcentos(categoria);
  if (/lluvia/.test(c) || /botas? de lluvia/.test(texto)) return "lluvia";
  if (/agua|aqua/.test(c) || /acuatic/.test(texto)) return "agua";
  if (/tacon/.test(c)) return "tacon";
  if (/pantufla|ugg|frio/.test(c) || /afelpad|peluche|termic/.test(texto)) return "frio";
  if (/bota/.test(c) || /\bbot(a|as|in|ines)\b/.test(texto)) return "bota";
  if (/corcho|eva|jelly|sandalia|alpargata|moda/.test(c) || /sandalia|chancla/.test(texto)) return "sandalia";
  return "otro";
}

const IDEAS: Record<Familia, string[]> = {
  frio: [
    "Mi rutina de una mañana fría en casa, de la cama al café con estas puestas.",
    "El regalo que sí van a usar: dáselas a papá, mamá o tu pareja y graba su reacción.",
    "Lo que uso para trabajar o estudiar desde casa cuando hace frío.",
  ],
  sandalia: [
    "Tres outfits con las mismas sandalias: casa, mandado y salida.",
    "Lo que llevo en la maleta para la playa o la alberca.",
    "Un día completo caminando con ellas: cómo terminan los pies al final.",
  ],
  bota: [
    "Del trabajo a la salida con las mismas botas: dos looks en un video.",
    "Tres formas de combinarlas con jeans, vestido o falda.",
    "Prueba de caminata: un día completo en la calle con ellas.",
  ],
  lluvia: [
    "La prueba del charco: brinca en uno y enseña que no entra el agua.",
    "Lo que me pongo los días de lluvia para no llegar mojada.",
    "Para jardín, trabajo o pesca: úsalas en algo real de tu día.",
  ],
  agua: [
    "Día de río, playa o alberca: entra al agua con ellos y enseña cómo agarran en las piedras.",
    "Qué llevar a la playa para no quemarte los pies en la arena.",
    "Mójalos y vuelve a ponértelos: lo rápido que se secan.",
  ],
  tacon: [
    "El look para la boda, la graduación o la posada, de pies a cabeza.",
    "Cuánto aguanto bailando con ellos: graba al inicio y al final de la fiesta.",
    "Del día a la noche: con jeans y luego con vestido.",
  ],
  otro: [
    "Un día completo usándolos: dónde los llevas y cómo se sienten.",
    "Tres formas de combinarlos.",
    "Primeras impresiones: qué esperabas y qué te encontraste.",
  ],
};

const GANCHOS: Record<Familia, string[]> = {
  frio: ["¿Pies fríos en las mañanas? Mira esto.", "POV: encontraste las pantuflas más calientitas.", "Ya no me las quito en todo el día."],
  sandalia: ["Las sandalias que todos me preguntan dónde compré.", "No vuelvo a usar otras chanclas.", "Cómodas de verdad, mira."],
  bota: ["Las botas que van con todo.", "Llevo todo el día con ellas y mira cómo están.", "El calzado que me salvó esta temporada."],
  lluvia: ["Que llueva lo que quiera.", "Brinqué en un charco para probarlas.", "Ya no llego con los pies mojados."],
  agua: ["Lo que nadie te dice que lleves a la playa.", "Así ya no te lastiman las piedras del río.", "Se secan en minutos, mira."],
  tacon: ["Tacones que sí aguantan toda la fiesta.", "El detalle que completa tu look.", "Me los puse 8 horas y mira."],
  otro: ["Te enseño por qué me encantaron.", "Esto no lo esperaba por este precio.", "Lo que más me gustó de estos."],
};

/** Lo que pesa según el mes en México (0 = enero). */
function temporada(mes: number, familia: Familia): string | null {
  if (mes === 10) return "Es temporada de Buen Fin: menciona que es buen momento para comprarlos.";
  if (mes === 11) return "Diciembre: hazlo como idea de regalo de Navidad o intercambio.";
  if (mes === 1) return "Febrero: úsalo como regalo de 14 de febrero.";
  if (familia === "frio" && (mes >= 9 || mes <= 1)) return "Ya empezó el frío: es la mejor época para estas.";
  if ((familia === "sandalia" || familia === "agua") && mes >= 2 && mes <= 7) return "Temporada de calor y vacaciones: enséñalos en exterior y con sol.";
  if (familia === "lluvia" && mes >= 5 && mes <= 8) return "Temporada de lluvias: graba un día nublado o lluvioso.";
  return null;
}

export function guiaDeContenido(p: ProductoInfluencer, hoy: Date = new Date()): GuiaContenido {
  const texto = sinAcentos(`${p.titulo} ${p.bullets.join(" ")}`);
  const categoria = categoriaVisible(p.categoria) ?? "";
  const familia = familiaDe(categoria, texto);

  const rasgos = RASGOS.filter((r) => r.patron.test(texto)).slice(0, MAX_PUNTOS);
  const puntosFuertes = rasgos.map((r) => r.fuerte);
  const comoMostrarlo = [
    "Abre con el producto en tu mano o en tus pies, nada de logos ni intro: lo primero que se ve es el zapato.",
    ...rasgos.map((r) => r.mostrar),
  ];
  if (p.colores.length > 1) comoMostrarlo.push(`Enseña los ${p.colores.length} colores juntos y di cuál es tu favorito.`);

  const ideas = [...IDEAS[familia]];
  if (p.colores.length >= 3) ideas.push(`¿Cuál color eres? Pon los ${p.colores.length} colores y pide que comenten el suyo.`);
  ideas.push("Unboxing rápido: abre la caja, póntelos y di tu primera impresión en 15 segundos.");
  const deTemporada = temporada(hoy.getMonth(), familia);
  if (deTemporada) ideas.unshift(deTemporada);

  const ganchos = [...GANCHOS[familia]];
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
