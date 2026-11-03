/**
 * Lectura de los sheets del dueño: «Cuentas YAPANIZCEL» y «Números».
 * Puro (salvo `libroDeXlsx`, que solo abre el archivo), para probarse.
 *
 * Decisión del dueño (16-oct-2026: «sí, que lo lea automático y manda el
 * sheet»): el 11-oct-2026 los dos se importaron UNA vez; desde hoy se
 * vuelven a leer solos y lo que dice el sheet REEMPLAZA lo que vino del
 * sheet. Lo capturado a mano en el ERP (sin `clave_importacion`) no se toca.
 * El sheet NUNCA se escribe.
 *
 * Por qué se reemplaza todo y no renglón por renglón: el dueño inserta
 * renglones en medio (GASTOS MEX tenía «SUELDOS BODEGA» del 9-oct en el
 * renglón 73, donde la importación había puesto «AI» del 10-oct), así que el
 * número de renglón no identifica nada.
 */
import ExcelJS from "exceljs";

/** Una celda: su valor (lo que el sheet enseña) y, si tiene, su fórmula. */
export interface Celda {
  v: string | number | null;
  f?: string;
}
export type Hoja = Celda[][];
export type Libro = Map<string, Hoja>;

export const SHEET_CUENTAS =
  "https://docs.google.com/spreadsheets/d/1-GwdeIj8Y1_fDr5WqA3TcYMAIzEOc0TOPvmwxUQFoUk/export?format=xlsx";
export const SHEET_NUMEROS =
  "https://docs.google.com/spreadsheets/d/1fQKU0lwxvcqjhBH4hlF9gk2tzo8X04fdq7KKRDP_wzA/export?format=xlsx";

function valor(v: unknown): string | number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return valor(o.result);
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("").trim() || null;
    }
    if ("text" in o) return valor(o.text);
    if ("error" in o) return null;
  }
  const t = String(v).trim();
  return t === "" ? null : t;
}

/** Abre un .xlsx con todas sus pestañas, celda por celda (sin `sheet_to_json`). */
export async function libroDeXlsx(buffer: ArrayBuffer | Buffer): Promise<Libro> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)) as unknown as ArrayBuffer);
  const libro: Libro = new Map();
  for (const ws of wb.worksheets) {
    const hoja: Hoja = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const fila: Celda[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        // `cell.formula` ya trae traducida la fórmula COMPARTIDA (la de Google
        // guarda una sola por columna y las demás apuntan a ella).
        const f = cell.type === ExcelJS.ValueType.Formula ? String(cell.formula ?? "") : "";
        fila[c - 1] = f ? { v: valor(cell.value), f } : { v: valor(cell.value) };
      });
      hoja[r - 1] = fila;
    });
    libro.set(ws.name.trim().toUpperCase(), hoja);
  }
  return libro;
}

// ---------------------------------------------------------------------------

const celda = (h: Hoja, r: number, c: number): Celda => h[r]?.[c] ?? { v: null };
const num = (x: Celda): number | null => {
  if (typeof x.v === "number") return Number.isFinite(x.v) ? x.v : null;
  if (typeof x.v === "string") {
    const n = Number(x.v.replace(/[$,\s]/g, ""));
    return x.v.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
};
const txt = (x: Celda): string => (x.v == null ? "" : String(x.v).replace(/\s+/g, " ").trim());
/** Fecha ISO (AAAA-MM-DD) o null. Las fechas del .xlsx ya llegan como ISO. */
const MESES: Record<string, number> = {
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12,
};
/**
 * Fecha ISO (AAAA-MM-DD) o null. Las fechas del .xlsx llegan como ISO, pero
 * el dueño a veces la escribe como texto: «03-AGO-2026», «13-07-2026»,
 * «15/08/2026» (SUELDOS, 16-oct-2026: $663 mil de retiros se quedaban fuera).
 */
export const fecha = (x: Celda): string | null => {
  const t = txt(x).toUpperCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[-/ .]([A-Z]{3}|\d{1,2})[A-Z]*[-/ .](\d{4})$/);
  if (!m) return null;
  const mes = /^\d+$/.test(m[2]) ? Number(m[2]) : MESES[m[2]];
  const dia = Number(m[1]);
  if (!mes || mes > 12 || dia < 1 || dia > 31) return null;
  return `${m[3]}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
};
const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function hoja(libro: Libro, nombre: string): Hoja | null {
  return libro.get(nombre.toUpperCase()) ?? null;
}

/** Fila de encabezados: la primera que trae todos los textos pedidos. */
function filaEncabezado(h: Hoja, quiero: string[], hasta = 10): { fila: number; col: Map<string, number> } | null {
  for (let r = 0; r < Math.min(hasta, h.length); r++) {
    const textos = (h[r] ?? []).map((c) => txt(c ?? { v: null }).toUpperCase());
    const col = new Map<string, number>();
    for (const q of quiero) {
      const i = textos.findIndex((t) => t === q);
      if (i >= 0) col.set(q, i);
    }
    if (col.size === quiero.length) return { fila: r, col };
  }
  return null;
}

// ---- Cuentas YAPANIZCEL ----------------------------------------------------

export interface GastoSheet {
  clave: string;
  fecha: string;
  concepto: string;
  monto: number;
  categoria: string;
}
export interface MovimientoSheet {
  clave: string;
  fecha: string | null;
  tipo: "transferencia" | "ingreso" | "shein" | "gasto";
  monto: number;
  beneficiario: string;
  referencia: string | null;
  comision: number;
  notas: string | null;
}
export interface RetiroSheet {
  clave: string;
  socio: "ABRAHAM" | "DANIEL";
  fecha: string;
  concepto: string;
  monto: number;
}
export interface ContenedorSheet {
  contenedor: string;
  iso: string | null;
  productos: string | null;
  negocio: "calzado" | "fundas";
  costoUsd: number | null;
  fleteUsd: number | null;
  /** tipo de cambio de la fábrica (TIPO DE CAMBIO) */
  tcFabrica: number | null;
  /** tipo de cambio del flete = PESOS ENVIO ÷ COSTO ENVIO del MISMO renglón */
  tcFlete: number | null;
  aduana: number | null;
  entregado: boolean;
}
export interface CuentasSheet {
  gastos: GastoSheet[];
  movimientos: MovimientoSheet[];
  retiros: RetiroSheet[];
  contenedores: ContenedorSheet[];
  /** pestañas que se leyeron (las que no, no se tocan en la base) */
  leidas: Set<"gastos" | "transferencias" | "shein" | "sueldos" | "costeo" | "total">;
  avisos: string[];
}

/**
 * Categoría de un gasto en efectivo por su concepto. Las mismas que quedaron
 * al importar el 11-oct-2026 (SUELDOS BODEGA → Nómina, FLETE → Fletes…); un
 * concepto que ya tenía categoría en el ERP la conserva (`conocidas`).
 */
export function categoriaDeGasto(concepto: string, conocidas?: Map<string, string>): string {
  const c = concepto.toUpperCase();
  const ya = conocidas?.get(c);
  if (ya) return ya;
  if (/SUELDO|QUINCENA|NOMINA|NÓMINA|AGUINALDO|BONO/.test(c)) return "Nómina";
  if (/FLETE|GUIA|GUÍA|PAQUETER|ENVIO|ENVÍO/.test(c)) return "Fletes";
  if (/CAJA|BOLSA|EMPAQUE|CINTA|ETIQUETA/.test(c)) return "Empaque";
  if (/VIDEO|FOTO|\bAI\b|PUBLICIDAD|MODELO|INFLUENCER|MARKETING/.test(c)) return "Marketing";
  if (/AIRE|REPISA|CAMARA|CÁMARA|OFICINA|COMPUTADORA|IMPRESORA|MUEBLE|EQUIPO/.test(c)) return "Oficina y equipo";
  if (/REGISTRO|MARCA|GESTOR|NOTARI|TRAMITE|TRÁMITE|IMPI/.test(c)) return "Trámites";
  if (/BOLETO|VIAJE|HOTEL|VUELO|AVION|AVIÓN/.test(c)) return "Viajes";
  if (/COMISION|COMISIÓN/.test(c)) return "Comisiones";
  return "Otros";
}

export function leerCuentas(libro: Libro, conocidas?: Map<string, string>): CuentasSheet {
  const r: CuentasSheet = { gastos: [], movimientos: [], retiros: [], contenedores: [], leidas: new Set(), avisos: [] };

  // GASTOS MEX: FECHA | MONTO | CONCEPTO. Un monto NEGATIVO es dinero que
  // entró (CREDI PAGO: una deuda que le pagaron al dueño) y va a la cuenta
  // como ingreso, igual que en la importación.
  const gm = hoja(libro, "GASTOS MEX");
  const encGm = gm && filaEncabezado(gm, ["FECHA", "MONTO", "CONCEPTO"]);
  if (gm && encGm) {
    r.leidas.add("gastos");
    const [cF, cM, cC] = ["FECHA", "MONTO", "CONCEPTO"].map((k) => encGm.col.get(k)!);
    for (let i = encGm.fila + 1; i < gm.length; i++) {
      const monto = num(celda(gm, i, cM));
      if (monto == null || monto === 0) continue;
      const concepto = txt(celda(gm, i, cC)) || "SIN CONCEPTO";
      const f = fecha(celda(gm, i, cF));
      if (!f) {
        r.avisos.push(`GASTOS MEX renglón ${i + 1}: ${concepto} $${monto} sin fecha; no se tomó.`);
        continue;
      }
      const clave = `cuentas:gastos-mex:${i + 1}`;
      if (monto < 0) {
        r.movimientos.push({
          clave, fecha: f, tipo: "ingreso", monto: -monto, beneficiario: concepto, referencia: null, comision: 0,
          notas: "En GASTOS MEX en negativo: dinero que entró sin comisión",
        });
      } else {
        r.gastos.push({ clave, fecha: f, concepto, monto, categoria: categoriaDeGasto(concepto, conocidas) });
      }
    }
  } else r.avisos.push("No se encontró la pestaña GASTOS MEX (FECHA, MONTO, CONCEPTO).");

  // TRANSFERENCIAS: FECHA | MONTO | BENEFICIARIO | PRODUCTO | COMISION.
  const tr = hoja(libro, "TRANSFERENCIAS");
  const encTr = tr && filaEncabezado(tr, ["FECHA", "MONTO", "BENEFICIARIO", "PRODUCTO", "COMISION"]);
  if (tr && encTr) {
    r.leidas.add("transferencias");
    const g = (k: string) => encTr.col.get(k)!;
    for (let i = encTr.fila + 1; i < tr.length; i++) {
      const monto = num(celda(tr, i, g("MONTO")));
      if (monto == null || monto === 0) continue;
      const f = fecha(celda(tr, i, g("FECHA")));
      const beneficiario = txt(celda(tr, i, g("BENEFICIARIO")));
      // Sin fecha también cuenta: el SUMA del sheet la incluye y el total
      // tiene que cuadrar. Va a la cuenta del año en curso.
      if (!f) r.avisos.push(`TRANSFERENCIAS renglón ${i + 1}: ${beneficiario} $${monto} sin fecha; cuenta en el año en curso.`);
      r.movimientos.push({
        clave: `cuentas:transferencias:${i + 1}`,
        fecha: f,
        tipo: "transferencia",
        monto,
        beneficiario,
        referencia: txt(celda(tr, i, g("PRODUCTO"))) || null,
        comision: redondear(num(celda(tr, i, g("COMISION"))) ?? 0),
        notas: null,
      });
    }
  } else r.avisos.push("No se encontró la pestaña TRANSFERENCIAS.");

  // CUENTA SHEIN: las ENTRADAS (izquierda) ya están en TRANSFERENCIAS como
  // DEPOSITO SHEIN; aquí solo las SALIDAS de la derecha (renta, mercancía):
  // fecha | monto | concepto en las columnas F, G y H.
  const sh = hoja(libro, "CUENTA SHEIN");
  if (sh) {
    r.leidas.add("shein");
    let n = 0;
    for (let i = 0; i < sh.length; i++) {
      const f = fecha(celda(sh, i, 5));
      const monto = num(celda(sh, i, 6));
      if (!f || monto == null || monto === 0) continue;
      n++;
      r.movimientos.push({
        clave: `cuentas:shein:${n}`, fecha: f, tipo: "shein", monto,
        beneficiario: txt(celda(sh, i, 7)) || "SHEIN", referencia: null, comision: 0, notas: null,
      });
    }
  } else r.avisos.push("No se encontró la pestaña CUENTA SHEIN.");

  // SUELDOS: Abraham en A–C y Daniel en F–H (FECHA | CONCEPTO | CANTIDAD).
  // Lo que no trae fecha se queda fuera, como en la importación: en el sheet
  // tampoco suma (DÓLARES VIAJE y los AMEX sin fecha).
  const su = hoja(libro, "SUELDOS");
  if (su) {
    r.leidas.add("sueldos");
    const bloques: { socio: "ABRAHAM" | "DANIEL"; c: number; letra: string }[] = [
      { socio: "ABRAHAM", c: 0, letra: "A" },
      { socio: "DANIEL", c: 5, letra: "F" },
    ];
    for (const b of bloques) {
      for (let i = 0; i < su.length; i++) {
        const monto = num(celda(su, i, b.c + 2));
        const f = fecha(celda(su, i, b.c));
        if (monto == null || monto === 0) continue;
        if (!f) continue;
        r.retiros.push({ clave: `cuentas:sueldos:${b.letra}${i + 1}`, socio: b.socio, fecha: f, concepto: txt(celda(su, i, b.c + 1)), monto });
      }
    }
  } else r.avisos.push("No se encontró la pestaña SUELDOS.");

  // TOTAL: la renta de la oficina de 12 meses (sin fecha, va al ejercicio).
  const to = hoja(libro, "TOTAL");
  if (to) {
    for (let i = 0; i < to.length; i++) {
      if (/^RENTA OFICINA/.test(txt(celda(to, i, 0)).toUpperCase())) {
        const monto = num(celda(to, i, 1));
        if (monto != null && monto > 0) {
          r.leidas.add("total");
          r.movimientos.push({
            clave: "cuentas:total:renta-oficina", fecha: null, tipo: "gasto", monto, beneficiario: "RENTA OFICINA",
            referencia: null, comision: 0, notas: "12 meses (pestaña TOTAL)",
          });
        }
      }
    }
  }

  // COSTING GETAC y COSTING FUNDAS: lo pagado por contenedor.
  const costeo = (nombre: string, negocio: "calzado" | "fundas") => {
    const h = hoja(libro, nombre);
    if (!h) {
      r.avisos.push(`No se encontró la pestaña ${nombre}.`);
      return false;
    }
    const enc =
      negocio === "calzado"
        ? filaEncabezado(h, ["CONTENEDOR", "ID CONTENEDOR", "PRODUCTO", "COSTO USD", "COSTO ENVIO", "TIPO DE CAMBIO", "PESOS ENVIO", "CRUCE TOTAL", "ESTATUS"])
        : filaEncabezado(h, ["ID", "COSTO USD", "ENVIO USD", "TIPO DE CAMBIO", "ENVIO MXN", "ADUANA", "ESTATUS"]);
    if (!enc) {
      r.avisos.push(`La pestaña ${nombre} no trae los encabezados de siempre; no se leyó.`);
      return false;
    }
    const g = (k: string) => enc.col.get(k)!;
    for (let i = enc.fila + 1; i < h.length; i++) {
      const id = txt(celda(h, i, g(negocio === "calzado" ? "ID CONTENEDOR" : "ID"))).toUpperCase();
      if (!/^[SP]\d{3,4}$/.test(id)) continue;
      const costoUsd = num(celda(h, i, g("COSTO USD")));
      const fleteUsd = num(celda(h, i, g(negocio === "calzado" ? "COSTO ENVIO" : "ENVIO USD")));
      const pesosFlete = num(celda(h, i, g(negocio === "calzado" ? "PESOS ENVIO" : "ENVIO MXN")));
      const aduana = num(celda(h, i, g(negocio === "calzado" ? "CRUCE TOTAL" : "ADUANA")));
      const estatus = txt(celda(h, i, g("ESTATUS"))).toUpperCase();
      // Renglón reservado sin nada capturado (S273, S274…): no es contenedor aún.
      if (costoUsd == null && fleteUsd == null && aduana == null) continue;
      r.contenedores.push({
        contenedor: id,
        iso: negocio === "calzado" ? txt(celda(h, i, g("CONTENEDOR"))).toUpperCase() || null : null,
        productos: negocio === "calzado" ? txt(celda(h, i, g("PRODUCTO"))) || null : null,
        negocio,
        costoUsd,
        fleteUsd,
        tcFabrica: num(celda(h, i, g("TIPO DE CAMBIO"))),
        tcFlete: fleteUsd && pesosFlete ? redondear(pesosFlete / fleteUsd, 6) : null,
        aduana,
        entregado: estatus === "ENTREGADO",
      });
    }
    return true;
  };
  const okGetac = costeo("COSTING GETAC", "calzado");
  const okFundas = costeo("COSTING FUNDAS", "fundas");
  if (okGetac && okFundas) r.leidas.add("costeo");

  return r;
}

// ---- Números ---------------------------------------------------------------

export interface NumerosSheet {
  modelo: string;
  envioMeli: number | null;
  precioRelampago: number | null;
  pvNormal: number | null;
  retencion: boolean;
  envioAmazon: number | null;
  pvpDeal: number | null;
  tiktokExtra: number;
  tiktokComision: number;
  tiktokOferta: number;
}

const FACTOR_PV_NORMAL = 1.065;
const FACTOR_DEAL = 1.12;
const sinEspacios = (f?: string) => (f ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Un precio que en el sheet es fórmula del factor DE SIEMPRE se deja vacío
 * (el ERP lo calcula con el mismo factor y sigue al relámpago); cualquier
 * otro (un número a mano, «=I5*1.053», «=P2*1.12+20») se guarda con el valor
 * que el sheet enseña.
 */
function precioOFactor(c: Celda, letra: string, factor: number): number | null {
  const f = sinEspacios(c.f);
  const m = f.match(new RegExp(`^${letra}\\d+\\*([\\d.]+)$`));
  if (m && Math.abs(Number(m[1]) - factor) < 1e-9) return null;
  return num(c);
}

/**
 * La pestaña CALZADO de «Números». Las columnas que el dueño fija a mano y
 * los parámetros que viven DENTRO de sus fórmulas (verificado el 16-oct-2026
 * en los 162 modelos):
 *   J «=I-(I*0.15)-H-((I/1.16)*0.105)-G» → lleva retención de 10.5 %;
 *   P «=(N+O)/(1-0.2405205)» (o «(N+38)…» con el envío escrito adentro);
 *   R «=(N+8)/(1-0.24)» → extra y comisión de TikTok;
 *   T «=R*1.11» → factor de oferta de TikTok.
 */
export function leerNumeros(libro: Libro): { modelos: NumerosSheet[]; avisos: string[] } {
  const avisos: string[] = [];
  const h = hoja(libro, "CALZADO");
  const enc = h && filaEncabezado(h, ["MODELO", "ENVIO", "PRECIO RELAMPAGO", "PV NORMAL", "ENVIO AMAZON"]);
  if (!h || !enc) return { modelos: [], avisos: ["No se encontró la pestaña CALZADO de Números con sus encabezados."] };
  const iModelo = enc.col.get("MODELO")!;
  const iEnvio = enc.col.get("ENVIO")!;
  const iPr = enc.col.get("PRECIO RELAMPAGO")!;
  const iPv = enc.col.get("PV NORMAL")!;
  const iEnvAmz = enc.col.get("ENVIO AMAZON")!;
  // Por posición respecto a ENVIO AMAZON (O): P = PVP sin ads, Q = deal,
  // R = TikTok lives, S = relámpagos, T = oferta campañas.
  const iPvp = iEnvAmz + 1;
  const iDeal = iEnvAmz + 2;
  const iTikTok = iEnvAmz + 3;
  const iOferta = iEnvAmz + 5;
  const iGanancia = iPr + 1;
  const vistos = new Set<string>();
  const modelos: NumerosSheet[] = [];
  for (let i = enc.fila + 1; i < h.length; i++) {
    const modelo = txt(celda(h, i, iModelo)).toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z]{1,4}\d{2,5}[A-Z]?$/.test(modelo) || vistos.has(modelo)) continue;
    vistos.add(modelo);
    const fGan = sinEspacios(celda(h, i, iGanancia).f);
    const fPvp = sinEspacios(celda(h, i, iPvp).f);
    const fTik = sinEspacios(celda(h, i, iTikTok).f);
    const fOferta = sinEspacios(celda(h, i, iOferta).f);
    const envioEnPvp = fPvp.match(/^\(N\d+\+([\d.]+)\)/);
    const tik = fTik.match(/^\(N\d+\+([\d.]+)\)\/\(1-([\d.]+)\)$/);
    const oferta = fOferta.match(/^R\d+\*([\d.]+)$/);
    modelos.push({
      modelo,
      envioMeli: num(celda(h, i, iEnvio)),
      precioRelampago: num(celda(h, i, iPr)),
      pvNormal: precioOFactor(celda(h, i, iPv), "I", FACTOR_PV_NORMAL),
      retencion: /0\.105/.test(fGan),
      envioAmazon: num(celda(h, i, iEnvAmz)) ?? (envioEnPvp ? Number(envioEnPvp[1]) : null),
      pvpDeal: precioOFactor(celda(h, i, iDeal), "P", FACTOR_DEAL),
      tiktokExtra: tik ? Number(tik[1]) : 8,
      tiktokComision: tik ? Number(tik[2]) : 0.24,
      tiktokOferta: oferta ? Number(oferta[1]) : 1.11,
    });
  }
  return { modelos, avisos };
}
