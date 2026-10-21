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
import type { Cuenta, DB } from "../datos/repos";
import {
  PARAMETROS_CALCULADORA,
  calcularPrecios,
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
import { contenedorDeCuenta, datosDeModelos, renglonesDelContenedor } from "./contenedor-datos";

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

/** Para la pantalla: los contenedores de la cuenta, los más nuevos primero. */
export async function listaContenedores(db: DB, accountId: string): Promise<{ id: string; numero: string; estado: string | null }[]> {
  const { data } = await db
    .from("contenedores")
    .select("id, numero, estado, creado_en")
    .eq("account_id", accountId)
    .order("creado_en", { ascending: false })
    .limit(200);
  return ((data ?? []) as any[]).map((c) => ({ id: c.id, numero: c.numero, estado: c.estado ?? null }));
}

const HOJAS = {
  komerline: { titulo: "Komerline compra a Industher", corto: "KOMERLINE" },
  industher: { titulo: "Industher compra", corto: "INDUSTHER" },
} as const;

/**
 * El Excel para pedir la factura del contenedor: una hoja por cada compra
 * (Komerline a Industher, y la de Industher) con modelo, código SAT, pares,
 * precio por par con y sin IVA, IVA e importe. Lo que no tiene precio o
 * código SAT va en blanco y en la hoja «Avisos»: no se inventa.
 */
export async function excelFacturaContenedor(db: DB, cuenta: Cuenta, contenedorId: string): Promise<{ nombre: string; buffer: Buffer } | null> {
  const contenedor = await contenedorDeCuenta(db, cuenta.id, contenedorId);
  if (!contenedor) return null;
  const renglones = await renglonesDelContenedor(db, contenedor.id);
  const calc = await cargarCalculadora(db, cuenta);
  const precios = new Map(calc.renglones.map((r) => [r.modelo.toUpperCase(), r]));
  const datos = await datosDeModelos(db, cuenta.id, [...new Set(renglones.map((r) => r.modelo))]);
  const datosDe = (modelo: string) => {
    const d = datos.get(modelo);
    return { descripcion: d?.titulo ?? "", codigoSat: codigoFiscalDeCategoria(d?.categoriaMeli) ?? "" };
  };
  const pares = renglones.map((r) => ({ modelo: r.modelo, pares: r.cajas * r.paresPorCaja }));

  const libro = new ExcelJS.Workbook();
  const avisos: string[] = [...calc.avisos];
  for (const tipo of ["komerline", "industher"] as const) {
    const f = facturaDeContenedor(
      pares,
      (m) => {
        const r = precios.get(m.toUpperCase());
        return (tipo === "komerline" ? r?.precioKomerline : r?.precioIndusther) ?? null;
      },
      datosDe,
    );
    const hoja = libro.addWorksheet(HOJAS[tipo].titulo);
    hoja.addRow([`${HOJAS[tipo].titulo} · contenedor ${contenedor.numero}${contenedor.numero_naviera ? ` (${contenedor.numero_naviera})` : ""}`]).font = { bold: true, size: 13 };
    hoja.addRow([`Promedio de ${calc.meses.map(nombreDelPeriodo).join(", ")} · precios con IVA trasladado (16 %)`]);
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
  const nuevos = [...new Set(renglones.map((r) => r.modelo))].filter((m) => relampago.has(m.toUpperCase()));
  if (nuevos.length) avisos.push(`Producto nuevo, calculado con el precio relámpago de Números: ${nuevos.join(", ")}.`);
  if (avisos.length) {
    const h = libro.addWorksheet("Avisos");
    h.getColumn(1).width = 120;
    for (const a of avisos) h.addRow([a]);
  }
  const buffer = Buffer.from(await libro.xlsx.writeBuffer());
  const nombre = `factura-${contenedor.numero.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.xlsx`;
  return { nombre, buffer };
}

function agregarFila(hoja: ExcelJS.Worksheet, x: RenglonFactura) {
  const precioIva = x.precioConIva != null && x.precioSinIva != null ? Math.round((x.precioConIva - x.precioSinIva) * 100) / 100 : null;
  hoja.addRow([x.modelo, x.codigoSat, x.descripcion, x.pares, x.precioSinIva, precioIva, x.precioConIva, x.importeSinIva, x.iva, x.total]);
}
