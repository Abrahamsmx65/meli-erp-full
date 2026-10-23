/**
 * CALCULADORA DE PRECIOS ENTRE EMPRESAS (dueño, 21-oct-2026). Motor puro.
 *
 * La cadena es: proveedor → INDUSTHER → KOMERLINE → Mercado Libre.
 *
 * KOMERLINE vende en Mercado Libre y NO se debe quedar con ganancia (que
 * casi no pague impuestos): le compra a Industher a lo que recibe por par
 * de MELI menos sus gastos de Full y su publicidad.
 *   precio Komerline = depósito real de MELI por par
 *                      − gastos de Full por par (del canal)
 *                      − publicidad por par (la del modelo + la sin amarre del canal)
 *                      − margen de Komerline (por omisión 0 %)
 * El depósito, la publicidad y los gastos de Full salen del ESTADO DE
 * RESULTADOS guardado (canal calzado en MELI) de los meses cerrados que se
 * elijan. Un producto NUEVO (menos de `UNIDADES_MINIMAS` pares vendidos en
 * esos meses) se calcula con el precio RELÁMPAGO de Números: lo que MELI
 * deposita a ese precio con las tasas de Números (las reales de 30 días si
 * hay, si no las estimadas), menos el Full y la publicidad PROMEDIO por par
 * del canal.
 *
 * INDUSTHER se queda con la ganancia, pero paga sus gastos de logística y
 * empleados (~$400,000 al mes) y debe quedarse con una ganancia del 3 % de
 * su facturación. El precio al que Industher compra es:
 *   precio Industher = precio Komerline
 *                      − gasto operativo ÷ unidades vendidas al mes (todas las plataformas)
 *                      − 3 % × precio Komerline
 *
 * TODO lleva IVA (el IVA siempre se traslada): el depósito de MELI ya lo
 * trae dentro, así que los precios son CON IVA y la base sin IVA es ÷ 1.16.
 */

export const IVA = 1.16;
/** Pares mínimos vendidos en los meses base para creerle al promedio real. */
export const UNIDADES_MINIMAS = 10;

export interface ParametrosCalculadora {
  /** meses cerrados que se promedian (1 a 6) */
  meses: number;
  /** gasto de logística y empleados de Industher al mes, con IVA */
  gastoMensualIndusther: number;
  /** unidades al mes para repartir el gasto; null = el promedio real de los meses base */
  unidadesMes: number | null;
  /** ganancia de Industher sobre su facturación (0.03 = 3 %) */
  gananciaIndusther: number;
  /** ganancia que se le deja a Komerline sobre lo que recibe (0 = nada) */
  margenKomerline: number;
}

export const PARAMETROS_CALCULADORA: ParametrosCalculadora = {
  meses: 3,
  gastoMensualIndusther: 400_000,
  unidadesMes: null,
  gananciaIndusther: 0.03,
  margenKomerline: 0,
};

/** Lo de un modelo en el canal calzado de MELI durante los meses base (sumado). */
export interface VentaModeloMeli {
  modelo: string;
  unidades: number;
  neto: number;
  ads: number;
}

/** Lo del canal calzado de MELI durante los meses base (sumado). */
export interface CanalMeliBase {
  unidades: number;
  neto: number;
  gastosFull: number;
  adsModelos: number;
  adsGenerales: number;
}

export interface ModeloCalculadora {
  modelo: string;
  categoria: string | null;
  costo: number | null;
  /** depósito de MELI por par al precio relámpago de Números (null sin precio) */
  netoRelampago: number | null;
  precioRelampago: number | null;
}

export interface RenglonCalculadora {
  modelo: string;
  categoria: string | null;
  fuente: "real" | "relampago" | "sin_dato";
  /** pares vendidos en MELI en los meses base */
  unidades: number;
  recibidoPar: number | null;
  fullPar: number;
  publicidadPar: number;
  margenKomerlinePar: number | null;
  precioKomerline: number | null;
  gastoOperativoPar: number;
  gananciaIndustherPar: number | null;
  precioIndusther: number | null;
  costo: number | null;
  /** lo que le queda a quien le vende a Industher: precio Industher − costo */
  margenProveedor: number | null;
  precioRelampago: number | null;
}

export interface ResultadoCalculadora {
  parametros: ParametrosCalculadora;
  unidadesMesUsadas: number | null;
  gastoOperativoPar: number;
  fullPar: number;
  publicidadPromedioPar: number;
  renglones: RenglonCalculadora[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function calcularPrecios(entrada: {
  parametros: ParametrosCalculadora;
  canal: CanalMeliBase;
  ventas: VentaModeloMeli[];
  modelos: ModeloCalculadora[];
  /** unidades vendidas en TODAS las plataformas en los meses base (sumadas) */
  unidadesTodas: number;
  /** cuántos meses base sí se encontraron */
  mesesLeidos: number;
}): ResultadoCalculadora {
  const P = entrada.parametros;
  const { canal } = entrada;
  const fullPar = div(canal.gastosFull, canal.unidades);
  const adsGeneralPar = div(canal.adsGenerales, canal.unidades);
  const publicidadPromedioPar = div(canal.adsModelos + canal.adsGenerales, canal.unidades);
  const unidadesMesUsadas =
    P.unidadesMes != null && P.unidadesMes > 0
      ? P.unidadesMes
      : entrada.mesesLeidos > 0 && entrada.unidadesTodas > 0
        ? entrada.unidadesTodas / entrada.mesesLeidos
        : null;
  const gastoOperativoPar = unidadesMesUsadas ? P.gastoMensualIndusther / unidadesMesUsadas : 0;

  const ventas = new Map(entrada.ventas.map((v) => [v.modelo.toUpperCase(), v]));
  const modelos = new Map(entrada.modelos.map((m) => [m.modelo.toUpperCase(), m]));
  const todos = new Set([...ventas.keys(), ...modelos.keys()]);

  const renglones: RenglonCalculadora[] = [...todos].map((clave) => {
    const v = ventas.get(clave);
    const m = modelos.get(clave);
    const unidades = v?.unidades ?? 0;
    let fuente: RenglonCalculadora["fuente"] = "sin_dato";
    let recibidoPar: number | null = null;
    let publicidadPar = 0;
    if (v && unidades >= UNIDADES_MINIMAS) {
      fuente = "real";
      recibidoPar = v.neto / unidades;
      publicidadPar = v.ads / unidades + adsGeneralPar;
    } else if (m?.netoRelampago != null) {
      fuente = "relampago";
      recibidoPar = m.netoRelampago;
      publicidadPar = publicidadPromedioPar;
    }
    const fullDelModelo = recibidoPar == null ? 0 : fullPar;
    const antesDeMargen = recibidoPar == null ? null : recibidoPar - fullDelModelo - publicidadPar;
    const margenKomerlinePar = antesDeMargen == null ? null : antesDeMargen * P.margenKomerline;
    const precioKomerline = antesDeMargen == null ? null : antesDeMargen - (margenKomerlinePar ?? 0);
    const gananciaIndustherPar = precioKomerline == null ? null : precioKomerline * P.gananciaIndusther;
    const precioIndusther =
      precioKomerline == null ? null : precioKomerline - gastoOperativoPar - (gananciaIndustherPar ?? 0);
    const costo = m?.costo ?? null;
    return {
      modelo: m?.modelo ?? v?.modelo ?? clave,
      categoria: m?.categoria ?? null,
      fuente,
      unidades,
      recibidoPar: recibidoPar == null ? null : r2(recibidoPar),
      fullPar: r2(fullDelModelo),
      publicidadPar: r2(publicidadPar),
      margenKomerlinePar: margenKomerlinePar == null ? null : r2(margenKomerlinePar),
      precioKomerline: precioKomerline == null ? null : r2(precioKomerline),
      gastoOperativoPar: r2(precioKomerline == null ? 0 : gastoOperativoPar),
      gananciaIndustherPar: gananciaIndustherPar == null ? null : r2(gananciaIndustherPar),
      precioIndusther: precioIndusther == null ? null : r2(precioIndusther),
      costo,
      margenProveedor: precioIndusther != null && costo != null ? r2(precioIndusther - costo) : null,
      precioRelampago: m?.precioRelampago ?? null,
    };
  });
  renglones.sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));

  return {
    parametros: P,
    unidadesMesUsadas: unidadesMesUsadas == null ? null : Math.round(unidadesMesUsadas),
    gastoOperativoPar: r2(gastoOperativoPar),
    fullPar: r2(fullPar),
    publicidadPromedioPar: r2(publicidadPromedioPar),
    renglones,
  };
}

/**
 * Precio unitario SIN IVA con 6 decimales (los que admite el CFDI): con dos,
 * 101.18 × 4,800 pares no daba lo mismo que 117.37 × 4,800 ÷ 1.16 (dueño,
 * 23-oct-2026: «no me cuadra el total, te faltan centavos»).
 */
export function precioSinIva(conIva: number): number {
  return Math.round((conIva / IVA) * 1e6) / 1e6;
}

/**
 * Importe de un renglón como lo arma la factura: pares × precio sin IVA (6
 * decimales), el IVA es el 16 % de ese importe y el total su suma. Así el
 * total con IVA sale del importe sin IVA y cuadra al centavo con lo que diga
 * el CFDI.
 */
export function importeFactura(conIva: number, pares: number): { unitario: number; base: number; iva: number; total: number } {
  const unitario = precioSinIva(conIva);
  const base = r2(unitario * pares);
  const iva = r2(base * (IVA - 1));
  return { unitario, base, iva, total: r2(base + iva) };
}

/** Lo que se le factura a un precio con IVA: base sin IVA e IVA trasladado. */
export function desgloseIva(conIva: number): { base: number; iva: number; total: number } {
  const base = r2(conIva / IVA);
  return { base, iva: r2(conIva - base), total: r2(conIva) };
}

/** Parámetros válidos a partir de lo que llega de la pantalla (lo inválido toma el de omisión). */
export function normalizarParametros(x: Partial<Record<keyof ParametrosCalculadora, unknown>> | null | undefined): ParametrosCalculadora {
  const P = PARAMETROS_CALCULADORA;
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const meses = num(x?.meses);
  const gasto = num(x?.gastoMensualIndusther);
  const unidades = num(x?.unidadesMes);
  const ganancia = num(x?.gananciaIndusther);
  const margen = num(x?.margenKomerline);
  return {
    meses: meses != null && meses >= 1 && meses <= 6 ? Math.round(meses) : P.meses,
    gastoMensualIndusther: gasto != null && gasto >= 0 ? gasto : P.gastoMensualIndusther,
    unidadesMes: unidades != null && unidades > 0 ? Math.round(unidades) : null,
    gananciaIndusther: ganancia != null && ganancia >= 0 && ganancia < 1 ? ganancia : P.gananciaIndusther,
    margenKomerline: margen != null && margen >= 0 && margen < 1 ? margen : P.margenKomerline,
  };
}

/** Un renglón de la factura del contenedor: un modelo con sus pares. */
export interface RenglonFactura {
  modelo: string;
  descripcion: string;
  codigoSat: string;
  pares: number;
  precioConIva: number | null;
  precioSinIva: number | null;
  importeSinIva: number | null;
  iva: number | null;
  total: number | null;
}

/** Junta los pares del contenedor por modelo y les pone el precio con IVA. */
export function facturaDeContenedor(
  renglones: { modelo: string; pares: number }[],
  precioDe: (modelo: string) => number | null,
  datosDe: (modelo: string) => { descripcion: string; codigoSat: string },
): { filas: RenglonFactura[]; totales: { pares: number; base: number; iva: number; total: number }; sinPrecio: string[]; sinCodigo: string[] } {
  const pares = new Map<string, number>();
  for (const r of renglones) pares.set(r.modelo, (pares.get(r.modelo) ?? 0) + r.pares);
  const filas: RenglonFactura[] = [];
  const sinPrecio: string[] = [];
  const sinCodigo: string[] = [];
  let tp = 0;
  let tb = 0;
  let ti = 0;
  for (const [modelo, n] of [...pares.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }))) {
    const precio = precioDe(modelo);
    const d = datosDe(modelo);
    if (!d.codigoSat) sinCodigo.push(modelo);
    tp += n;
    if (precio == null || precio <= 0) {
      sinPrecio.push(modelo);
      filas.push({ modelo, descripcion: d.descripcion, codigoSat: d.codigoSat, pares: n, precioConIva: null, precioSinIva: null, importeSinIva: null, iva: null, total: null });
      continue;
    }
    const { unitario, base, iva, total } = importeFactura(precio, n);
    tb += base;
    ti += iva;
    filas.push({ modelo, descripcion: d.descripcion, codigoSat: d.codigoSat, pares: n, precioConIva: r2(precio), precioSinIva: unitario, importeSinIva: base, iva, total });
  }
  return { filas, totales: { pares: tp, base: r2(tb), iva: r2(ti), total: r2(tb + ti) }, sinPrecio, sinCodigo };
}
