/**
 * Motor de modelos nuevos: resumen de la revisión, llegada por contenedor y
 * lista de faltantes. Puro, sin base de datos; la pantalla lo usa para
 * recalcular al palomear. La explicación está en servicios/modelos-nuevos.ts.
 */
/** Portada + al menos una secundaria: menos que esto es "sin fotos". */
export const FOTOS_MINIMAS = 2;

// ---------------------------------------------------------------------------
// Lo que guarda la revisión automática
// ---------------------------------------------------------------------------
export interface PublicacionMeliRevisada {
  itemId: string;
  color: string | null;
  titulo: string | null;
  /** active | paused | closed… */
  estado: string | null;
  fotos: number;
  /** El video (YouTube) viejo de la publicación; el clip NO se ve por API. */
  video: boolean;
  permalink: string | null;
}

export interface ColorAmazonRevisado {
  modelo: string;
  color: string;
  asin: string | null;
  estado: string | null;
  /** Nulo = Amazon no contestó por este ASIN. */
  fotos: number | null;
  /** Nulo = no se pudo preguntar (sin permiso o sin plazo). */
  aplus: boolean | null;
  url: string | null;
}

export interface RevisionModelo {
  /** Cuándo se hizo (ISO). */
  en: string;
  meli: { publicaciones: PublicacionMeliRevisada[]; error: string | null } | null;
  amazon: {
    colores: ColorAmazonRevisado[];
    error: string | null;
    /** Por qué no se supo del A+ (sin permiso, sin plazo). */
    aplusAviso: string | null;
  } | null;
}

export interface ResumenMeli {
  publicaciones: number;
  activas: number;
  fotosMin: number | null;
  fotosMax: number | null;
  /** Publicaciones con menos de FOTOS_MINIMAS fotos. */
  sinFotos: number;
  conVideo: number;
}

export interface ResumenAmazon {
  colores: number;
  activos: number;
  fotosMin: number | null;
  fotosMax: number | null;
  sinFotos: number;
  conAplus: number;
  sinAplus: number;
  /** Colores de los que no se supo si tienen A+. */
  aplusDesconocido: number;
}

function minMax(valores: number[]): { min: number | null; max: number | null } {
  if (!valores.length) return { min: null, max: null };
  return { min: Math.min(...valores), max: Math.max(...valores) };
}

/** Los números que la pantalla enseña, sacados de la revisión guardada. */
export function resumirRevision(rev: RevisionModelo | null): {
  meli: ResumenMeli | null;
  amazon: ResumenAmazon | null;
} {
  let meli: ResumenMeli | null = null;
  if (rev?.meli) {
    const pubs = rev.meli.publicaciones;
    const fotos = pubs.map((p) => p.fotos);
    const { min, max } = minMax(fotos);
    meli = {
      publicaciones: pubs.length,
      activas: pubs.filter((p) => p.estado === "active").length,
      fotosMin: min,
      fotosMax: max,
      sinFotos: pubs.filter((p) => p.fotos < FOTOS_MINIMAS).length,
      conVideo: pubs.filter((p) => p.video).length,
    };
  }
  let amazon: ResumenAmazon | null = null;
  if (rev?.amazon) {
    const cols = rev.amazon.colores;
    const fotos = cols.map((c) => c.fotos).filter((f): f is number => f != null);
    const { min, max } = minMax(fotos);
    amazon = {
      colores: cols.length,
      activos: cols.filter((c) => c.estado === "Active").length,
      fotosMin: min,
      fotosMax: max,
      sinFotos: cols.filter((c) => c.fotos != null && c.fotos < FOTOS_MINIMAS).length,
      conAplus: cols.filter((c) => c.aplus === true).length,
      sinAplus: cols.filter((c) => c.aplus === false).length,
      aplusDesconocido: cols.filter((c) => c.aplus == null).length,
    };
  }
  return { meli, amazon };
}

// ---------------------------------------------------------------------------
// Llegada: pedido → contenedor → ETA
// ---------------------------------------------------------------------------
export interface LlegadaModelo {
  estado: "en_camino" | "llego" | "sin_contenedor";
  /** ETA (o llegada real) en ISO yyyy-mm-dd; nula si no se sabe. */
  fecha: string | null;
  /** "Contenedor 12 · ETA", "Llegó en el 11", "Pedido PI-3 sin contenedor". */
  texto: string;
  pedidos: string[];
}

export interface PedidoCrudo {
  id: string;
  pedido: string;
  estado: string | null;
}
export interface LineaCruda {
  id: string;
  pedido_id: string;
  modelo: string;
}
export interface ContenedorCrudo {
  id: string;
  numero: string;
  estado: string | null;
  fecha_llegada_est: string | null;
  fecha_llegada_real: string | null;
  /** Los renglones de pedido que trae. */
  lineas: string[];
}

/**
 * De qué pedido y contenedor viene cada modelo, y cuándo llega. Si un modelo
 * viaja en varios contenedores manda el que llega PRIMERO; si todos ya
 * llegaron, se dice cuándo llegó el último.
 */
export function estimarLlegadas(
  pedidos: PedidoCrudo[],
  lineas: LineaCruda[],
  contenedores: ContenedorCrudo[],
): Map<string, LlegadaModelo> {
  const pedidoDe = new Map(pedidos.filter((p) => p.estado !== "cancelado").map((p) => [p.id, p]));
  const contDeLinea = new Map<string, ContenedorCrudo[]>();
  for (const c of contenedores) {
    for (const l of c.lineas) contDeLinea.set(l, [...(contDeLinea.get(l) ?? []), c]);
  }

  interface Acumulado {
    pedidos: Set<string>;
    pendientes: ContenedorCrudo[];
    recibidos: ContenedorCrudo[];
  }
  const porModelo = new Map<string, Acumulado>();
  for (const l of lineas) {
    const pedido = pedidoDe.get(l.pedido_id);
    if (!pedido) continue;
    const modelo = (l.modelo ?? "").trim().toUpperCase();
    if (!modelo) continue;
    const a =
      porModelo.get(modelo) ??
      ({ pedidos: new Set<string>(), pendientes: [], recibidos: [] } as Acumulado);
    a.pedidos.add(pedido.pedido);
    for (const c of contDeLinea.get(l.id) ?? []) {
      const lista = c.estado === "recibido" ? a.recibidos : a.pendientes;
      if (!lista.some((x) => x.id === c.id)) lista.push(c);
    }
    porModelo.set(modelo, a);
  }

  const salida = new Map<string, LlegadaModelo>();
  for (const [modelo, a] of porModelo) {
    const pedidosLista = [...a.pedidos].sort();
    if (a.pendientes.length) {
      const conEta = a.pendientes
        .filter((c) => c.fecha_llegada_est)
        .sort((x, y) => x.fecha_llegada_est!.localeCompare(y.fecha_llegada_est!));
      const primero = conEta[0] ?? a.pendientes[0];
      salida.set(modelo, {
        estado: "en_camino",
        fecha: primero.fecha_llegada_est ?? null,
        texto: primero.fecha_llegada_est
          ? `Contenedor ${primero.numero} · ETA`
          : `Contenedor ${primero.numero} sin ETA`,
        pedidos: pedidosLista,
      });
    } else if (a.recibidos.length) {
      const ultimo = [...a.recibidos].sort((x, y) =>
        (y.fecha_llegada_real ?? "").localeCompare(x.fecha_llegada_real ?? ""),
      )[0];
      salida.set(modelo, {
        estado: "llego",
        fecha: ultimo.fecha_llegada_real ?? null,
        texto: `Llegó en el contenedor ${ultimo.numero}`,
        pedidos: pedidosLista,
      });
    } else {
      salida.set(modelo, {
        estado: "sin_contenedor",
        fecha: null,
        texto: `Pedido ${pedidosLista.join(", ")} sin contenedor`,
        pedidos: pedidosLista,
      });
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// El renglón de la pantalla
// ---------------------------------------------------------------------------
export interface ModeloNuevo {
  modelo: string;
  titulo: string | null;
  categoria: string | null;
  precioNormal: number | null;
  precioRelampago: number | null;
  costoTotal: number | null;
  /** Capturada a mano. */
  llegadaEstimada: string | null;
  /** Deducida del contenedor. */
  llegadaAuto: LlegadaModelo | null;
  /** Tiene publicaciones en MELI (según el catálogo sincronizado). */
  publicadoMeli: boolean;
  /** Tiene publicaciones en Amazon (según amazon_listings). */
  publicadoAmazon: boolean;
  imagenesRecibidas: boolean;
  imagenesEnviadas: boolean;
  meliClip: boolean;
  amazonVideo: boolean;
  aplusCargado: boolean;
  notas: string;
  listo: boolean;
  revision: RevisionModelo | null;
  revisadoEn: string | null;
  resumen: { meli: ResumenMeli | null; amazon: ResumenAmazon | null };
  faltantes: string[];
}

/** Lo que todavía le falta a un modelo. Vacío = está completo. */
export function calcularFaltantes(
  m: Omit<ModeloNuevo, "faltantes">,
  opciones: { hayAmazon: boolean },
): string[] {
  const f: string[] = [];
  if (!m.categoria) f.push("Categoría");
  if (m.costoTotal == null) f.push("Costo");
  if (!m.precioNormal && !m.precioRelampago) f.push("Precio de venta");
  if (!m.llegadaEstimada && !m.llegadaAuto?.fecha && m.llegadaAuto?.estado !== "llego") {
    f.push("Fecha de llegada");
  }
  if (!m.imagenesRecibidas) f.push("Imágenes de China");
  else if (!m.imagenesEnviadas) f.push("Mandar a cargar imágenes");

  if (!m.publicadoMeli) f.push("Publicar en MELI");
  else if (!m.resumen.meli) f.push("MELI: sin revisar");
  else {
    const r = m.resumen.meli;
    if (r.sinFotos > 0) {
      f.push(
        r.sinFotos === r.publicaciones
          ? "MELI: fotos"
          : `MELI: fotos en ${r.sinFotos} de ${r.publicaciones}`,
      );
    }
  }
  if (m.publicadoMeli && !m.meliClip) f.push("MELI: clip");

  if (opciones.hayAmazon) {
    if (!m.publicadoAmazon) f.push("Publicar en Amazon");
    else if (!m.resumen.amazon) f.push("Amazon: sin revisar");
    else {
      const r = m.resumen.amazon;
      if (r.sinFotos > 0) {
        f.push(r.sinFotos === r.colores ? "Amazon: fotos" : `Amazon: fotos en ${r.sinFotos} de ${r.colores}`);
      }
      if (!m.aplusCargado) {
        if (r.sinAplus > 0) f.push(r.conAplus > 0 ? `Amazon: A+ en ${r.sinAplus} de ${r.colores}` : "Amazon: A+");
        else if (r.conAplus === 0) f.push("Amazon: A+ (sin confirmar)");
      }
    }
    if (m.publicadoAmazon && !m.amazonVideo) f.push("Amazon: video");
  }
  return f;
}

