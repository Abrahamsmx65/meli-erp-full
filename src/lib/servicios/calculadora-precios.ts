/**
 * Calculadora de precios entre empresas (Industher → Komerline). Junta lo
 * que el motor puro (`finanzas/calculadora-precios.ts`) necesita: el estado
 * de resultados GUARDADO de los meses cerrados (canal calzado en MELI y las
 * unidades de todas las plataformas), Números (precio relámpago, tasas y
 * costo del último contenedor) y los parámetros que el dueño fija, guardados
 * en `app_cache` (`calculadora-precios:config`). Solo lee renglones ya
 * masticados: nada pesado en el request.
 */
import ExcelJS from "exceljs";
import { traerTodo, type Cuenta, type DB } from "../datos/repos";
import {
  PARAMETROS_CALCULADORA,
  calcularPrecios,
  desgloseIva,
  facturaDeContenedor,
  normalizarParametros,
  type CanalMeliBase,
  type ModeloCalculadora,
  type ParametrosCalculadora,
  type RenglonFactura,
  type ResultadoCalculadora,
  type VentaModeloMeli,
} from "../finanzas/calculadora-precios";
import { calcularNumeros, tasasUsadas } from "../finanzas/numeros";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { leerConsolidadoGuardado } from "./consolidado-cargar";
import { nombreDelPeriodo, periodoActual, periodoAnterior } from "./corte-meli";
import { listarNumeros } from "./numeros";
import { CLAVE_TARIFAS, type TarifasGuardadas } from "./tarifas-reales";
import { codigoFiscalDeCategoria } from "./packing-list-contenedor";
import { datosDeModelos, renglonesDelContenedor } from "./contenedor-datos";
import { CLAVE_COSTEO_EXCEL, type ExcelCosteoGuardado } from "./costeo";
import { numeroDeEmbarque } from "./drive-packing";

export const CLAVE_CONFIG_CALCULADORA = "calculadora-precios:config";

export async function leerParametrosCalculadora(db: DB, accountId: string): Promise<ParametrosCalculadora> {
  const r = await leerCacheAppGuardado<Partial<ParametrosCalculadora>>(db, accountId, CLAVE_CONFIG_CALCULADORA);
  return r.estado === "encontrado" ? normalizarParametros(r.valor.datos) : { ...PARAMETROS_CALCULADORA };
}

export async function guardarParametrosCalculadora(db: DB, accountId: string, x: unknown): Promise<ParametrosCalculadora> {
  const p = normalizarParametros((x ?? {}) as any);
  await guardarCacheApp(db, accountId, CLAVE_CONFIG_CALCULADORA, p, 0);
  return p;
}

/** Los N meses CERRADOS más recientes (sin el mes en curso), del más viejo al más nuevo. */
export function mesesBase(n: number, hoy = periodoActual()): string[] {
  const lista: string[] = [];
  for (let p = periodoAnterior(hoy); lista.length < n; p = periodoAnterior(p)) lista.unshift(p);
  return lista;
}

export interface CalculadoraCargada extends ResultadoCalculadora {
  meses: string[];
  mesesFaltantes: string[];
  avisos: string[];
}

export async function cargarCalculadora(db: DB, cuenta: Cuenta, parametros?: ParametrosCalculadora): Promise<CalculadoraCargada> {
  const P = parametros ?? (await leerParametrosCalculadora(db, cuenta.id));
  const meses = mesesBase(P.meses);
  const [estados, tarifas] = await Promise.all([
    Promise.all(meses.map(async (periodo) => ({ periodo, cns: await leerConsolidadoGuardado(db, cuenta, periodo) }))),
    leerCacheAppGuardado<TarifasGuardadas>(db, cuenta.id, CLAVE_TARIFAS),
  ]);
  const porModelo = tarifas.estado === "encontrado" ? tarifas.valor.datos.porModelo : {};
  const { renglones: numeros } = await listarNumeros(db, cuenta.id, porModelo);

  const avisos: string[] = [];
  const mesesFaltantes: string[] = [];
  const canal: CanalMeliBase = { unidades: 0, neto: 0, gastosFull: 0, adsModelos: 0, adsGenerales: 0 };
  const ventas = new Map<string, VentaModeloMeli>();
  let unidadesTodas = 0;
  let mesesLeidos = 0;
  for (const { periodo, cns } of estados) {
    const c = cns?.canales.find((x) => x.canal === "meli_calzado");
    if (!cns || !c) {
      mesesFaltantes.push(periodo);
      continue;
    }
    mesesLeidos++;
    unidadesTodas += cns.total.unidades ?? 0;
    canal.unidades += c.unidades;
    canal.neto += c.neto;
    canal.gastosFull += c.gastos.filter((g) => /^Gastos de Full/i.test(g.concepto)).reduce((a, g) => a + g.monto, 0);
    canal.adsModelos += c.adsPorModelo;
    canal.adsGenerales += c.adsGenerales;
    if (c.coberturaNeto != null && c.coberturaNeto < 0.95)
      avisos.push(`${nombreDelPeriodo(periodo)}: solo el ${Math.round(c.coberturaNeto * 100)} % de la venta de MELI tiene depósito leído.`);
    for (const m of c.porModelo) {
      const k = m.modelo.toUpperCase();
      const v = ventas.get(k) ?? { modelo: m.modelo, unidades: 0, neto: 0, ads: 0 };
      v.unidades += m.unidades;
      v.neto += m.neto;
      v.ads += m.ads;
      ventas.set(k, v);
    }
  }
  if (mesesFaltantes.length)
    avisos.push(`Sin estado de resultados guardado de ${mesesFaltantes.map(nombreDelPeriodo).join(", ")}: no entra al promedio.`);
  if (tarifas.estado !== "encontrado") avisos.push("Sin tarifas reales de Números: los productos nuevos usan tus tasas estimadas.");

  const modelos: ModeloCalculadora[] = numeros.map((r) => {
    const pr = r.entrada.precioRelampago;
    let netoRelampago: number | null = null;
    if (pr != null) {
      const res = calcularNumeros(r.entrada, r.costo, r.reales);
      const t = tasasUsadas(r.entrada, r.reales).meli;
      netoRelampago = res.recibidoMeli?.porPar ?? pr * (1 - t.comisionPct - t.retencionPct) - t.envio;
    }
    return { modelo: r.entrada.modelo, categoria: r.categoria, costo: r.costo, netoRelampago, precioRelampago: pr };
  });

  const res = calcularPrecios({ parametros: P, canal, ventas: [...ventas.values()], modelos, unidadesTodas, mesesLeidos });
  return { ...res, meses, mesesFaltantes, avisos };
}

/** Desde qué embarque se ofrece la factura (dueño, 21-oct-2026: «desde S245»). */
export const PRIMER_EMBARQUE_FACTURA = 245;

export interface ContenedorFactura {
  /** S### sin año: la llave con que se pide el Excel */
  numero: string;
  /** de dónde salen modelo y pares */
  fuente: "erp" | "costeo";
  estado: string | null;
  /** id en `contenedores` si existe ahí */
  idErp: string | null;
  iso: string | null;
}

const claveEmbarque = (n: number) => `S${String(n).padStart(3, "0")}`;

/**
 * Los contenedores para la factura: los de Contenedores (desde S250, con su
 * packing list) y los del Excel de costeo de la fábrica, que trae modelo y
 * pares de los embarques viejos (S245–S249) que nunca se cargaron en
 * Contenedores. Si está en los dos, manda Contenedores. Más nuevos primero.
 */
export async function listaContenedores(db: DB, accountId: string): Promise<ContenedorFactura[]> {
  const [erp, excel] = await Promise.all([
    traerTodo<any>(db, "contenedores", "id, numero, numero_naviera, estado", (q) => q.eq("account_id", accountId)),
    leerCacheAppGuardado<ExcelCosteoGuardado>(db, accountId, CLAVE_COSTEO_EXCEL),
  ]);
  const porNumero = new Map<number, ContenedorFactura>();
  for (const c of erp) {
    const n = numeroDeEmbarque(c.numero);
    if (n == null || n < PRIMER_EMBARQUE_FACTURA || porNumero.has(n)) continue;
    porNumero.set(n, { numero: claveEmbarque(n), fuente: "erp", estado: c.estado ?? null, idErp: c.id, iso: c.numero_naviera ?? null });
  }
  if (excel.estado === "encontrado") {
    for (const d of excel.valor.datos.contenedores) {
      const n = numeroDeEmbarque(d.id);
      if (n == null || n < PRIMER_EMBARQUE_FACTURA || porNumero.has(n) || !d.lineas.length) continue;
      porNumero.set(n, { numero: claveEmbarque(n), fuente: "costeo", estado: null, idErp: null, iso: d.iso ?? null });
    }
  }
  return [...porNumero.entries()].sort((a, b) => b[0] - a[0]).map(([, c]) => c);
}

/** Modelo y pares del contenedor: del packing list en Contenedores o, si no está ahí, del Excel de costeo. */
async function paresDelContenedor(
  db: DB,
  accountId: string,
  numero: string,
): Promise<{ numero: string; iso: string | null; fuente: ContenedorFactura["fuente"]; pares: { modelo: string; pares: number }[] } | null> {
  const n = numeroDeEmbarque(numero);
  if (n == null) return null;
  const lista = await listaContenedores(db, accountId);
  const c = lista.find((x) => numeroDeEmbarque(x.numero) === n);
  if (!c) return null;
  if (c.fuente === "erp" && c.idErp) {
    const renglones = await renglonesDelContenedor(db, c.idErp);
    return { numero: c.numero, iso: c.iso, fuente: "erp", pares: renglones.map((r) => ({ modelo: r.modelo, pares: r.cajas * r.paresPorCaja })) };
  }
  const excel = await leerCacheAppGuardado<ExcelCosteoGuardado>(db, accountId, CLAVE_COSTEO_EXCEL);
  if (excel.estado !== "encontrado") return null;
  const d = excel.valor.datos.contenedores.find((x) => numeroDeEmbarque(x.id) === n);
  if (!d) return null;
  return { numero: c.numero, iso: c.iso, fuente: "costeo", pares: d.lineas.map((l) => ({ modelo: l.modelo.toUpperCase(), pares: l.pares })) };
}

export const HOJAS = {
  komerline: { titulo: "Factura Industher a Komerline", corto: "KOMERLINE" },
  industher: { titulo: "Factura a Industher", corto: "INDUSTHER" },
} as const;

/**
 * El Excel para pedir la factura del contenedor: una hoja por cada compra
 * (Komerline a Industher, y la de Industher) con modelo, código SAT, pares,
 * precio por par con y sin IVA, IVA e importe. Lo que no tiene precio o
 * código SAT va en blanco y en la hoja «Avisos»: no se inventa.
 */
export interface FacturaArmada {
  tipo: keyof typeof HOJAS;
  titulo: string;
  filas: RenglonFactura[];
  totales: { pares: number; base: number; iva: number; total: number };
  sinPrecio: string[];
}

export interface ExcelFactura {
  nombre: string;
  buffer: Buffer;
  numero: string;
  iso: string | null;
  fuente: ContenedorFactura["fuente"];
  meses: string[];
  facturas: FacturaArmada[];
  avisos: string[];
}

export async function excelFacturaContenedor(db: DB, cuenta: Cuenta, numero: string): Promise<ExcelFactura | null> {
  const contenedor = await paresDelContenedor(db, cuenta.id, numero);
  if (!contenedor) return null;
  const pares = contenedor.pares.filter((p) => p.pares > 0);
  const calc = await cargarCalculadora(db, cuenta);
  const precios = new Map(calc.renglones.map((r) => [r.modelo.toUpperCase(), r]));
  const datos = await datosDeModelos(db, cuenta.id, [...new Set(pares.map((r) => r.modelo))]);
  const datosDe = (modelo: string) => {
    const d = datos.get(modelo);
    return { descripcion: d?.titulo ?? "", codigoSat: codigoFiscalDeCategoria(d?.categoriaMeli) ?? "" };
  };

  const libro = new ExcelJS.Workbook();
  const avisos: string[] = [...calc.avisos];
  hojaResumen(libro, contenedor, calc, pares, precios, datosDe);
  const facturas: FacturaArmada[] = [];
  for (const tipo of ["komerline", "industher"] as const) {
    const f = facturaDeContenedor(
      pares,
      (m) => {
        const r = precios.get(m.toUpperCase());
        return (tipo === "komerline" ? r?.precioKomerline : r?.precioIndusther) ?? null;
      },
      datosDe,
    );
    facturas.push({ tipo, titulo: HOJAS[tipo].titulo, filas: f.filas, totales: f.totales, sinPrecio: f.sinPrecio });
    const hoja = libro.addWorksheet(HOJAS[tipo].titulo);
    hoja.addRow([`${HOJAS[tipo].titulo} · contenedor ${contenedor.numero}${contenedor.iso ? ` (${contenedor.iso})` : ""}`]).font = { bold: true, size: 13 };
    hoja.addRow([
      `Promedio de ${calc.meses.map(nombreDelPeriodo).join(", ")} · precios con IVA trasladado (16 %) · pares del ${contenedor.fuente === "erp" ? "packing list en Contenedores" : "Excel de costeo de la fábrica"}`,
    ]);
    hoja.addRow([]);
    const enc = hoja.addRow(["MODELO", "CODIGO SAT", "DESCRIPCION", "PARES", "PRECIO POR PAR SIN IVA", "IVA POR PAR", "PRECIO POR PAR CON IVA", "IMPORTE SIN IVA", "IVA", "TOTAL"]);
    enc.font = { bold: true, color: { argb: "FFFFFFFF" } };
    enc.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } }));
    for (const x of f.filas) agregarFila(hoja, x);
    const tot = hoja.addRow(["TOTAL", "", "", f.totales.pares, null, null, null, f.totales.base, f.totales.iva, f.totales.total]);
    tot.font = { bold: true };
    hoja.getColumn(2).numFmt = "@";
    for (const c of [5, 6, 7, 8, 9, 10]) hoja.getColumn(c).numFmt = '"$"#,##0.00';
    hoja.getColumn(4).numFmt = "#,##0";
    [12, 13, 50, 9, 14, 12, 14, 16, 14, 16].forEach((w, i) => (hoja.getColumn(i + 1).width = w));
    if (f.sinPrecio.length) avisos.push(`${HOJAS[tipo].corto}: sin precio (sin ventas en MELI ni precio relámpago en Números): ${f.sinPrecio.join(", ")}.`);
    if (tipo === "komerline" && f.sinCodigo.length) avisos.push(`Sin categoría de MELI reconocida (CODIGO SAT en blanco): ${f.sinCodigo.join(", ")}.`);
  }
  const relampago = new Set(calc.renglones.filter((r) => r.fuente === "relampago").map((r) => r.modelo.toUpperCase()));
  const nuevos = [...new Set(pares.map((r) => r.modelo))].filter((m) => relampago.has(m.toUpperCase()));
  if (nuevos.length) avisos.push(`Producto nuevo, calculado con el precio relámpago de Números: ${nuevos.join(", ")}.`);
  if (avisos.length) {
    const h = libro.addWorksheet("Avisos");
    h.getColumn(1).width = 120;
    for (const a of avisos) h.addRow([a]);
  }
  const buffer = Buffer.from(await libro.xlsx.writeBuffer());
  const nombre = `factura-${contenedor.numero.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.xlsx`;
  return { nombre, buffer, numero: contenedor.numero, iso: contenedor.iso, fuente: contenedor.fuente, meses: calc.meses, facturas, avisos };
}

/**
 * Primera hoja: por modelo, la cuenta completa y los DOS precios lado a lado
 * (dueño, 21-oct-2026: «en el Excel no sale el precio de Industher»; las
 * facturas van en sus propias hojas).
 */
export function hojaResumen(
  libro: ExcelJS.Workbook,
  contenedor: { numero: string; iso: string | null },
  calc: CalculadoraCargada,
  pares: { modelo: string; pares: number }[],
  precios: Map<string, CalculadoraCargada["renglones"][number]>,
  datosDe: (modelo: string) => { descripcion: string; codigoSat: string },
) {
  const porModelo = new Map<string, number>();
  for (const p of pares) porModelo.set(p.modelo, (porModelo.get(p.modelo) ?? 0) + p.pares);
  const hoja = libro.addWorksheet("Resumen");
  hoja.addRow([`Resumen · contenedor ${contenedor.numero}${contenedor.iso ? ` (${contenedor.iso})` : ""}`]).font = { bold: true, size: 13 };
  hoja.addRow([`Promedio de ${calc.meses.map(nombreDelPeriodo).join(", ")} · cada precio por par con IVA y sin IVA (IVA trasladado 16 %)`]);
  hoja.addRow([]);
  const enc = hoja.addRow([
    "MODELO", "CODIGO SAT", "PARES", "RECIBE MELI", "− FULL", "− PUBLICIDAD",
    "PRECIO KOMERLINE CON IVA", "PRECIO KOMERLINE SIN IVA", "− GASTO OPERATIVO", "− GANANCIA INDUSTHER",
    "PRECIO INDUSTHER CON IVA", "PRECIO INDUSTHER SIN IVA",
    "TOTAL KOMERLINE SIN IVA", "TOTAL KOMERLINE CON IVA", "TOTAL INDUSTHER SIN IVA", "TOTAL INDUSTHER CON IVA",
  ]);
  enc.font = { bold: true, color: { argb: "FFFFFFFF" } };
  enc.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } }));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const sinIva = (x: number | null) => (x == null ? null : desgloseIva(x).base);
  let tp = 0, tk = 0, ti = 0, tkb = 0, tib = 0;
  for (const [modelo, n] of [...porModelo.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }))) {
    const r = precios.get(modelo.toUpperCase());
    const k = r?.precioKomerline ?? null;
    const i = r?.precioIndusther ?? null;
    const kb = sinIva(k);
    const ib = sinIva(i);
    tp += n;
    if (k != null) (tk += k * n), (tkb += kb! * n);
    if (i != null) (ti += i * n), (tib += ib! * n);
    hoja.addRow([
      modelo, datosDe(modelo).codigoSat, n, r?.recibidoPar ?? null,
      k != null ? r!.fullPar : null, k != null ? r!.publicidadPar : null, k, kb,
      i != null ? r!.gastoOperativoPar : null, r?.gananciaIndustherPar ?? null, i, ib,
      kb != null ? r2(kb * n) : null, k != null ? r2(k * n) : null,
      ib != null ? r2(ib * n) : null, i != null ? r2(i * n) : null,
    ]);
  }
  hoja.addRow(["TOTAL", "", tp, null, null, null, null, null, null, null, null, null, r2(tkb), r2(tk), r2(tib), r2(ti)]).font = { bold: true };
  hoja.getColumn(2).numFmt = "@";
  hoja.getColumn(3).numFmt = "#,##0";
  for (let c = 4; c <= 16; c++) hoja.getColumn(c).numFmt = '"$"#,##0.00';
  [12, 13, 9, 13, 10, 13, 15, 15, 18, 20, 15, 15, 17, 17, 17, 17].forEach((w, i) => (hoja.getColumn(i + 1).width = w));
}

function agregarFila(hoja: ExcelJS.Worksheet, x: RenglonFactura) {
  const precioIva = x.precioConIva != null && x.precioSinIva != null ? Math.round((x.precioConIva - x.precioSinIva) * 100) / 100 : null;
  hoja.addRow([x.modelo, x.codigoSat, x.descripcion, x.pares, x.precioSinIva, precioIva, x.precioConIva, x.importeSinIva, x.iva, x.total]);
}
