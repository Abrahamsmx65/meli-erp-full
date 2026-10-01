/**
 * Precios para TikTok Shop a partir de lo que deja MELI.
 *
 * Pedido del dueño (1-oct-2026): «basándome en lo que recibo de MELI por un
 * producto quiero recibir lo mismo en TikTok, tomando en cuenta sus
 * comisiones e impuestos; el costo de afiliados lo calculamos a 4 % fijo
 * aunque sea más. Tres niveles: relámpago live (el más bajo), relámpago
 * normal 5 % arriba, y campaña regular otro 5 % arriba».
 *
 * Lo que TikTok le paga al vendedor por un par vendido a precio P (fórmula
 * de TikTok MX verificada campo por campo en lo liquidado, ver CLAUDE.md):
 *
 *   neto = P − comisión (6 % de P; dueño, 1-oct-2026: «es 6 % pero no me
 *                han cobrado, aunque van a comenzar pronto»: se descuenta ya)
 *            − cargo fijo por par ($6, el que sale en lo liquidado)
 *            − afiliado (4 % de P, regla del dueño)
 *            − envío (8 % de P; dueño: «el envío no es $19, es 8 %»)
 *            − IVA retenido (8 %) e ISR retenido (2.5 %) sobre la base SIN IVA (P / 1.16)
 *            − empaque ($2 por par, dueño)
 *
 * Despejando P para un neto objetivo N:  P = (N + cargo + empaque) / k, con
 * k = 1 − comisión − afiliado − envío − (ivaRet + isrRet) / (1 + IVA). Todo
 * es parámetro: la pantalla los enseña y deja cambiarlos.
 */

export interface ParametrosPrecioTikTok {
  /** comisión de TikTok sobre el precio pagado, en % */
  comisionPct: number;
  /** cargo fijo de TikTok por par, en pesos */
  cargoPorPar: number;
  /** comisión a creadores (afiliados) sobre el precio, en %; el dueño la fija en 4 */
  afiliadoPct: number;
  /** IVA retenido sobre la base sin IVA, en % */
  ivaRetenidoPct: number;
  /** ISR retenido sobre la base sin IVA, en % */
  isrRetenidoPct: number;
  /** IVA de la venta, en % (para sacar la base sin IVA) */
  ivaPct: number;
  /** envío que paga el vendedor, en % del precio */
  envioPct: number;
  /** empaque, en pesos por par */
  empaquePorPar: number;
  /** escalón entre niveles, en % (live → normal → campaña) */
  escalonPct: number;
}

export const PARAMETROS_POR_OMISION: ParametrosPrecioTikTok = {
  comisionPct: 6,
  cargoPorPar: 6,
  afiliadoPct: 4,
  ivaRetenidoPct: 8,
  isrRetenidoPct: 2.5,
  ivaPct: 16,
  envioPct: 8,
  empaquePorPar: 2,
  escalonPct: 5,
};

/** Lee los parámetros de un query string (lo que no venga o no sea número se queda en el de omisión). */
export function parametrosDesde(q: Record<string, string | string[] | undefined>): ParametrosPrecioTikTok {
  const lee = (clave: keyof ParametrosPrecioTikTok): number => {
    const v = q[clave];
    const n = Number(Array.isArray(v) ? v[0] : v);
    return v != null && v !== "" && Number.isFinite(n) && n >= 0 ? n : PARAMETROS_POR_OMISION[clave];
  };
  return {
    comisionPct: lee("comisionPct"),
    cargoPorPar: lee("cargoPorPar"),
    afiliadoPct: lee("afiliadoPct"),
    ivaRetenidoPct: lee("ivaRetenidoPct"),
    isrRetenidoPct: lee("isrRetenidoPct"),
    ivaPct: lee("ivaPct"),
    envioPct: lee("envioPct"),
    empaquePorPar: lee("empaquePorPar"),
    escalonPct: lee("escalonPct"),
  };
}

export interface DesgloseNetoTikTok {
  precio: number;
  comision: number;
  cargo: number;
  afiliado: number;
  ivaRetenido: number;
  isrRetenido: number;
  envio: number;
  empaque: number;
  /** lo que queda después de TikTok y del empaque */
  neto: number;
}

/** La fracción del precio que queda después de lo proporcional (comisión, afiliado, retenciones). */
export function factorNeto(p: ParametrosPrecioTikTok): number {
  return 1 - p.comisionPct / 100 - p.afiliadoPct / 100 - p.envioPct / 100 - (p.ivaRetenidoPct + p.isrRetenidoPct) / 100 / (1 + p.ivaPct / 100);
}

/** Lo que TikTok paga por UN par vendido a `precio`. */
export function netoTikTok(precio: number, p: ParametrosPrecioTikTok): DesgloseNetoTikTok {
  const base = precio / (1 + p.ivaPct / 100);
  const comision = (precio * p.comisionPct) / 100;
  const afiliado = (precio * p.afiliadoPct) / 100;
  const ivaRetenido = (base * p.ivaRetenidoPct) / 100;
  const isrRetenido = (base * p.isrRetenidoPct) / 100;
  const cargo = p.cargoPorPar;
  const envio = (precio * p.envioPct) / 100;
  const empaque = p.empaquePorPar;
  return { precio, comision, cargo, afiliado, ivaRetenido, isrRetenido, envio, empaque, neto: precio - comision - cargo - afiliado - ivaRetenido - isrRetenido - envio - empaque };
}

/** El precio (exacto, sin redondear) al que TikTok deja `netoObjetivo` por par; null si la fórmula no deja nada. */
export function precioParaNeto(netoObjetivo: number, p: ParametrosPrecioTikTok): number | null {
  const k = factorNeto(p);
  if (!(k > 0)) return null;
  return (netoObjetivo + p.cargoPorPar + p.empaquePorPar) / k;
}

export interface NivelPrecio {
  clave: "live" | "normal" | "campana";
  nombre: string;
  /** precio redondeado hacia arriba al peso */
  precio: number;
  /** lo que TikTok paga a ese precio */
  neto: number;
}

export const NOMBRES_NIVEL: Record<NivelPrecio["clave"], string> = {
  live: "Relámpago live",
  normal: "Relámpago normal",
  campana: "Campaña regular",
};

/**
 * Los tres niveles para un neto objetivo: live = el precio que deja ese
 * neto (al peso, hacia arriba); normal = live + escalón; campaña = normal +
 * escalón. null si el objetivo no se alcanza con esos parámetros.
 */
export function nivelesDePrecio(netoObjetivo: number, p: ParametrosPrecioTikTok): NivelPrecio[] | null {
  const exacto = precioParaNeto(netoObjetivo, p);
  if (exacto == null || !Number.isFinite(exacto) || exacto <= 0) return null;
  const live = Math.ceil(exacto);
  const normal = Math.ceil(live * (1 + p.escalonPct / 100));
  const campana = Math.ceil(normal * (1 + p.escalonPct / 100));
  return (
    [
      ["live", live],
      ["normal", normal],
      ["campana", campana],
    ] as const
  ).map(([clave, precio]) => ({ clave, nombre: NOMBRES_NIVEL[clave], precio, neto: netoTikTok(precio, p).neto }));
}

export interface RenglonPrecio {
  modelo: string;
  categoria: string | null;
  /** pares vendidos en MELI en el periodo */
  paresMeli: number;
  /** neto real depositado por MELI en el periodo */
  netoMeli: number;
  /** neto de MELI por par = objetivo */
  netoPorPar: number | null;
  /** costo por par capturado (Productos y costos); null sin costo */
  costo: number | null;
  /** precio actual promedio en TikTok (tiktok_skus activos); null si no está en TikTok */
  precioTikTok: number | null;
  /** lo que TikTok paga hoy por par a ese precio */
  netoTikTokActual: number | null;
  niveles: NivelPrecio[] | null;
}

export interface EntradaModelo {
  modelo: string;
  categoria: string | null;
  paresMeli: number;
  netoMeli: number;
  costo: number | null;
  precioTikTok: number | null;
}

/** Arma los renglones de la pantalla: un modelo por renglón, los que vendieron en MELI primero. */
export function renglonesDePrecio(entradas: EntradaModelo[], p: ParametrosPrecioTikTok): RenglonPrecio[] {
  return entradas
    .map((e) => {
      const netoPorPar = e.paresMeli > 0 ? e.netoMeli / e.paresMeli : null;
      return {
        modelo: e.modelo,
        categoria: e.categoria,
        paresMeli: e.paresMeli,
        netoMeli: e.netoMeli,
        netoPorPar,
        costo: e.costo,
        precioTikTok: e.precioTikTok,
        netoTikTokActual: e.precioTikTok != null ? netoTikTok(e.precioTikTok, p).neto : null,
        niveles: netoPorPar != null && netoPorPar > 0 ? nivelesDePrecio(netoPorPar, p) : null,
      };
    })
    .sort((a, b) => b.paresMeli - a.paresMeli || a.modelo.localeCompare(b.modelo));
}
