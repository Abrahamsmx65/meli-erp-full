/**
 * Lectura del BL (conocimiento de embarque) que la fábrica deja en la misma
 * carpeta de Drive que el packing list. Es el NÚMERO DE CONTROL del
 * contenedor: el BL dice cuántas cajas viajan y el packing list cargado
 * tiene que dar lo mismo (idea del dueño, 11-oct-2026, al ver que al S260
 * le faltaban 212 de sus 611 cajas: «sería inteligente siempre confirmar
 * contra el BL; ahí dice cantidad de cajas»).
 *
 * Motor puro sobre el TEXTO del PDF. Todos los BL vistos (HBL de YQN, copia
 * del master de HMM, telex, draft de Hapag) traen las dos formas:
 *  · una línea por contenedor «HMMU4106958/26H0249165/611/CARTON/…» o
 *    «UETU5682034/WHA2362237/606CTNS/…» (contenedor / sello / cajas);
 *  · el total en palabras «TOTAL SIX HUNDRED ELEVEN(611) CARTON ONLY».
 * La línea del contenedor manda (un BL puede traer varios); el total sirve
 * cuando el BL no trae la línea.
 */

export interface LecturaBl {
  /** cajas del total en palabras (null si no lo trae) */
  total: number | null;
  /** cajas por contenedor (ISO 6346 → cajas) */
  porContenedor: Record<string, number>;
}

const ISO = /\b([A-Z]{4}\d{7})\b/;

export function leerBl(texto: string): LecturaBl {
  const t = String(texto ?? "").toUpperCase().replace(/\s+/g, " ");
  const porContenedor: Record<string, number> = {};
  // CONTENEDOR / SELLO / 611 / CARTON …   o   CONTENEDOR / SELLO / 606CTNS / …
  for (const m of t.matchAll(/\b([A-Z]{4}\d{7})\s*\/\s*[A-Z0-9-]+\s*\/\s*(\d{1,5})\s*(?:\/\s*)?(?:CARTONS?|CTNS?|PKGS?|PACKAGES)?\s*\//g)) {
    const cajas = Number(m[2]);
    if (cajas > 0 && !(m[1] in porContenedor)) porContenedor[m[1]] = cajas;
  }
  const tot = t.match(/TOTAL[A-Z ,-]*\(\s*(\d{1,5})\s*\)\s*(?:CARTONS?|CTNS?|PKGS?|PACKAGES)\b/);
  return { total: tot ? Number(tot[1]) : null, porContenedor };
}

/**
 * Cuántas cajas dice el BL para ESTE contenedor: su línea si la trae; si no,
 * el total, pero solo cuando el BL no nombra OTRO contenedor (un BL de dos
 * contenedores no se le puede cargar completo a uno).
 */
export function cajasDelBl(l: LecturaBl, contenedor: string | null | undefined): number | null {
  const iso = String(contenedor ?? "").toUpperCase().match(ISO)?.[1] ?? null;
  if (iso && l.porContenedor[iso]) return l.porContenedor[iso];
  const otros = Object.keys(l.porContenedor).filter((k) => k !== iso);
  if (otros.length) return null;
  return l.total;
}

export interface CotejoBl {
  estado: "cuadra" | "faltan" | "sobran" | "sin_bl";
  /** cajas cargadas − cajas del BL (negativo = faltan) */
  diferencia: number;
}

/** Cajas cargadas en el contenedor contra el BL. */
export function cotejarConBl(cargadas: number, cajasBl: number | null | undefined): CotejoBl {
  if (cajasBl == null || !(cajasBl > 0)) return { estado: "sin_bl", diferencia: 0 };
  const diferencia = Math.round(cargadas) - Math.round(cajasBl);
  return { estado: diferencia === 0 ? "cuadra" : diferencia < 0 ? "faltan" : "sobran", diferencia };
}
