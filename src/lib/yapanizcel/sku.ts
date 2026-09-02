/**
 * Normalización y amarre de SKUs de fundas.
 *
 * El problema, tal cual lo describe la operación: el mismo producto se
 * escribe distinto en el sheet de bodega y en la publicación de Mercado
 * Libre. Sobra una N, sobra una C, se cuela un guion, se pega o se despega
 * un espacio, alguien le puso "-MX" al final.
 *
 * La respuesta NO es una expresión regular grandota que lo empate todo: eso
 * junta silenciosamente dos productos distintos y nadie se entera hasta que
 * el envío llega mal. Aquí el amarre va por NIVELES, y cada nivel sabe si es
 * seguro o no:
 *
 *   manual     lo dijo el usuario. Manda sobre todo lo demás.
 *   exacto     idénticos.
 *   canonico   misma cosa salvo mayúsculas, acentos, guiones, espacios y el
 *              sufijo de sitio (-MX). Seguro: no cambia ninguna letra.
 *   aplastado  igual, ignorando también dónde caen los separadores
 *              ("IP15PM" contra "IP-15-PM"). Seguro por lo mismo.
 *   prefijo_nc igual si se ignora una N o una C SUELTA antes del diseño
 *              ("N-462-A06" contra "462-A06", "C-367-PocoC40" contra
 *              "367-PocoC40", "499N-…" contra "499-…"). Se aplica solo por
 *              decisión del dueño: en su catálogo esa N o C es la misma funda.
 *   -- de aquí para abajo son SUGERENCIAS, no amarres --
 *   prefijo    igual si se ignora CUALQUIER prefijo corto ("CH-650-i11",
 *              "R-514-…"). Esos sí pueden ser otra cosa: se proponen.
 *   nucleo     igual si se ignora cualquier letra suelta en cualquier lugar.
 *   ordenado   las mismas piezas en otro orden.
 *
 * Los cuatro primeros se aplican solos. Los demás se proponen en la
 * pantalla de SKUs y se confirman con un clic, que escribe un mapeo manual.
 * Un empate (dos SKUs de MELI para la misma clave) NUNCA se resuelve solo,
 * ni en un nivel automático.
 */

/** Sufijos de sitio que algunas cuentas le pegan al SKU. En bodega no existen. */
const SUFIJOS_SITIO = new Set([
  "MX", "MLM", "AR", "MLA", "BR", "MLB", "CL", "MLC",
  "CO", "MCO", "PE", "MPE", "UY", "MLU", "US",
]);

/**
 * Forma canónica para comparar: mayúsculas, sin acentos, y todo lo que no
 * sea letra o número colapsado a un guion.
 */
export function canonizar(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parte el SKU en piezas atómicas, separando también donde una letra se pega
 * a un número: "499N-IP15PM" -> ["499", "N", "IP", "15", "PM"].
 *
 * Es lo que permite ver la N de más como una pieza propia en vez de como
 * parte del número, que es justo lo que hace falta para proponerla.
 */
export function piezas(s: string): string[] {
  const out: string[] = [];
  for (const parte of canonizar(s).split("-")) {
    if (!parte) continue;
    for (const trozo of parte.match(/\d+|[A-Z]+/g) ?? []) out.push(trozo);
  }
  // El sufijo de sitio se va al final de todo, nunca en medio.
  while (out.length > 1 && SUFIJOS_SITIO.has(out[out.length - 1])) out.pop();
  return out;
}

/** Clave canónica: misma cosa salvo mayúsculas, acentos, separadores y -MX. */
export function claveCanonica(s: string): string {
  const partes = canonizar(s).split("-").filter(Boolean);
  while (partes.length > 1 && SUFIJOS_SITIO.has(partes[partes.length - 1])) partes.pop();
  return partes.join("-");
}

/** Clave aplastada: da igual dónde caigan los guiones y los espacios. */
export function claveAplastada(s: string): string {
  return piezas(s).join("");
}

/**
 * Clave de núcleo: la aplastada, ignorando las letras SUELTAS.
 *
 * "499N-IP15PM", "499C IP15PM" y "499-IP-15-PM" dan todas "499IP15PM".
 * Sirve para PROPONER, nunca para amarrar solo: si esa N distingue dos
 * productos de verdad, este nivel los confundiría.
 */
export function claveNucleo(s: string): string {
  return piezas(s)
    .filter((p) => !(p.length === 1 && /[A-Z]/.test(p)))
    .join("");
}

/**
 * Quita el prefijo suelto que va antes del número de diseño, si lo hay.
 *
 * En el sheet y en MELI el mismo diseño aparece como "N-462-A06" y
 * "462-A06", o "C-367-PocoC40" y "367-PocoC40"; a veces la letra va pegada
 * ("499N-…"). `letras` limita qué prefijos se quitan: con ["N", "C"] solo
 * esos (nivel automático); sin límite, cualquier prefijo de hasta dos
 * letras (nivel de sugerencia).
 */
export function piezasSinPrefijo(s: string, letras?: readonly string[]): string[] {
  // Se trabaja con las partes separadas por guion, no con las piezas: en
  // "650-i11" la i va DESPUÉS del guion y es parte del modelo; en "499N-…"
  // la N va pegada al número ANTES del guion. Las piezas no distinguen eso.
  const partes = claveCanonica(s).split("-").filter(Boolean);
  const admitido = (l: string) => (letras ? letras.includes(l) : /^[A-Z]{1,2}$/.test(l));
  if (partes.length >= 2) {
    if (/^[A-Z]{1,2}$/.test(partes[0]) && /^\d/.test(partes[1]) && admitido(partes[0])) {
      partes.shift();
    } else {
      const m = partes[0].match(/^(\d+)([A-Z])$/);
      if (m && admitido(m[2])) partes[0] = m[1];
    }
  }
  return piezas(partes.join("-"));
}

export const PREFIJOS_AUTOMATICOS: readonly string[] = ["N", "C"];

/** Clave sin la N o la C suelta antes del diseño. Nivel automático. */
export function clavePrefijoNC(s: string): string {
  return piezasSinPrefijo(s, PREFIJOS_AUTOMATICOS).join("");
}

/** Clave sin cualquier prefijo corto antes del diseño. Solo se propone. */
export function clavePrefijo(s: string): string {
  return piezasSinPrefijo(s).join("");
}

/** Clave con las piezas ordenadas: atrapa el mismo SKU escrito al revés. */
export function claveOrdenada(s: string): string {
  return [...piezas(s)].sort().join("-");
}

// ---------------------------------------------------------------------------
// Índice y amarre
// ---------------------------------------------------------------------------

export type NivelAmarre =
  | "manual"
  | "exacto"
  | "canonico"
  | "aplastado"
  | "prefijo_nc"
  | "prefijo"
  | "nucleo"
  | "ordenado"
  | "sin_amarre";

/** Los niveles que se aplican SOLOS. El resto solo se propone. */
export const NIVELES_AUTOMATICOS: ReadonlySet<NivelAmarre> = new Set<NivelAmarre>([
  "manual",
  "exacto",
  "canonico",
  "aplastado",
  "prefijo_nc",
]);

export function esAutomatico(nivel: NivelAmarre): boolean {
  return NIVELES_AUTOMATICOS.has(nivel);
}

export interface Amarre {
  /** El SKU de bodega tal como venía. */
  skuBodega: string;
  /** El SKU real de Mercado Libre, o null si no se resolvió. */
  skuMeli: string | null;
  nivel: NivelAmarre;
  /**
   * Los candidatos, cuando el nivel es una sugerencia o cuando hay más de
   * uno. Un empate NUNCA se resuelve solo: se muestra para que lo decidan.
   */
  candidatos: string[];
  /** true si la clave apuntó a varios SKUs de MELI distintos. */
  ambiguo: boolean;
}

export interface IndiceSkus {
  exactos: Set<string>;
  canonicos: Map<string, string[]>;
  aplastados: Map<string, string[]>;
  prefijosNC: Map<string, string[]>;
  prefijos: Map<string, string[]>;
  nucleos: Map<string, string[]>;
  ordenados: Map<string, string[]>;
}

function agregar(m: Map<string, string[]>, clave: string, valor: string): void {
  if (!clave) return;
  const previos = m.get(clave);
  if (!previos) m.set(clave, [valor]);
  else if (!previos.includes(valor)) previos.push(valor);
}

export function construirIndice(skusMeli: Iterable<string>): IndiceSkus {
  const idx: IndiceSkus = {
    exactos: new Set(),
    canonicos: new Map(),
    aplastados: new Map(),
    prefijosNC: new Map(),
    prefijos: new Map(),
    nucleos: new Map(),
    ordenados: new Map(),
  };
  for (const crudo of skusMeli) {
    const sku = String(crudo ?? "").trim();
    if (!sku) continue;
    idx.exactos.add(sku);
    agregar(idx.canonicos, claveCanonica(sku), sku);
    agregar(idx.aplastados, claveAplastada(sku), sku);
    agregar(idx.prefijosNC, clavePrefijoNC(sku), sku);
    agregar(idx.prefijos, clavePrefijo(sku), sku);
    agregar(idx.nucleos, claveNucleo(sku), sku);
    agregar(idx.ordenados, claveOrdenada(sku), sku);
  }
  return idx;
}

/**
 * Amarra un SKU de bodega contra el catálogo de Mercado Libre.
 *
 * Devuelve SIEMPRE con qué nivel se resolvió, porque no es lo mismo un
 * amarre exacto que una propuesta por letra suelta: el segundo hay que
 * poder revisarlo antes de creerle.
 */
export function amarrar(
  skuBodega: string,
  indice: IndiceSkus,
  mapeoManual?: Map<string, string>,
): Amarre {
  const sku = String(skuBodega ?? "").trim();
  const base: Amarre = { skuBodega: sku, skuMeli: null, nivel: "sin_amarre", candidatos: [], ambiguo: false };
  if (!sku) return base;

  const manual = mapeoManual?.get(sku) ?? mapeoManual?.get(claveCanonica(sku));
  if (manual) return { ...base, skuMeli: manual, nivel: "manual", candidatos: [manual] };

  if (indice.exactos.has(sku)) {
    return { ...base, skuMeli: sku, nivel: "exacto", candidatos: [sku] };
  }

  const escalones: [NivelAmarre, Map<string, string[]>, string][] = [
    ["canonico", indice.canonicos, claveCanonica(sku)],
    ["aplastado", indice.aplastados, claveAplastada(sku)],
    ["prefijo_nc", indice.prefijosNC, clavePrefijoNC(sku)],
    ["prefijo", indice.prefijos, clavePrefijo(sku)],
    ["nucleo", indice.nucleos, claveNucleo(sku)],
    ["ordenado", indice.ordenados, claveOrdenada(sku)],
  ];

  for (const [nivel, mapa, clave] of escalones) {
    const encontrados = mapa.get(clave);
    if (!encontrados?.length) continue;

    const ambiguo = encontrados.length > 1;
    // Un empate no se resuelve solo ni aunque el nivel sea seguro: elegir
    // uno de dos al azar es peor que no elegir.
    const automatico = esAutomatico(nivel) && !ambiguo;
    return {
      skuBodega: sku,
      skuMeli: automatico ? encontrados[0] : null,
      nivel,
      candidatos: encontrados,
      ambiguo,
    };
  }

  return base;
}

// ---------------------------------------------------------------------------
// Desglose
// ---------------------------------------------------------------------------

export interface Desglose {
  diseno: string;
  modelo: string;
  color: string;
}

/**
 * Saca diseño / modelo de celular / color de un SKU.
 *
 * Con el sheet real a la vista (362-Rmn13-5G-blue, 367-A24-4G, 437-A11plus-blk,
 * 412-iPad10-blue): el diseño es la primera pieza NUMÉRICA; el color, cuando
 * existe, es la ÚLTIMA pieza y va en puras letras (blue, blk, navy,
 * transparente); todo lo de en medio es el modelo del celular, con sus
 * sufijos (5G, 4G, plus, pro). "4G" o "2024" al final no son colores.
 *
 * El prefijo suelto de una o dos letras antes del número (N-675-A17,
 * C-450-Rmn10pro, CH-650-i16promax) NO es el diseño: el diseño es 675, 450,
 * 650. Igual la N o la C pegadas al número (499N-…). Una letra distinta
 * pegada (333A, 314A) sí se conserva: son diseños propios.
 */
export function desglosar(sku: string): Desglose {
  const partes = claveCanonica(sku).split("-").filter(Boolean);
  if (partes.length >= 2 && /^[A-Z]{1,2}$/.test(partes[0]) && /^\d/.test(partes[1])) {
    partes.shift();
  } else if (partes.length) {
    const m = partes[0].match(/^(\d+)([NC])$/);
    if (m) partes[0] = m[1];
  }
  const diseno = partes[0] ?? "";
  const resto = partes.slice(1);
  let color = "";
  if (resto.length >= 2 && /^[A-Z]+$/.test(resto[resto.length - 1])) color = resto.pop()!;
  return { diseno, modelo: resto.join("-"), color };
}

/**
 * Diseños que NO son fundas: el calzado que también vive en esta cuenta
 * (GT074, G650, MY2304). En la pantalla de pedidos a China estorban, por
 * decisión del dueño. "GLASS" (micas) no es calzado y se queda.
 */
export function esCalzado(diseno: string): boolean {
  return /^(GT?\d|MY\d)/.test(canonizar(diseno));
}
