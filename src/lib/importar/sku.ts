/**
 * Construcción y normalización de SKUs.
 *
 * El SKU de Mercado Libre es MODELO-COLOR-TALLA (ej. GT107-CAMEL-25).
 * En bodega el mismo par se identifica por PEDIDO-MODELO-COLOR, porque ahí
 * sí importa de qué lote salió. El puente entre los dos mundos vive aquí.
 *
 * En la práctica nunca amarra al 100%: hay colores escritos distinto
 * ("DK BROWN" vs "DKBROWN"), modelos con sufijos, y publicaciones viejas con
 * SKU capturado a mano. Por eso todo pasa por una forma canónica y, para lo
 * que aun así no cuadre, existe un mapeo manual.
 */

/**
 * Forma canónica para comparar: mayúsculas, sin acentos, y todo lo que no
 * sea letra o número colapsado a un guion. Así "DK BROWN", "dk-brown" y
 * "Dk  Brown" terminan siendo la misma cosa.
 */
export function canonizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Talla como texto estable: 25, 25.5, "CORRIDA". */
export function normalizarTalla(t: unknown): string {
  if (t == null) return "";
  const s = String(t).trim();
  if (!s) return "";
  if (/^corrida$/i.test(s)) return "CORRIDA";
  const n = Number(s);
  if (Number.isFinite(n)) {
    return Number.isInteger(n) ? String(n) : String(n);
  }
  return canonizar(s);
}

export function esCorrida(talla: unknown): boolean {
  return normalizarTalla(talla) === "CORRIDA";
}

/** SKU tal como se espera en Mercado Libre: MODELO-COLOR-TALLA. */
export function construirSkuMeli(modelo: string, color: string, talla: string | number): string {
  return [canonizar(String(modelo)), canonizar(String(color)), normalizarTalla(talla)]
    .filter(Boolean)
    .join("-");
}

/**
 * Sufijos de país/sitio que muchas cuentas le pegan al final del SKU
 * (GT110-NAVY-26-MX). En bodega no existen, así que hay que ignorarlos al
 * comparar o no empata absolutamente nada. En Amazon el mismo sufijo quedó
 * capturado a mano de varias formas (GT190-BLK-23-ME, GT144-BLK-26-MEX):
 * son el mismo par y sin esto su FNSKU no se encontraba.
 */
const SUFIJOS_SITIO = new Set([
  "MX", "MLM", "AR", "MLA", "BR", "MLB", "CL", "MLC",
  "CO", "MCO", "PE", "MPE", "UY", "MLU", "US", "MX1",
  "ME", "MEX",
]);

/**
 * Equivalencias de color CONFIRMADAS, caso por caso: la fábrica escribe
 * "BLACK" en la proforma y los SKUs del negocio usan "BLK". Solo entran
 * pares verificados — nada de adivinar abreviaturas para otros colores
 * (BROWN, BEIGE, etc. se escriben igual en los dos lados).
 *
 * DARK → DK y LIGHT → LT: verificado en la base (sep 2026): MELI no tiene
 * ni un SKU con "DARK" ni con "LIGHT" (174 con "DK", 55 con "LT"), la
 * proforma del GT156 dice "DARK BROWN" donde MELI y Amazon dicen "DK
 * BROWN", y Amazon tiene 7 publicaciones con "LIGHT" contra el "LT" de
 * MELI. Sin esto, GT156 DK BROWN salía como sin publicar.
 */
const SINONIMOS_COLOR: Record<string, string> = {
  BLACK: "BLK",
  DARK: "DK",
  LIGHT: "LT",
};

/**
 * Clave con la que se comparan dos SKUs: forma canónica y sin el sufijo de
 * sitio. Es lo que hace que "GT110-MILITARY GREEN-26-MX" de la publicación y
 * "GT110-MILITARY GREEN-26" armado desde la corrida se reconozcan como el
 * mismo par de zapatos.
 */
export function claveComparacion(s: string): string {
  const partes = canonizar(s)
    .split("-")
    .map((p) => SINONIMOS_COLOR[p] ?? p);
  while (partes.length > 2 && SUFIJOS_SITIO.has(partes[partes.length - 1])) {
    partes.pop();
  }
  return partes.join("-");
}

/**
 * Resuelve el SKU final contra el catálogo real de Mercado Libre.
 *
 * Devuelve además CÓMO se resolvió, porque no es lo mismo un amarre exacto
 * que uno por forma canónica: el segundo hay que poder auditarlo.
 */
export type OrigenAmarre =
  | "manual"
  | "exacto"
  | "canonico"
  | "aplastado"
  | "sin_amarre";

export interface ResultadoAmarre {
  skuConstruido: string;
  skuMeli: string | null;
  origen: OrigenAmarre;
}

/**
 * Última red: la clave sin NINGÚN separador.
 *
 * En bodega el color se escribe "M BROWN" y en la publicación quedó
 * "MBROWN", pegado. Canonizar no los empata porque uno tiene guion y el
 * otro no. Aplastando todo sí. El modelo y la talla siguen teniendo que
 * coincidir, así que el riesgo de un falso positivo es mínimo.
 */
export function claveAplastada(s: string): string {
  return claveComparacion(s).replace(/-/g, "");
}

export interface IndiceSkus {
  /** SKUs de MELI tal cual vienen */
  exactos: Set<string>;
  /** forma canónica -> SKU real de MELI */
  canonicos: Map<string, string>;
  /** forma sin separadores -> SKU real de MELI */
  aplastados: Map<string, string>;
}

export function construirIndice(skusMeli: string[]): IndiceSkus {
  const exactos = new Set<string>();
  const canonicos = new Map<string, string>();
  const aplastados = new Map<string, string>();
  for (const s of skusMeli) {
    const limpio = s.trim();
    if (!limpio) continue;
    exactos.add(limpio);
    // El primero gana: evita que un duplicado raro pise un amarre bueno.
    const c = claveComparacion(limpio);
    if (!canonicos.has(c)) canonicos.set(c, limpio);
    const a = claveAplastada(limpio);
    if (!aplastados.has(a)) aplastados.set(a, limpio);
  }
  return { exactos, canonicos, aplastados };
}

export function amarrarSku(
  modelo: string,
  color: string,
  talla: string | number,
  indice: IndiceSkus,
  mapeoManual?: Map<string, string>,
): ResultadoAmarre {
  const construido = construirSkuMeli(modelo, color, talla);

  const manual =
    mapeoManual?.get(construido) ?? mapeoManual?.get(claveComparacion(construido));
  if (manual) return { skuConstruido: construido, skuMeli: manual, origen: "manual" };

  if (indice.exactos.has(construido)) {
    return { skuConstruido: construido, skuMeli: construido, origen: "exacto" };
  }

  // Ignora mayúsculas, separadores y el sufijo de sitio (-MX).
  const porCanonico = indice.canonicos.get(claveComparacion(construido));
  if (porCanonico) {
    return { skuConstruido: construido, skuMeli: porCanonico, origen: "canonico" };
  }

  // "M BROWN" en bodega contra "MBROWN" en la publicación.
  const porAplastado = indice.aplastados?.get(claveAplastada(construido));
  if (porAplastado) {
    return { skuConstruido: construido, skuMeli: porAplastado, origen: "aplastado" };
  }

  return { skuConstruido: construido, skuMeli: null, origen: "sin_amarre" };
}
