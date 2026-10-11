/**
 * Costeo real por contenedor: junta lo capturado en el ERP y lo deja
 * MASTICADO en `app_cache` (clave `finanzas:costeo`); la pantalla lee un
 * renglón.
 *
 *   - `costeo_contenedores` + `costeo_pagos`: lo pagado (factura y flete en
 *     USD con los tipos de cambio de cada pago, aduana en pesos, entregado).
 *     Se importaron UNA vez del sheet COSTING GETAC del dueño el
 *     11-oct-2026; desde ahí se capturan aquí y el sheet ya no se lee.
 *   - El Excel de costeo de la fábrica, que el dueño sube en la pantalla y
 *     se guarda ya leído (`finanzas:costeo-excel`).
 *   - Los packing lists del ERP para lo que no esté en ese Excel, y su
 *     estado: un contenedor RECIBIDO en el ERP cuenta como entregado.
 *
 * Ver el motor en `finanzas/costeo.ts`.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { leerHoja } from "../importar/leer-hoja";
import {
  costearContenedor,
  costosPorModelo,
  esIsoContenedor,
  idContenedor,
  leerExcelCosteo,
  ordenContenedor,
  type ContenedorCosteado,
  type CostoModelo,
  type DatosContenedor,
  type DetalleContenedor,
  type LineaCosteo,
} from "../finanzas/costeo";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { cargarInventario } from "./inventario";
import { configPorProducto } from "./productos";
import { modeloUnificado } from "./costos-unificados";

export const CLAVE_COSTEO = "finanzas:costeo";
export const CLAVE_COSTEO_EXCEL = "finanzas:costeo-excel";
/** La pantalla pide un recálculo en el fondo si lo guardado es más viejo. */
export const EDAD_COSTEO_MS = 6 * 3_600_000;

export interface ExcelCosteoGuardado {
  nombre: string;
  subidoEn: string;
  contenedores: DetalleContenedor[];
}

export interface CostoModeloVista extends CostoModelo {
  categoria: string | null;
  /** el costo que hoy usan los cortes (Catálogo y costos) */
  costoActual: number | null;
}

export interface PagoGuardado {
  id: number;
  contenedor: string;
  concepto: "fabrica" | "flete";
  fecha: string | null;
  usd: number;
  tipoCambio: number;
  notas: string | null;
}

export interface ContenedorVista extends ContenedorCosteado {
  /** ya tiene renglón capturado en costeo_contenedores */
  capturado: boolean;
  fechaEntrega: string | null;
  /** el estado del contenedor en /contenedores, si existe ahí */
  estadoErp: string | null;
  pagos: PagoGuardado[];
}

export interface ResultadoCosteo {
  generadoEn: string;
  contenedores: ContenedorVista[];
  modelos: CostoModeloVista[];
  excel: { nombre: string; subidoEn: string; contenedores: number } | null;
  avisos: string[];
}

/** Lee el Excel de costeo que sube el dueño y lo guarda ya leído. */
export async function guardarExcelCosteo(
  db: DB,
  accountId: string,
  archivo: Buffer,
  nombre: string,
): Promise<ExcelCosteoGuardado> {
  const contenedores = leerExcelCosteo(await leerHoja(archivo, { nombre }));
  if (!contenedores.length) {
    throw new Error("No encontré contenedores en el archivo (se esperan bloques «Invoice | Style | Qtys…» con S###-AAAA).");
  }
  const guardado: ExcelCosteoGuardado = { nombre, subidoEn: new Date().toISOString(), contenedores };
  await guardarCacheApp(db, accountId, CLAVE_COSTEO_EXCEL, guardado, 0);
  return guardado;
}

interface ContenedorErp {
  id: string | null;
  anio: number | null;
  isos: string[];
  estado: string;
  detalle: DetalleContenedor | null;
}

/** Los contenedores del ERP con lo que traían según su packing list (medidas → CBM). */
async function contenedoresDelErp(db: DB, accountId: string): Promise<ContenedorErp[]> {
  const contenedores = await traerTodo<any>(db, "contenedores", "id, numero, numero_naviera, estado", (q) =>
    q.eq("account_id", accountId),
  );
  if (!contenedores.length) return [];
  const lineas = await traerTodo<any>(
    db,
    "contenedor_lineas",
    "id, contenedor_id, cajas, largo_cm, ancho_cm, alto_cm, pedido_lineas(modelo, pares_por_caja, precio_unitario, pedidos(pedido))",
    (q) => q.in("contenedor_id", contenedores.map((c) => c.id)),
  );
  const porContenedor = new Map<string, LineaCosteo[]>();
  for (const l of lineas) {
    const pl = l.pedido_lineas;
    const pares = Number(l.cajas ?? 0) * Number(pl?.pares_por_caja ?? 0);
    if (!pl?.modelo || pares <= 0) continue;
    const medidas = [l.largo_cm, l.ancho_cm, l.alto_cm].map(Number);
    const cbm = medidas.every((x) => Number.isFinite(x) && x > 0)
      ? (Number(l.cajas) * medidas[0] * medidas[1] * medidas[2]) / 1e6
      : null;
    const precio = Number(pl.precio_unitario);
    const arr = porContenedor.get(l.contenedor_id) ?? [];
    arr.push({
      modelo: modeloUnificado(String(pl.modelo)) || String(pl.modelo).toUpperCase(),
      pedido: pl.pedidos?.pedido ?? null,
      pares,
      // La moneda del pedido no es de fiar (dice RMB y a veces trae USD):
      // este precio solo reparte la factura entre modelos del contenedor.
      usdPar: Number.isFinite(precio) && precio > 0 ? precio : null,
      cbm,
    });
    porContenedor.set(l.contenedor_id, arr);
  }
  return contenedores.map((c) => {
    const id = idContenedor(c.numero);
    const isos = [c.numero_naviera, c.numero]
      .filter((x) => x && esIsoContenedor(x))
      .map((x) => String(x).toUpperCase());
    const lin = porContenedor.get(c.id);
    return {
      id: id?.id ?? null,
      anio: id?.anio ?? null,
      isos,
      estado: String(c.estado ?? ""),
      detalle: lin?.length
        ? { id: id?.id ?? String(c.numero), anio: id?.anio ?? null, iso: isos[0] ?? null, fuente: "packing", lineas: lin }
        : null,
    };
  });
}

/** Pares que hay HOY por modelo: Full + transferencias + bodega, TikTok y FBA. */
async function existenciasPorModelo(db: DB, accountId: string, avisos: string[]): Promise<Map<string, number> | null> {
  const r = new Map<string, number>();
  const sumar = (sku: string, n: number) => {
    const m = modeloUnificado(sku);
    if (!m || !Number.isFinite(n) || n <= 0) return;
    r.set(m, (r.get(m) ?? 0) + n);
  };
  try {
    const inv = await cargarInventario(db, accountId, { sinCrudos: true });
    for (const x of inv.renglones) sumar(x.sku, x.enFull + x.enTransferencia + x.enBodega);
  } catch (err) {
    avisos.push(`No se pudo leer el inventario (${(err as Error).message}): el costo real se toma del último contenedor.`);
    return null;
  }
  try {
    const tt = await traerTodo<any>(db, "tiktok_inventario", "account_id, sku, saldo", (q) => q.gt("saldo", 0));
    for (const x of tt) sumar(x.sku, Number(x.saldo));
  } catch (err) {
    avisos.push(`No se pudo leer la bodega de TikTok: ${(err as Error).message}`);
  }
  try {
    const fba = await traerTodo<any>(db, "amazon_inventario", "account_id, seller_sku, total", (q) => q.gt("total", 0));
    for (const x of fba) sumar(x.seller_sku, Number(x.total));
  } catch (err) {
    avisos.push(`No se pudo leer el inventario de FBA: ${(err as Error).message}`);
  }
  return r;
}

const num = (x: unknown): number | null => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));

/** Recalcula todo y lo guarda. `db` debe poder leer todas las tablas (admin). */
export async function recalcularCosteo(db: DB, accountId: string): Promise<ResultadoCosteo> {
  const t0 = Date.now();
  const avisos: string[] = [];

  const [capturados, pagosCrudos, excel, erp] = await Promise.all([
    traerTodo<any>(
      db,
      "costeo_contenedores",
      "contenedor, anio, iso, productos, costo_usd, flete_usd, aduana_mxn, entregado, fecha_entrega, notas, negocio, comision_agente, ejercicio",
      (q) => q.eq("account_id", accountId),
    ),
    traerTodo<any>(db, "costeo_pagos", "id, contenedor, concepto, fecha, usd, tipo_cambio, notas", (q) =>
      q.eq("account_id", accountId),
    ),
    leerCacheAppGuardado<ExcelCosteoGuardado>(db, accountId, CLAVE_COSTEO_EXCEL),
    contenedoresDelErp(db, accountId).catch((err) => {
      avisos.push(`No se pudieron leer los contenedores del ERP: ${(err as Error).message}`);
      return [] as ContenedorErp[];
    }),
  ]);

  const delExcel = new Map<string, DetalleContenedor>();
  let excelInfo: ResultadoCosteo["excel"] = null;
  if (excel.estado === "encontrado") {
    const e = excel.valor.datos;
    for (const d of e.contenedores) if (!delExcel.has(d.id)) delExcel.set(d.id, d);
    excelInfo = { nombre: e.nombre, subidoEn: e.subidoEn, contenedores: e.contenedores.length };
  }

  const capturadoPorId = new Map<string, any>(capturados.map((c) => [c.contenedor, c]));
  const pagos: PagoGuardado[] = pagosCrudos
    .map((p) => ({
      id: Number(p.id),
      contenedor: p.contenedor,
      concepto: p.concepto,
      fecha: p.fecha,
      usd: Number(p.usd),
      tipoCambio: Number(p.tipo_cambio),
      notas: p.notas,
    }))
    .sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "") || a.id - b.id);

  // El contenedor del ERP se reconoce por su número S### o por su ISO.
  const isoAId = new Map<string, string>();
  for (const c of capturados) if (c.iso) isoAId.set(String(c.iso).toUpperCase(), c.contenedor);
  for (const d of delExcel.values()) if (d.iso) isoAId.set(d.iso, d.id);
  const erpPorId = new Map<string, ContenedorErp>();
  for (const c of erp) {
    const id = c.id ?? c.isos.map((i) => isoAId.get(i)).find(Boolean) ?? null;
    if (id && !erpPorId.has(id)) erpPorId.set(id, c);
  }

  const ids = new Set<string>([...capturadoPorId.keys(), ...delExcel.keys(), ...erpPorId.keys()]);
  const contenedores: ContenedorVista[] = [...ids].map((id) => {
    const cap = capturadoPorId.get(id);
    const deErp = erpPorId.get(id) ?? null;
    const det = delExcel.get(id) ?? deErp?.detalle ?? null;
    const susPagos = pagos.filter((p) => p.contenedor === id);
    const datos: DatosContenedor = {
      id,
      negocio: cap?.negocio === "fundas" || id.startsWith("P") ? "fundas" : "calzado",
      comisionAgente: num(cap?.comision_agente),
      ejercicio: num(cap?.ejercicio),
      anio: num(cap?.anio) ?? det?.anio ?? deErp?.anio ?? null,
      iso: cap?.iso ?? det?.iso ?? deErp?.isos[0] ?? null,
      productos: cap?.productos ?? [...new Set((det?.lineas ?? []).map((l) => l.modelo))].join(" "),
      costoUsd: num(cap?.costo_usd),
      fleteUsd: num(cap?.flete_usd),
      aduana: num(cap?.aduana_mxn),
      // Entregado: lo marcó el dueño aquí o el contenedor ya está RECIBIDO en el ERP.
      entregado: Boolean(cap?.entregado) || deErp?.estado === "recibido",
      pagosFabrica: susPagos.filter((p) => p.concepto === "fabrica"),
      pagosFlete: susPagos.filter((p) => p.concepto === "flete"),
      notas: cap?.notas ?? null,
    };
    return {
      ...costearContenedor(datos, det),
      capturado: Boolean(cap),
      fechaEntrega: cap?.fecha_entrega ?? null,
      estadoErp: deErp?.estado ?? null,
      pagos: susPagos,
    };
  });
  contenedores.sort(ordenContenedor);

  const existencias = await existenciasPorModelo(db, accountId, avisos);
  const config = await configPorProducto(db, accountId).catch(() => new Map());
  const modelos: CostoModeloVista[] = costosPorModelo(contenedores, existencias).map((m) => {
    const cfg = config.get(m.modelo) ?? null;
    return { ...m, categoria: cfg?.categoria ?? null, costoActual: cfg?.costo ?? null };
  });

  const resultado: ResultadoCosteo = { generadoEn: new Date().toISOString(), contenedores, modelos, excel: excelInfo, avisos };
  await guardarCacheApp(db, accountId, CLAVE_COSTEO, resultado, Date.now() - t0);
  return resultado;
}

/**
 * Pasa el costo real a Catálogo y costos (la fuente que usan TODOS los
 * cortes). Solo el costo: la categoría se queda. Los modelos sin costo real
 * no se tocan.
 */
export async function aplicarCostosReales(
  db: DB,
  accountId: string,
  modelos: string[] | null,
): Promise<{ aplicados: number; modelos: string[] }> {
  const guardado = await leerCacheAppGuardado<ResultadoCosteo>(db, accountId, CLAVE_COSTEO);
  if (guardado.estado !== "encontrado") throw new Error("Todavía no hay costeo calculado.");
  const quiero = modelos ? new Set(modelos.map((m) => m.toUpperCase())) : null;
  const elegidos = guardado.valor.datos.modelos.filter(
    (m) => m.real != null && m.real > 0 && (!quiero || quiero.has(m.modelo)),
  );
  const aplicados: string[] = [];
  const ahora = new Date().toISOString();
  for (const m of elegidos) {
    const costo = Math.round(m.real! * 100) / 100;
    const { data, error } = await db
      .from("productos_config")
      .update({ costo_mxn: costo, actualizado_en: ahora })
      .eq("account_id", accountId)
      .eq("modelo", m.modelo)
      .eq("color", "")
      .select("modelo");
    if (error) throw new Error(`productos_config: ${error.message}`);
    if (!data?.length) {
      const { error: e2 } = await db.from("productos_config").insert({
        account_id: accountId,
        modelo: m.modelo,
        color: "",
        categoria: m.categoria,
        costo_mxn: costo,
        actualizado_en: ahora,
      });
      if (e2) throw new Error(`productos_config: ${e2.message}`);
    }
    aplicados.push(m.modelo);
  }
  // Que la pantalla enseñe el costo nuevo como «actual» sin esperar al fondo.
  const datos = guardado.valor.datos;
  const hechos = new Set(aplicados);
  for (const m of datos.modelos) if (hechos.has(m.modelo)) m.costoActual = Math.round(m.real! * 100) / 100;
  await guardarCacheApp(db, accountId, CLAVE_COSTEO, datos, 0);
  return { aplicados: aplicados.length, modelos: aplicados };
}

// ------------------------------------------------------- captura del dueño

export interface CambioContenedor {
  contenedor: string;
  iso?: string | null;
  productos?: string | null;
  costoUsd?: number | null;
  fleteUsd?: number | null;
  aduana?: number | null;
  comisionAgente?: number | null;
  ejercicio?: number | null;
  entregado?: boolean;
  fechaEntrega?: string | null;
  notas?: string | null;
}

/** Normaliza "S258-2026" → "S258"; error si no es un contenedor. */
export function contenedorValido(texto: unknown): string {
  const id = idContenedor(texto);
  if (!id) throw new Error("El contenedor debe ser S### (calzado, por ejemplo S272) o P### (fundas, por ejemplo P609).");
  return id.id;
}

const montoONulo = (x: unknown): number | null => {
  if (x == null || x === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) throw new Error("Los montos deben ser números positivos.");
  return n;
};

export async function guardarContenedor(db: DB, accountId: string, c: CambioContenedor): Promise<void> {
  const contenedor = contenedorValido(c.contenedor);
  const fila: Record<string, unknown> = { account_id: accountId, contenedor, actualizado_en: new Date().toISOString() };
  if ("iso" in c) fila.iso = c.iso ? String(c.iso).trim().toUpperCase() : null;
  if ("productos" in c) fila.productos = c.productos ? String(c.productos).trim() : null;
  if ("costoUsd" in c) fila.costo_usd = montoONulo(c.costoUsd);
  if ("fleteUsd" in c) fila.flete_usd = montoONulo(c.fleteUsd);
  if ("aduana" in c) fila.aduana_mxn = montoONulo(c.aduana);
  if ("comisionAgente" in c) fila.comision_agente = montoONulo(c.comisionAgente);
  if ("ejercicio" in c && c.ejercicio != null && String(c.ejercicio) !== "") {
    const e = Number(c.ejercicio);
    if (!Number.isInteger(e) || e < 2020 || e > 2100) throw new Error("La cuenta del año es el año en que empieza (por ejemplo 2026).");
    fila.ejercicio = e;
  }
  // El negocio sale del número: P### son fundas.
  fila.negocio = contenedor.startsWith("P") ? "fundas" : "calzado";
  if ("entregado" in c) fila.entregado = Boolean(c.entregado);
  if ("fechaEntrega" in c) fila.fecha_entrega = c.fechaEntrega || null;
  if ("notas" in c) fila.notas = c.notas ? String(c.notas).trim() : null;
  const { error } = await db.from("costeo_contenedores").upsert(fila, { onConflict: "account_id,contenedor" });
  if (error) throw new Error(`costeo_contenedores: ${error.message}`);
}

export async function agregarPago(
  db: DB,
  accountId: string,
  p: { contenedor: string; concepto: string; fecha?: string | null; usd: number; tipoCambio: number; notas?: string | null },
): Promise<void> {
  const contenedor = contenedorValido(p.contenedor);
  if (p.concepto !== "fabrica" && p.concepto !== "flete") throw new Error("El pago es de fábrica o de flete.");
  const usd = Number(p.usd);
  const tc = Number(p.tipoCambio);
  if (!(usd > 0)) throw new Error("Los USD del pago deben ser mayores a cero.");
  if (!(tc > 5 && tc < 50)) throw new Error("El tipo de cambio no se ve bien (pesos por dólar).");
  // El contenedor tiene que existir para que el pago no quede huérfano.
  await db
    .from("costeo_contenedores")
    .upsert({ account_id: accountId, contenedor }, { onConflict: "account_id,contenedor", ignoreDuplicates: true });
  const { error } = await db.from("costeo_pagos").insert({
    account_id: accountId,
    contenedor,
    concepto: p.concepto,
    fecha: p.fecha || null,
    usd,
    tipo_cambio: tc,
    notas: p.notas ? String(p.notas).trim() : null,
  });
  if (error) throw new Error(`costeo_pagos: ${error.message}`);
}

export async function borrarPago(db: DB, accountId: string, id: number): Promise<void> {
  const { error } = await db.from("costeo_pagos").delete().eq("account_id", accountId).eq("id", id);
  if (error) throw new Error(`costeo_pagos: ${error.message}`);
}
