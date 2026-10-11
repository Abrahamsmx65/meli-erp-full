/**
 * COSTEO REAL POR CONTENEDOR (pedido del dueño, 11-oct-2026: «quiero
 * integrar mis finanzas al sistema […] el costo que quiero es el real para
 * calcular ganancias reales, pero para Números sí calculo el costo del
 * último contenedor»). Motor puro, sin base ni red.
 *
 * De dónde sale cada número:
 *   - LO PAGADO por contenedor, del sheet de CUENTAS del dueño (pestaña
 *     «COSTING GETAC», SOLO LECTURA: ese sheet nunca se escribe): costo de
 *     fábrica en USD y en PESOS (cada pago tiene su propio tipo de cambio,
 *     por eso manda PESOS COSTO, no USD × un tipo de cambio), flete en
 *     pesos, CRUCE TOTAL (la aduana) y ESTATUS. La comisión de Joanne sale
 *     de la pestaña «COMISSION JOANNE».
 *   - QUÉ TRAÍA cada contenedor: el Excel de costeo de la fábrica
 *     («Costing for shoe Internet»: por pedido los pares, el USD por par de
 *     cada modelo y los CBM) o, desde que existen, los packing lists del ERP
 *     (`contenedor_lineas` con sus medidas).
 *   - El CBM por par de cada modelo del sheet «Números» (pestaña CALZADO)
 *     solo de respaldo, si el contenedor no dice sus CBM.
 *
 * Reparto (igual que el Excel y «Números» del dueño):
 *   - fábrica en pesos y comisión → por el VALOR en USD de cada modelo;
 *   - flete y aduana → por los CBM de cada modelo.
 * Un contenedor solo CUENTA para el costo cuando el sheet dice ENTREGADO y
 * ya tiene apuntada la aduana (regla del dueño): antes, su precio no existe.
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

/** "S252-2026" → S252 / 2026; "S236" → S236 / null; "IN10079" → null. */
export function idContenedor(texto: unknown): { id: string; anio: number | null } | null {
  const m = norm(texto).match(/^S\s?(\d{3})(?:\s*-\s*(\d{4}))?$/);
  if (!m) return null;
  return { id: `S${m[1]}`, anio: m[2] ? Number(m[2]) : null };
}

/** "GT148", "GT148G", "MY2307", "G650", "YH1002" sí; "IN10079", "ETA :" no. */
export function esModelo(texto: unknown): boolean {
  const s = norm(texto);
  if (!s || /^IN\d/.test(s)) return false;
  return /^[A-Z]{1,4}\d{2,5}[A-Z]?$/.test(s);
}

const esPedido = (texto: unknown) => /^IN\d{4,}/.test(norm(texto));
const esIsoContenedor = (texto: unknown) => /^[A-Z]{4}\d{7}$/.test(norm(texto));

// ------------------------------------------------- Excel de costeo (fábrica)

export interface LineaCosteo {
  modelo: string;
  pedido: string | null;
  pares: number;
  /** costo de fábrica por par en USD; null si la fuente no lo trae */
  usdPar: number | null;
  /** metros cúbicos de ESTA línea; null si la fuente no los trae */
  cbm: number | null;
}

export interface DetalleContenedor {
  id: string;
  anio: number | null;
  iso: string | null;
  fuente: "excel" | "packing";
  lineas: LineaCosteo[];
}

/**
 * Lee el Excel de costeo de la fábrica. Cada contenedor es un bloque:
 *
 *   Invoice | Style | Qtys | Cost(RMB) | Cost in USD | Total | DHL USD | Cost/Piece | CBM
 *   S257-2026 |       |      |           |             |       | 773.78  | 7.862      | CBM   ← grupo (flete, CBM)
 *   ETD : …   | GT251 | 960  |           | 7.1         | 6816  | …                          ← modelo
 *   ETA : …   |       | 960                                                               ← subtotal
 *   MRSU6780533                                                                           ← contenedor
 *   IN10105   |       |      |           |             |       | 545.34  | 5.541      | CBM   ← otro grupo
 *
 * Un grupo es un renglón con flete en la G, CBM en la H y la palabra «CBM»
 * en la I; sus CBM se reparten entre los modelos del grupo por pares. Un
 * modelo sin nombre en su renglón es el del renglón anterior (otro color
 * del mismo modelo).
 */
export function leerExcelCosteo(filas: Filas): DetalleContenedor[] {
  const salida: DetalleContenedor[] = [];
  let actual: (DetalleContenedor & { grupos: { cbm: number | null; lineas: LineaCosteo[] }[] }) | null = null;
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
      actual = { ...id, iso: null, fuente: "excel", lineas: [], grupos: [] };
      grupo = null;
      ultimoModelo = null;
      pedido = null;
    }
    if (!actual) continue;
    const det = actual as DetalleContenedor & { grupos: { cbm: number | null; lineas: LineaCosteo[] }[] };
    if (esIsoContenedor(c(0))) det.iso = norm(c(0));
    if (esPedido(c(0))) pedido = norm(c(0)).match(/^IN\d+/)![0];
    if (esPedido(c(1))) pedido = norm(c(1)).match(/^IN\d+/)![0];

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

// ------------------------------------------------- sheet de cuentas (lectura)

export interface PagoContenedor {
  id: string;
  iso: string | null;
  productos: string;
  costoUsd: number | null;
  envioUsd: number | null;
  tipoCambio: number | null;
  /** lo pagado a la fábrica en pesos (cada pago con su tipo de cambio) */
  pesosCosto: number | null;
  pesosEnvio: number | null;
  /** CRUCE TOTAL: la aduana */
  aduana: number | null;
  estatus: string;
  entregado: boolean;
}

function columnas(encabezado: string[], nombres: Record<string, string[]>): Record<string, number> {
  const h = encabezado.map(norm);
  const r: Record<string, number> = {};
  for (const [k, alias] of Object.entries(nombres)) r[k] = h.findIndex((x) => alias.includes(x));
  return r;
}

/** Pestaña «COSTING GETAC» del sheet de cuentas. */
export function leerCostingGetac(filas: Filas): PagoContenedor[] {
  const iEnc = filas.findIndex((f) => (f ?? []).some((c) => norm(c) === "ID CONTENEDOR"));
  if (iEnc < 0) return [];
  const col = columnas(filas[iEnc], {
    iso: ["CONTENEDOR"],
    id: ["ID CONTENEDOR"],
    productos: ["PRODUCTO", "PRODUCTOS"],
    costoUsd: ["COSTO USD"],
    envioUsd: ["COSTO ENVIO", "ENVIO USD"],
    tipoCambio: ["TIPO DE CAMBIO"],
    pesosCosto: ["PESOS COSTO"],
    pesosEnvio: ["PESOS ENVIO"],
    aduana: ["CRUCE TOTAL", "ADUANA"],
    estatus: ["ESTATUS"],
  });
  const salida: PagoContenedor[] = [];
  const vistos = new Set<string>();
  for (const f of filas.slice(iEnc + 1)) {
    const v = (k: string) => (col[k] >= 0 ? f?.[col[k]] ?? "" : "");
    const id = idContenedor(v("id"));
    if (!id) continue;
    // La pestaña repite su tabla abajo: la primera aparición manda.
    if (vistos.has(id.id)) continue;
    const costoUsd = numeroCelda(v("costoUsd"));
    const tipoCambio = numeroCelda(v("tipoCambio"));
    let pesosCosto = numeroCelda(v("pesosCosto"));
    if ((pesosCosto == null || pesosCosto <= 0) && costoUsd && tipoCambio) pesosCosto = costoUsd * tipoCambio;
    const estatus = norm(v("estatus"));
    const productos = String(v("productos")).trim();
    if (!productos && costoUsd == null && !estatus) continue; // renglón reservado (S272…)
    vistos.add(id.id);
    salida.push({
      id: id.id,
      iso: esIsoContenedor(v("iso")) ? norm(v("iso")) : null,
      productos,
      costoUsd,
      envioUsd: numeroCelda(v("envioUsd")),
      tipoCambio,
      pesosCosto: pesosCosto && pesosCosto > 0 ? pesosCosto : null,
      pesosEnvio: numeroCelda(v("pesosEnvio")),
      aduana: numeroCelda(v("aduana")),
      estatus,
      entregado: estatus === "ENTREGADO",
    });
  }
  return salida;
}

/**
 * Pestaña «COMISSION JOANNE»: renglones PEDIDO | PRODUCTO | COSTO USD |
 * TIPO DE CAMBIO | COMISION MXN, dos bloques lado a lado (fundas y calzado).
 * Solo se toman los pedidos que son contenedor de calzado (S###).
 */
export function leerComisiones(filas: Filas): Map<string, number> {
  const r = new Map<string, number>();
  for (const f of filas) {
    for (let i = 0; i + 4 < (f?.length ?? 0); i++) {
      const id = idContenedor(f[i]);
      const comision = numeroCelda(f[i + 4]);
      if (id && comision != null && comision > 0 && !r.has(id.id)) r.set(id.id, comision);
    }
  }
  return r;
}

/** Pestaña CALZADO del sheet «Números»: CBM por par de cada modelo. */
export function leerCbmPorPar(filas: Filas): Map<string, number> {
  const r = new Map<string, number>();
  const iEnc = filas.findIndex((f) => (f ?? []).some((c) => norm(c) === "CBM X PAR"));
  if (iEnc < 0) return r;
  const col = columnas(filas[iEnc], { modelo: ["MODELO"], cbm: ["CBM X PAR"] });
  if (col.modelo < 0 || col.cbm < 0) return r;
  for (const f of filas.slice(iEnc + 1)) {
    const modelo = norm(f?.[col.modelo]);
    const cbm = numeroCelda(f?.[col.cbm]);
    if (esModelo(modelo) && cbm != null && cbm > 0 && !r.has(modelo)) r.set(modelo, cbm);
  }
  return r;
}

// ------------------------------------------------------------- el reparto

export interface CostoModeloContenedor {
  modelo: string;
  pares: number;
  usdPar: number | null;
  cbm: number;
  fabricaMxn: number;
  fleteMxn: number;
  aduanaMxn: number;
  comisionMxn: number;
  totalMxn: number;
  porPar: number;
}

export type MetodoCbm = "contenedor" | "numeros" | "pares";

export interface ContenedorCosteado {
  id: string;
  anio: number | null;
  iso: string | null;
  productos: string;
  estatus: string;
  /** true = ya entregado y con aduana: su costo cuenta */
  cuenta: boolean;
  /** por qué no cuenta todavía (null si cuenta) */
  motivo: string | null;
  fuente: "excel" | "packing" | null;
  metodoCbm: MetodoCbm | null;
  pesosCosto: number | null;
  pesosEnvio: number | null;
  aduana: number | null;
  comision: number;
  totalMxn: number;
  pares: number;
  modelos: CostoModeloContenedor[];
  avisos: string[];
}

/**
 * Reparte lo pagado por un contenedor entre sus modelos. Sin el detalle de
 * qué traía (ni Excel de costeo ni packing list) no se puede repartir y se
 * declara; lo mismo sin pesos de fábrica. Lo que se reparte suma EXACTO lo
 * pagado: fábrica + flete + aduana + comisión.
 */
export function costearContenedor(
  pago: PagoContenedor,
  detalle: DetalleContenedor | null,
  cbmPorPar: Map<string, number>,
  comision: number,
): ContenedorCosteado {
  const avisos: string[] = [];
  const base: ContenedorCosteado = {
    id: pago.id,
    anio: detalle?.anio ?? null,
    iso: pago.iso ?? detalle?.iso ?? null,
    productos: pago.productos,
    estatus: pago.estatus || "SIN ESTATUS",
    cuenta: false,
    motivo: null,
    fuente: detalle?.fuente ?? null,
    metodoCbm: null,
    pesosCosto: pago.pesosCosto,
    pesosEnvio: pago.pesosEnvio,
    aduana: pago.aduana,
    comision,
    totalMxn: (pago.pesosCosto ?? 0) + (pago.pesosEnvio ?? 0) + (pago.aduana ?? 0) + comision,
    pares: 0,
    modelos: [],
    avisos,
  };

  const lineas = (detalle?.lineas ?? []).filter((l) => l.pares > 0);
  if (!lineas.length) {
    base.motivo = "No se sabe qué traía: no está en el Excel de costeo ni tiene packing list en el ERP.";
    return base;
  }

  // Juntar por modelo.
  const porModelo = new Map<string, { pares: number; usd: number; conUsd: boolean; cbm: number | null }>();
  for (const l of lineas) {
    const m = porModelo.get(l.modelo) ?? { pares: 0, usd: 0, conUsd: true, cbm: 0 };
    m.pares += l.pares;
    if (l.usdPar == null) m.conUsd = false;
    else m.usd += l.usdPar * l.pares;
    m.cbm = m.cbm != null && l.cbm != null ? m.cbm + l.cbm : null;
    porModelo.set(l.modelo, m);
  }
  const modelos = [...porModelo.entries()];
  base.pares = modelos.reduce((s, [, m]) => s + m.pares, 0);

  // CBM: los del contenedor; si faltan, los de «Números»; si tampoco, por pares.
  let metodo: MetodoCbm = "contenedor";
  let cbms = modelos.map(([, m]) => m.cbm);
  if (cbms.some((c) => c == null || c <= 0)) {
    metodo = "numeros";
    cbms = modelos.map(([modelo, m]) => {
      const porPar = cbmPorPar.get(modelo);
      return m.cbm != null && m.cbm > 0 ? m.cbm : porPar != null ? porPar * m.pares : null;
    });
    if (cbms.some((c) => c == null || c <= 0)) {
      metodo = "pares";
      cbms = modelos.map(([, m]) => m.pares);
      avisos.push("Sin CBM de todos sus modelos: el flete y la aduana se repartieron por pares.");
    }
  }
  base.metodoCbm = metodo;
  const cbmTotal = cbms.reduce<number>((s, c) => s + (c ?? 0), 0);

  // Valor de fábrica: por USD si todos lo traen; si no, por pares.
  const porValor = modelos.every(([, m]) => m.conUsd && m.usd > 0);
  if (!porValor) avisos.push("Algún modelo no trae precio de fábrica: la fábrica se repartió por pares.");
  const pesos = modelos.map(([, m]) => (porValor ? m.usd : m.pares));
  const pesoTotal = pesos.reduce((s, x) => s + x, 0);

  const usdTotal = modelos.reduce((s, [, m]) => s + m.usd, 0);
  if (porValor && pago.costoUsd && Math.abs(usdTotal - pago.costoUsd) > Math.max(1, pago.costoUsd * 0.01)) {
    avisos.push(
      `El detalle suma US$${usdTotal.toFixed(2)} y en cuentas dice US$${pago.costoUsd.toFixed(2)}: se reparte lo de cuentas en la proporción del detalle.`,
    );
  }

  const fabrica = pago.pesosCosto ?? 0;
  const flete = pago.pesosEnvio ?? 0;
  const aduana = pago.aduana ?? 0;
  base.modelos = modelos
    .map(([modelo, m], i) => {
      const pv = pesoTotal > 0 ? pesos[i] / pesoTotal : 0;
      const pc = cbmTotal > 0 ? (cbms[i] ?? 0) / cbmTotal : 0;
      const fabricaMxn = fabrica * pv;
      const fleteMxn = flete * pc;
      const aduanaMxn = aduana * pc;
      const comisionMxn = comision * pv;
      const totalMxn = fabricaMxn + fleteMxn + aduanaMxn + comisionMxn;
      return {
        modelo,
        pares: m.pares,
        usdPar: m.conUsd && m.pares > 0 ? m.usd / m.pares : null,
        cbm: cbms[i] ?? 0,
        fabricaMxn,
        fleteMxn,
        aduanaMxn,
        comisionMxn,
        totalMxn,
        porPar: m.pares > 0 ? totalMxn / m.pares : 0,
      };
    })
    .sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));

  if (!pago.entregado) base.motivo = "Todavía no está ENTREGADO.";
  else if (!pago.aduana || pago.aduana <= 0) base.motivo = "Falta apuntar la aduana (CRUCE TOTAL).";
  else if (!pago.pesosCosto) base.motivo = "Falta lo pagado a la fábrica (COSTO USD y tipo de cambio) en cuentas.";
  else if (!pago.pesosEnvio || pago.pesosEnvio <= 0) {
    // Sin flete se puede costear, pero se avisa: casi seguro falta capturarlo.
    avisos.push("No tiene flete en pesos apuntado.");
  }
  base.cuenta = base.motivo == null;
  return base;
}

// ----------------------------------------------------- costo por modelo

export interface TomaDeContenedor {
  id: string;
  pares: number;
  porPar: number;
}

export interface CostoModelo {
  modelo: string;
  /** el último contenedor entregado con aduana: el que usa «Números» */
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
  /** todos los contenedores entregados con este modelo, del más nuevo al más viejo */
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
      const pares = tomas.reduce((s, t) => s + t.pares, 0);
      real = pares > 0 ? tomas.reduce((s, t) => s + t.pares * t.porPar, 0) / pares : real;
    } else if (ultimo) {
      tomas = [{ ...ultimo }];
    }
    salida.push({ modelo, ultimo, real, tomas, existencias: stock, sinCubrir, historial: h });
  }
  return salida.sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));
}
