/**
 * Motor de costos de producto: las fórmulas de la hoja "Numeros", puras y sin
 * base de datos, para que las use el servidor y también la pantalla al
 * recalcular en vivo. La explicación completa está en
 * servicios/costos-producto.ts.
 */

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------
export interface ParametrosCostos {
  /** Tipo de cambio de omisión (MXN por USD) para los modelos sin el suyo. */
  tdc: number;
  /** Pesos por metro cúbico de aduana y flete marítimo. */
  aduanaPorCbm: number;
  /** IVA, como fracción (0.16). */
  iva: number;
  /** Retención sobre el precio SIN IVA, como fracción (0.105). */
  retencion: number;
  /** Comisión de MELI sobre el precio (0.15). */
  meliComision: number;
  /** Comisión por referencia de Amazon (0.15). */
  amazonComision: number;
  /** Cuánto se infla el PVP de Amazon para poder dar el deal (1.12). */
  amazonFactorDeal: number;
  /** Comisión de TikTok Shop (0.05). */
  tiktokComision: number;
  /** Comisión de afiliados de TikTok de omisión (0.08). */
  tiktokAfiliado: number;
  /** Lo que cuesta el envío de TikTok por par, en pesos (6). */
  tiktokEnvio: number;
  /** Cuánto se infla el precio de TikTok para la oferta normal (1.06). */
  tiktokFactorOferta: number;
}

export const PARAMETROS_COSTOS_OMISION: ParametrosCostos = {
  tdc: 17.5,
  aduanaPorCbm: 4920,
  iva: 0.16,
  retencion: 0.105,
  meliComision: 0.15,
  amazonComision: 0.15,
  amazonFactorDeal: 1.12,
  tiktokComision: 0.05,
  tiktokAfiliado: 0.08,
  tiktokEnvio: 6,
  tiktokFactorOferta: 1.06,
};

/** Los parámetros guardados (JSON) completados con las omisiones; lo que no sea número se ignora. */
export function leerParametrosCostos(datos: unknown): ParametrosCostos {
  const salida: ParametrosCostos = { ...PARAMETROS_COSTOS_OMISION };
  if (!datos || typeof datos !== "object") return salida;
  const d = datos as Record<string, unknown>;
  for (const k of Object.keys(PARAMETROS_COSTOS_OMISION) as (keyof ParametrosCostos)[]) {
    const n = Number(d[k]);
    if (d[k] !== undefined && d[k] !== null && d[k] !== "" && Number.isFinite(n) && n >= 0) {
      salida[k] = n;
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Renglones
// ---------------------------------------------------------------------------
export interface CapturaCosto {
  modelo: string;
  costoUsd: number | null;
  /** Nulo = el de omisión de los parámetros. */
  tdc: number | null;
  cbmPar: number | null;
  envioMeli: number | null;
  precioRelampago: number | null;
  precioNormal: number | null;
  envioAmazon: number | null;
  /** Precio real publicado en Amazon, para ver qué se gana con él. */
  precioAmazon: number | null;
  /** Comisión de afiliados de este modelo (fracción); nulo = la de omisión. */
  afiliadoTiktok: number | null;
  /** Precio real publicado en TikTok. */
  precioTiktok: number | null;
  notas: string;
}

export interface FilaCosto extends CapturaCosto {
  categoria: string | null;
  /** Está en el catálogo sincronizado de MELI (tiene SKUs). */
  enCatalogo: boolean;
  /** Está en la lista de modelos nuevos. */
  esNuevo: boolean;
  titulo: string | null;
  actualizadoEn: string | null;
}

export interface Ganancia {
  ganancia: number;
  /** Ganancia ÷ costo total. */
  porcentaje: number;
}

export interface CostoCalculado {
  /** El tipo de cambio que se usó (el del renglón o el de omisión). */
  tdc: number;
  aduana: number | null;
  costoTotal: number | null;
  relampago: Ganancia | null;
  normal: Ganancia | null;
  /** Costo total + ganancia relámpago: lo que hay que recibir en Amazon. */
  recibirAmazon: number | null;
  pvpAmazon: number | null;
  pvpAmazonDeal: number | null;
  /** Ganancia con el precio REAL de Amazon, si se capturó. */
  amazonReal: Ganancia | null;
  /** La comisión de afiliados que se usó. */
  afiliadoTiktok: number;
  precioTiktok: number | null;
  precioTiktokOferta: number | null;
  /** Ganancia con el precio REAL de TikTok, si se capturó. */
  tiktokReal: Ganancia | null;
}

function positivo(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** La retención expresada como fracción del precio CON IVA: 0.105 ÷ 1.16. */
export function retencionSobrePrecio(p: ParametrosCostos): number {
  return p.retencion / (1 + p.iva);
}

function ganancia(neto: number, costoTotal: number): Ganancia {
  const g = neto - costoTotal;
  return { ganancia: g, porcentaje: costoTotal > 0 ? g / costoTotal : 0 };
}

/** Ganancia en MELI: precio − comisión − envío − retención − costo. */
export function gananciaMeli(
  precio: number,
  envio: number,
  costoTotal: number,
  p: ParametrosCostos,
): Ganancia {
  const neto = precio - precio * p.meliComision - envio - precio * retencionSobrePrecio(p);
  return ganancia(neto, costoTotal);
}

/** Ganancia en Amazon con un precio dado: comisión por referencia, tarifa FBA y retención. */
export function gananciaAmazon(
  precio: number,
  envioAmazon: number,
  costoTotal: number,
  p: ParametrosCostos,
): Ganancia {
  const neto =
    precio - precio * p.amazonComision - envioAmazon - precio * retencionSobrePrecio(p);
  return ganancia(neto, costoTotal);
}

/** Ganancia en TikTok con un precio dado: comisión, afiliado, envío fijo y retención. */
export function gananciaTiktok(
  precio: number,
  afiliado: number,
  costoTotal: number,
  p: ParametrosCostos,
): Ganancia {
  const neto =
    precio -
    precio * (p.tiktokComision + afiliado) -
    p.tiktokEnvio -
    precio * retencionSobrePrecio(p);
  return ganancia(neto, costoTotal);
}

/** El precio de Amazon con el que se recibe `recibir` después de comisión, FBA y retención. */
export function precioAmazonPara(recibir: number, envioAmazon: number, p: ParametrosCostos): number {
  const divisor = 1 - p.amazonComision - retencionSobrePrecio(p);
  return divisor > 0 ? (recibir + envioAmazon) / divisor : 0;
}

/** El precio de TikTok con el que se recibe `recibir` después de comisión, afiliado, envío y retención. */
export function precioTiktokPara(recibir: number, afiliado: number, p: ParametrosCostos): number {
  const divisor = 1 - p.tiktokComision - afiliado - retencionSobrePrecio(p);
  return divisor > 0 ? (recibir + p.tiktokEnvio) / divisor : 0;
}

/** Todo lo calculable de un renglón. Lo que no se puede calcular sale nulo, nunca cero. */
export function calcularCosto(fila: CapturaCosto, p: ParametrosCostos): CostoCalculado {
  const tdc = positivo(fila.tdc) ? fila.tdc : p.tdc;
  const afiliado = fila.afiliadoTiktok != null && fila.afiliadoTiktok >= 0 ? fila.afiliadoTiktok : p.tiktokAfiliado;

  const aduana = positivo(fila.cbmPar) ? p.aduanaPorCbm * fila.cbmPar : null;
  const costoTotal = positivo(fila.costoUsd) ? fila.costoUsd * tdc + (aduana ?? 0) : null;

  const vacio: CostoCalculado = {
    tdc,
    aduana,
    costoTotal,
    relampago: null,
    normal: null,
    recibirAmazon: null,
    pvpAmazon: null,
    pvpAmazonDeal: null,
    amazonReal: null,
    afiliadoTiktok: afiliado,
    precioTiktok: null,
    precioTiktokOferta: null,
    tiktokReal: null,
  };
  if (costoTotal == null) return vacio;

  const envioMeli = fila.envioMeli ?? 0;
  const relampago = positivo(fila.precioRelampago)
    ? gananciaMeli(fila.precioRelampago, envioMeli, costoTotal, p)
    : null;
  const normal = positivo(fila.precioNormal)
    ? gananciaMeli(fila.precioNormal, envioMeli, costoTotal, p)
    : null;

  // Sin precio relámpago no hay "ganancia objetivo" y Amazon y TikTok no se
  // pueden sugerir: la hoja parte de ahí.
  const recibirAmazon = relampago ? costoTotal + relampago.ganancia : null;
  const envioAmazon = fila.envioAmazon ?? 0;
  const pvpAmazon = recibirAmazon != null ? precioAmazonPara(recibirAmazon, envioAmazon, p) : null;
  const precioTiktok = recibirAmazon != null ? precioTiktokPara(recibirAmazon, afiliado, p) : null;

  return {
    ...vacio,
    relampago,
    normal,
    recibirAmazon,
    pvpAmazon,
    pvpAmazonDeal: pvpAmazon != null ? pvpAmazon * p.amazonFactorDeal : null,
    amazonReal: positivo(fila.precioAmazon)
      ? gananciaAmazon(fila.precioAmazon, envioAmazon, costoTotal, p)
      : null,
    precioTiktok,
    precioTiktokOferta: precioTiktok != null ? precioTiktok * p.tiktokFactorOferta : null,
    tiktokReal: positivo(fila.precioTiktok)
      ? gananciaTiktok(fila.precioTiktok, afiliado, costoTotal, p)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Excel: la hoja "Numeros" tal cual (CATEGORIA | MODELO | USD | TDC | CBM X
// PAR | … | ENVIO | PRECIO RELAMPAGO | … | PV NORMAL | … | ENVIO AMAZON)
// ---------------------------------------------------------------------------
export interface FilaImportada {
  modelo: string;
  categoria: string | null;
  costoUsd: number | null;
  tdc: number | null;
  cbmPar: number | null;
  envioMeli: number | null;
  precioRelampago: number | null;
  precioNormal: number | null;
  envioAmazon: number | null;
}

/** Encabezado comparable: mayúsculas, sin acentos, espacios colapsados. */
function encabezado(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function numeroDeCelda(v: unknown): number | null {
  if (v == null) return null;
  const t = String(v).replace(/[$,\s]/g, "").replace(/%$/, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lee los renglones de la hoja de costos. Reconoce las columnas por su
 * encabezado (el orden no importa; sobran las calculadas). Un modelo sin USD
 * también entra: los modelos nuevos de la hoja llegan solo con categoría.
 */
export function filasDesdeHoja(filas: string[][]): { filas: FilaImportada[]; error?: string } {
  let enc = -1;
  let cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(15, filas.length); i++) {
    const f = filas[i].map(encabezado);
    const iModelo = f.findIndex((c) => c === "MODELO" || c === "MODEL");
    if (iModelo < 0) continue;
    const buscar = (pred: (c: string) => boolean) => f.findIndex(pred);
    cols = {
      modelo: iModelo,
      categoria: buscar((c) => c.startsWith("CATEGORIA") || c.startsWith("CATEGORY")),
      usd: buscar((c) => c === "USD" || c.startsWith("COSTO USD") || c === "PRECIO USD"),
      tdc: buscar((c) => c === "TDC" || c.startsWith("TIPO DE CAMBIO")),
      cbm: buscar((c) => c.startsWith("CBM")),
      // "ENVIO" a secas es el de MELI; "ENVIO AMAZON" es otro.
      envioMeli: buscar((c) => c === "ENVIO" || c === "ENVIO MELI"),
      relampago: buscar((c) => c.includes("RELAMPAGO")),
      normal: buscar((c) => c === "PV NORMAL" || c === "PRECIO NORMAL" || c === "PV"),
      envioAmazon: buscar((c) => c === "ENVIO AMAZON"),
    };
    if (cols.usd < 0 && cols.relampago < 0) continue;
    enc = i;
    break;
  }
  if (enc < 0) {
    return {
      filas: [],
      error: 'No encontré los encabezados. Se esperan "MODELO" y "USD" (como en la hoja Numeros).',
    };
  }

  const celda = (f: string[], k: string) => (cols[k] >= 0 ? (f[cols[k]] ?? "") : "");
  const salida: FilaImportada[] = [];
  const vistos = new Set<string>();
  for (let i = enc + 1; i < filas.length; i++) {
    const f = filas[i] ?? [];
    const modelo = String(celda(f, "modelo") ?? "").trim().toUpperCase();
    if (!modelo || vistos.has(modelo)) continue;
    vistos.add(modelo);
    const categoria = String(celda(f, "categoria") ?? "").trim().toUpperCase() || null;
    const tdc = numeroDeCelda(celda(f, "tdc"));
    salida.push({
      modelo,
      categoria,
      costoUsd: numeroDeCelda(celda(f, "usd")),
      tdc: tdc != null && tdc > 0 ? tdc : null,
      cbmPar: numeroDeCelda(celda(f, "cbm")),
      envioMeli: numeroDeCelda(celda(f, "envioMeli")),
      precioRelampago: numeroDeCelda(celda(f, "relampago")),
      precioNormal: numeroDeCelda(celda(f, "normal")),
      envioAmazon: numeroDeCelda(celda(f, "envioAmazon")),
    });
  }
  return { filas: salida };
}

