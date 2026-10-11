/**
 * COSTEO REAL POR CONTENEDOR (dueño, 11-oct-2026: «el costo que quiero es
 * el real para calcular ganancias reales, pero para Números sí calculo el
 * costo del último contenedor»; y el mismo día: «quiero dejar de usar el
 * sheet COSTING GETAC para tener todo en el sistema, el reparto se hace a
 * fuerzas por CBM de lo que dice en el contenedor, la comisión de Joanne no
 * me la metas como costo»). Motor puro, sin base ni red.
 *
 * De dónde sale cada número (todo vive en el ERP):
 *   - LO PAGADO: `costeo_contenedores` (factura en USD, flete en USD, aduana
 *     en pesos, si ya se entregó) y `costeo_pagos` (cada pago en USD con SU
 *     tipo de cambio). Los pesos de la fábrica = factura USD × el tipo de
 *     cambio promedio ponderado de sus pagos; lo mismo el flete con los
 *     suyos (sin pagos de flete, con el de la fábrica, y se avisa).
 *   - QUÉ TRAÍA: el Excel de costeo de la fábrica («Costing for shoe
 *     Internet»: pares, USD por par y CBM por pedido) o el packing list del
 *     ERP (`contenedor_lineas` con medidas).
 *
 * Reparto: la fábrica por el VALOR en USD de cada modelo; el flete y la
 * aduana SOLO por los CBM que dice el contenedor (sin CBM, no se costea y
 * se declara: no se adivina). Comisiones y demás gastos NO entran: son
 * gasto operativo. Un contenedor solo CUENTA entregado y con la aduana
 * apuntada.
 */
import type { Filas } from "../importar/leer-hoja";

// ---------------------------------------------------------------- números

/** "$1,234.50", "1234.5", "17.0225" → número; vacío o texto → null. */
export function numeroCelda(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, "").trim();
  if (!s || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/**
 * "S252-2026" → S252 / 2026; "S236" → S236 / null; "P605" (fundas) → P605;
 * "IN10079" → null.
 */
export function idContenedor(texto: unknown): { id: string; anio: number | null } | null {
  const m = norm(texto).match(/^([SP])\s?(\d{3})(?:\s*-\s*(\d{4}))?$/);
  if (!m) return null;
  return { id: `${m[1]}${m[2]}`, anio: m[3] ? Number(m[3]) : null };
}

/** "GT148", "GT148G", "MY2307", "G650", "YH1002" sí; "IN10079", "ETA :" no. */
export function esModelo(texto: unknown): boolean {
  const s = norm(texto);
  if (!s || /^IN\d/.test(s)) return false;
  return /^[A-Z]{1,4}\d{2,5}[A-Z]?$/.test(s);
}

const esPedido = (texto: unknown) => /^IN\d{4,}/.test(norm(texto));
export const esIsoContenedor = (texto: unknown) => /^[A-Z]{4}\d{7}$/.test(norm(texto));

// ------------------------------------------------- Excel de costeo (fábrica)

export interface LineaCosteo {
  modelo: string;
  pedido: string | null;
  pares: number;
  /** costo de fábrica por par (USD en el Excel; en el packing list solo vale como proporción) */
  usdPar: number | null;
  /** metros cúbicos de ESTA línea; null si la fuente no los trae */
  cbm: number | null;
}

export interface DetalleContenedor {
  id: string;
  anio: number | null;
  iso: string | null;
  fuente: "excel" | "packing";
  /** flete total en USD que dice la fuente («US$7,330/HQ + US$100 … | 7430») */
  fleteUsd?: number | null;
  lineas: LineaCosteo[];
}

type EnArmado = DetalleContenedor & { grupos: { cbm: number | null; lineas: LineaCosteo[] }[] };

/**
 * Lee el Excel de costeo de la fábrica. Cada contenedor es un bloque:
 *
 *   Invoice | Style | Qtys | Cost(RMB) | Cost in USD | Total | DHL USD | Cost/Piece | CBM
 *   S257-2026 |       |      |           |             |       | 773.78  | 7.862      | CBM   ← grupo (flete, CBM)
 *   ETD : …   | GT251 | 960  |           | 7.1         | 6816  | …                          ← modelo
 *   ETA : …   |       | 960                                                               ← subtotal
 *   MRSU6780533                                                                           ← contenedor
 *   IN10105   |       |      |           |             |       | 545.34  | 5.541      | CBM   ← otro grupo
 *   …         |       |      |           |             |       | US$6,230/HQ + US$100 … | 6330  ← flete total
 *
 * Un grupo es un renglón con flete en la G, CBM en la H y la palabra «CBM»
 * en la I; sus CBM se reparten entre los modelos del grupo por pares. Un
 * modelo sin nombre en su renglón es el del renglón anterior (otro color
 * del mismo modelo).
 */
export function leerExcelCosteo(filas: Filas): DetalleContenedor[] {
  const salida: DetalleContenedor[] = [];
  let actual: EnArmado | null = null;
  let grupo: { cbm: number | null; lineas: LineaCosteo[] } | null = null;
  let ultimoModelo: string | null = null;
  let pedido: string | null = null;

  const cerrar = () => {
    if (!actual) return;
    for (const g of actual.grupos) {
      const pares = g.lineas.reduce((s, l) => s + l.pares, 0);
      for (const l of g.lineas) l.cbm = g.cbm != null && pares > 0 ? (g.cbm * l.pares) / pares : null;
    }
    const { grupos: _g, ...resto } = actual;
    if (resto.lineas.length) salida.push(resto);
    actual = null;
  };

  for (const f of filas) {
    const c = (i: number) => f?.[i] ?? "";
    if (norm(c(0)) === "INVOICE" && norm(c(1)) === "STYLE") continue;
    const id = idContenedor(c(0));
    if (id) {
      cerrar();
      actual = { ...id, iso: null, fuente: "excel", fleteUsd: null, lineas: [], grupos: [] };
      grupo = null;
      ultimoModelo = null;
      pedido = null;
    }
    if (!actual) continue;
    const det: EnArmado = actual;
    if (esIsoContenedor(c(0))) det.iso = norm(c(0));
    if (esPedido(c(0))) pedido = norm(c(0)).match(/^IN\d+/)![0];
    if (esPedido(c(1))) pedido = norm(c(1)).match(/^IN\d+/)![0];
    if (/US\$/.test(String(c(7))) && numeroCelda(c(8)) != null) det.fleteUsd = numeroCelda(c(8));

    // Renglón de grupo: flete (G) + CBM (H) + «CBM» (I). El total del
    // contenedor trae CBM pero NO flete: ese no abre grupo.
    if (norm(c(8)) === "CBM" && numeroCelda(c(6)) != null) {
      grupo = { cbm: numeroCelda(c(7)), lineas: [] };
      det.grupos.push(grupo);
      ultimoModelo = null;
    }

    const pares = numeroCelda(c(2));
    const usd = numeroCelda(c(4));
    if (pares != null && pares > 0 && usd != null && usd > 0) {
      const modelo: string | null = esModelo(c(1)) ? norm(c(1)) : ultimoModelo;
      if (!modelo) continue;
      ultimoModelo = modelo;
      if (!grupo) {
        grupo = { cbm: null, lineas: [] };
        det.grupos.push(grupo);
      }
      const linea: LineaCosteo = { modelo, pedido, pares, usdPar: usd, cbm: null };
      grupo.lineas.push(linea);
      det.lineas.push(linea);
    }
  }
  cerrar();
  return salida;
}

// ------------------------------------------------------------- lo pagado

export interface PagoUsd {
  usd: number;
  tipoCambio: number;
}

export type NegocioContenedor = "calzado" | "fundas";

export interface DatosContenedor {
  id: string;
  negocio: NegocioContenedor;
  /** comisión del agente (Joanne) en pesos: gasto operativo, NO costo del par */
  comisionAgente: number | null;
  anio: number | null;
  iso: string | null;
  productos: string;
  /** factura de la fábrica en USD (sin capturar: la del Excel de costeo) */
  costoUsd: number | null;
  /** flete en USD (sin capturar: el del Excel de costeo) */
  fleteUsd: number | null;
  aduana: number | null;
  entregado: boolean;
  pagosFabrica: PagoUsd[];
  pagosFlete: PagoUsd[];
  notas: string | null;
}

/** Tipo de cambio promedio ponderado por USD; null sin pagos. */
export function tipoCambioPonderado(pagos: PagoUsd[]): number | null {
  const usd = pagos.reduce((s, p) => s + p.usd, 0);
  if (usd <= 0) return null;
  return pagos.reduce((s, p) => s + p.usd * p.tipoCambio, 0) / usd;
}

// ------------------------------------------------------------- el reparto

export interface CostoModeloContenedor {
  modelo: string;
  pares: number;
  usdPar: number | null;
  cbm: number | null;
  fabricaMxn: number;
  fleteMxn: number;
  aduanaMxn: number;
  totalMxn: number;
  porPar: number;
}

export interface ContenedorCosteado {
  id: string;
  negocio: NegocioContenedor;
  comisionAgente: number | null;
  anio: number | null;
  iso: string | null;
  productos: string;
  entregado: boolean;
  /** true = entregado, con aduana y completo: su costo cuenta */
  cuenta: boolean;
  /** por qué no cuenta todavía (null si cuenta) */
  motivo: string | null;
  fuente: "excel" | "packing" | null;
  costoUsd: number | null;
  pagadoUsd: number;
  tcFabrica: number | null;
  fleteUsd: number | null;
  tcFlete: number | null;
  pesosCosto: number | null;
  pesosEnvio: number | null;
  aduana: number | null;
  totalMxn: number;
  pares: number;
  cbm: number | null;
  modelos: CostoModeloContenedor[];
  avisos: string[];
  notas: string | null;
}

/**
 * Reparte lo pagado por un contenedor entre sus modelos. Lo repartido suma
 * EXACTO fábrica + flete + aduana. Lo que no se puede saber (sin detalle,
 * sin CBM, sin pagos) se declara en `motivo` y el contenedor no cuenta.
 */
export function costearContenedor(datos: DatosContenedor, detalle: DetalleContenedor | null): ContenedorCosteado {
  const avisos: string[] = [];
  const lineas = (detalle?.lineas ?? []).filter((l) => l.pares > 0);

  // Juntar por modelo.
  const porModelo = new Map<string, { pares: number; usd: number; conUsd: boolean; cbm: number | null }>();
  for (const l of lineas) {
    const m = porModelo.get(l.modelo) ?? { pares: 0, usd: 0, conUsd: true, cbm: 0 };
    m.pares += l.pares;
    if (l.usdPar == null) m.conUsd = false;
    else m.usd += l.usdPar * l.pares;
    m.cbm = m.cbm != null && l.cbm != null && l.cbm > 0 ? m.cbm + l.cbm : null;
    porModelo.set(l.modelo, m);
  }
  const modelos = [...porModelo.entries()];
  const pares = modelos.reduce((s, [, m]) => s + m.pares, 0);
  const conCbm = modelos.length > 0 && modelos.every(([, m]) => m.cbm != null && m.cbm > 0);
  const cbmTotal = conCbm ? modelos.reduce((s, [, m]) => s + (m.cbm ?? 0), 0) : null;
  const conPrecio = modelos.length > 0 && modelos.every(([, m]) => m.conUsd && m.usd > 0);
  const usdDetalle = modelos.reduce((s, [, m]) => s + m.usd, 0);

  // La factura: la capturada; si no, la del Excel (ahí el precio SÍ es USD).
  const costoUsd = datos.costoUsd ?? (detalle?.fuente === "excel" && conPrecio ? usdDetalle : null);
  const pagadoUsd = datos.pagosFabrica.reduce((s, p) => s + p.usd, 0);
  const tcFabrica = tipoCambioPonderado(datos.pagosFabrica);
  const pesosCosto = costoUsd != null && tcFabrica != null ? costoUsd * tcFabrica : null;
  if (costoUsd != null && tcFabrica != null && pagadoUsd < costoUsd - 1) {
    avisos.push(
      `Pagado US$${pagadoUsd.toFixed(2)} de US$${costoUsd.toFixed(2)}: lo que falta se valuó con el tipo de cambio de lo ya pagado.`,
    );
  }
  if (detalle?.fuente === "excel" && conPrecio && datos.costoUsd != null && Math.abs(usdDetalle - datos.costoUsd) > Math.max(1, datos.costoUsd * 0.01)) {
    avisos.push(`El Excel de costeo suma US$${usdDetalle.toFixed(2)} y la factura capturada US$${datos.costoUsd.toFixed(2)}.`);
  }

  const fleteUsd = datos.fleteUsd ?? detalle?.fleteUsd ?? null;
  let tcFlete = tipoCambioPonderado(datos.pagosFlete);
  if (tcFlete == null && fleteUsd && tcFabrica != null) {
    tcFlete = tcFabrica;
    avisos.push("El flete no tiene pago capturado: se valuó con el tipo de cambio de la fábrica.");
  }
  const pesosEnvio = fleteUsd != null && tcFlete != null ? fleteUsd * tcFlete : null;
  const aduana = datos.aduana != null && datos.aduana > 0 ? datos.aduana : null;

  let motivo: string | null = null;
  if (!lineas.length) motivo = "No se sabe qué traía: no está en el Excel de costeo ni tiene packing list.";
  else if (!datos.entregado) motivo = "Todavía no está entregado.";
  else if (aduana == null) motivo = "Falta apuntar la aduana.";
  else if (costoUsd == null) motivo = "Falta la factura de la fábrica en USD.";
  else if (tcFabrica == null) motivo = "Faltan los pagos a la fábrica con su tipo de cambio.";
  else if (!conCbm) motivo = "El contenedor no dice los CBM de todos sus modelos.";
  else if (!conPrecio) motivo = "Falta el precio de fábrica de algún modelo.";
  if (lineas.length && pesosEnvio == null && motivo == null) avisos.push("No tiene flete capturado.");

  const fabrica = pesosCosto ?? 0;
  const flete = pesosEnvio ?? 0;
  const adu = aduana ?? 0;
  const calculable = conCbm && conPrecio;
  const repartidos: CostoModeloContenedor[] = modelos
    .map(([modelo, m]) => {
      const pv = calculable && usdDetalle > 0 ? m.usd / usdDetalle : 0;
      const pc = calculable && cbmTotal ? (m.cbm ?? 0) / cbmTotal : 0;
      const fabricaMxn = fabrica * pv;
      const fleteMxn = flete * pc;
      const aduanaMxn = adu * pc;
      const totalMxn = fabricaMxn + fleteMxn + aduanaMxn;
      return {
        modelo,
        pares: m.pares,
        usdPar: m.conUsd && m.pares > 0 ? m.usd / m.pares : null,
        cbm: m.cbm,
        fabricaMxn,
        fleteMxn,
        aduanaMxn,
        totalMxn,
        porPar: m.pares > 0 ? totalMxn / m.pares : 0,
      };
    })
    .sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));

  return {
    id: datos.id,
    negocio: datos.negocio,
    comisionAgente: datos.comisionAgente,
    anio: datos.anio ?? detalle?.anio ?? null,
    iso: datos.iso ?? detalle?.iso ?? null,
    productos: datos.productos,
    entregado: datos.entregado,
    cuenta: motivo == null,
    motivo,
    fuente: detalle?.fuente ?? null,
    costoUsd,
    pagadoUsd,
    tcFabrica,
    fleteUsd,
    tcFlete,
    pesosCosto,
    pesosEnvio,
    aduana,
    totalMxn: (pesosCosto ?? 0) + (pesosEnvio ?? 0) + (aduana ?? 0),
    pares,
    cbm: cbmTotal,
    modelos: repartidos,
    avisos,
    notas: datos.notas,
  };
}

// ----------------------------------------------------- costo por modelo

export interface TomaDeContenedor {
  id: string;
  pares: number;
  porPar: number;
}

export interface CostoModelo {
  modelo: string;
  /** el último contenedor entregado con aduana: el que usa Números */
  ultimo: TomaDeContenedor | null;
  /**
   * Costo REAL de lo que hay hoy en existencia (PEPS): se valúan las
   * existencias con los contenedores más recientes hacia atrás, porque lo
   * que hay en el estante es lo último que llegó. Sin existencias, el del
   * último contenedor.
   */
  real: number | null;
  /** de qué contenedores sale el costo real y cuántos pares de cada uno */
  tomas: TomaDeContenedor[];
  existencias: number | null;
  /** existencias que ningún contenedor costeado cubre (llegaron antes) */
  sinCubrir: number;
  /** todos los contenedores que cuentan con este modelo, del más nuevo al más viejo */
  historial: TomaDeContenedor[];
}

/** Más nuevo primero: por año (si se sabe) y luego por número. */
export function ordenContenedor(a: { id: string; anio: number | null }, b: { id: string; anio: number | null }): number {
  const na = Number(a.id.slice(1));
  const nb = Number(b.id.slice(1));
  if (a.anio != null && b.anio != null && a.anio !== b.anio) return b.anio - a.anio;
  return nb - na;
}

export function costosPorModelo(
  contenedores: ContenedorCosteado[],
  existencias: Map<string, number> | null,
): CostoModelo[] {
  const cuentan = contenedores.filter((c) => c.cuenta).sort(ordenContenedor);
  const historial = new Map<string, TomaDeContenedor[]>();
  for (const c of cuentan) {
    for (const m of c.modelos) {
      const h = historial.get(m.modelo) ?? [];
      h.push({ id: c.id, pares: m.pares, porPar: m.porPar });
      historial.set(m.modelo, h);
    }
  }
  const salida: CostoModelo[] = [];
  for (const [modelo, h] of historial) {
    const stock = existencias ? existencias.get(modelo) ?? 0 : null;
    const ultimo = h[0] ?? null;
    let tomas: TomaDeContenedor[] = [];
    let sinCubrir = 0;
    let real: number | null = ultimo?.porPar ?? null;
    if (stock != null && stock > 0) {
      let falta = stock;
      for (const t of h) {
        if (falta <= 0) break;
        const toma = Math.min(falta, t.pares);
        tomas.push({ ...t, pares: toma });
        falta -= toma;
      }
      sinCubrir = Math.max(0, falta);
      const p = tomas.reduce((s, t) => s + t.pares, 0);
      real = p > 0 ? tomas.reduce((s, t) => s + t.pares * t.porPar, 0) / p : real;
    } else if (ultimo) {
      tomas = [{ ...ultimo }];
    }
    salida.push({ modelo, ultimo, real, tomas, existencias: stock, sinCubrir, historial: h });
  }
  return salida.sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));
}
