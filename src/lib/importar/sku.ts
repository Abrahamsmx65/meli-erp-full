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
 * Resuelve el SKU final contra el catálogo real de Mercado Libre.
 *
 * Devuelve además CÓMO se resolvió, porque no es lo mismo un amarre exacto
 * que uno por forma canónica: el segundo hay que poder auditarlo.
 */
export type OrigenAmarre = "manual" | "exacto" | "canonico" | "sin_amarre";

export interface ResultadoAmarre {
  skuConstruido: string;
  skuMeli: string | null;
  origen: OrigenAmarre;
}

export interface IndiceSkus {
  /** SKUs de MELI tal cual vienen */
  exactos: Set<string>;
  /** forma canónica -> SKU real de MELI */
  canonicos: Map<string, string>;
}

export function construirIndice(skusMeli: string[]): IndiceSkus {
  const exactos = new Set<string>();
  const canonicos = new Map<string, string>();
  for (const s of skusMeli) {
    const limpio = s.trim();
    if (!limpio) continue;
    exactos.add(limpio);
    const c = canonizar(limpio);
    // El primero gana: evita que un duplicado raro pise un amarre bueno.
    if (!canonicos.has(c)) canonicos.set(c, limpio);
  }
  return { exactos, canonicos };
}

export function amarrarSku(
  modelo: string,
  color: string,
  talla: string | number,
  indice: IndiceSkus,
  mapeoManual?: Map<string, string>,
): ResultadoAmarre {
  const construido = construirSkuMeli(modelo, color, talla);

  const manual = mapeoManual?.get(construido) ?? mapeoManual?.get(canonizar(construido));
  if (manual) return { skuConstruido: construido, skuMeli: manual, origen: "manual" };

  if (indice.exactos.has(construido)) {
    return { skuConstruido: construido, skuMeli: construido, origen: "exacto" };
  }

  const porCanonico = indice.canonicos.get(canonizar(construido));
  if (porCanonico) {
    return { skuConstruido: construido, skuMeli: porCanonico, origen: "canonico" };
  }

  return { skuConstruido: construido, skuMeli: null, origen: "sin_amarre" };
}
