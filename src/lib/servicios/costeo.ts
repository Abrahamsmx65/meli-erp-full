/**
 * Costeo real por contenedor: junta las fuentes y lo deja MASTICADO en
 * `app_cache` (clave `finanzas:costeo`); la pantalla lee un renglón.
 *
 *   - Sheet de CUENTAS del dueño (`CUENTAS_SHEET_URL`), SOLO LECTURA: se baja
 *     con el enlace público de exportación, que no puede escribir. Regla del
 *     dueño: «ese sheet no puedes modificar nada jamás».
 *   - Sheet «Números» (`NUMEROS_SHEET_URL`): solo el CBM por par de respaldo.
 *   - El Excel de costeo de la fábrica, que el dueño sube en la pantalla y
 *     se guarda ya leído (`finanzas:costeo-excel`).
 *   - Los packing lists del ERP para lo que no esté en ese Excel.
 *
 * Ver el motor en `finanzas/costeo.ts`.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { leerHoja, type Filas } from "../importar/leer-hoja";
import {
  costearContenedor,
  costosPorModelo,
  idContenedor,
  leerCbmPorPar,
  leerComisiones,
  leerCostingGetac,
  leerExcelCosteo,
  ordenContenedor,
  type ContenedorCosteado,
  type CostoModelo,
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

export const URL_CUENTAS_OMISION =
  "https://docs.google.com/spreadsheets/d/1-GwdeIj8Y1_fDr5WqA3TcYMAIzEOc0TOPvmwxUQFoUk/edit";
export const URL_NUMEROS_OMISION =
  "https://docs.google.com/spreadsheets/d/1fQKU0lwxvcqjhBH4hlF9gk2tzo8X04fdq7KKRDP_wzA/edit";

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

export interface ResultadoCosteo {
  generadoEn: string;
  contenedores: ContenedorCosteado[];
  modelos: CostoModeloVista[];
  fuentes: {
    cuentas: { ok: boolean; error: string | null; contenedores: number };
    numeros: { ok: boolean; error: string | null; modelos: number };
    excel: { nombre: string; subidoEn: string; contenedores: number } | null;
    packing: number;
  };
  avisos: string[];
}

function limpiarUrl(env: string | undefined, omision: string): string {
  return (env ?? "").trim().replace(/^["']+|["']+$/g, "") || omision;
}

/** De la URL del navegador a la descarga del libro completo en .xlsx. */
export function urlXlsxSheets(url: string): string {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error("No parece una URL de Google Sheets (docs.google.com/spreadsheets/d/…).");
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
}

async function bajarLibro(url: string): Promise<Buffer> {
  // Solo GET de exportación: este camino NO puede escribir en el sheet.
  const r = await fetch(urlXlsxSheets(url), { redirect: "follow", cache: "no-store" });
  if (!r.ok) {
    throw new Error(
      r.status === 401 || r.status === 403
        ? "El sheet no está compartido como «Cualquier persona con el enlace · Lector»."
        : `Google contestó ${r.status}.`,
    );
  }
  const tipo = r.headers.get("content-type") ?? "";
  if (tipo.includes("text/html")) throw new Error("Google devolvió una página en vez del archivo (¿sheet privado?).");
  return Buffer.from(await r.arrayBuffer());
}

async function pestana(libro: Buffer, hoja: string): Promise<Filas> {
  return leerHoja(libro, { hoja });
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

/** Lo que traía cada contenedor según los packing lists del ERP (con medidas = CBM). */
async function detallesDelErp(db: DB, accountId: string): Promise<{ porId: Map<string, DetalleContenedor>; porIso: Map<string, DetalleContenedor> }> {
  const contenedores = await traerTodo<any>(db, "contenedores", "id, numero, numero_naviera, estado", (q) =>
    q.eq("account_id", accountId),
  );
  const porId = new Map<string, DetalleContenedor>();
  const porIso = new Map<string, DetalleContenedor>();
  if (!contenedores.length) return { porId, porIso };
  const ids = contenedores.map((c) => c.id);
  const lineas = await traerTodo<any>(
    db,
    "contenedor_lineas",
    "id, contenedor_id, cajas, largo_cm, ancho_cm, alto_cm, pedido_lineas(modelo, pares_por_caja, precio_unitario, pedidos(pedido))",
    (q) => q.in("contenedor_id", ids),
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
      // La moneda del pedido no es de fiar (dice RMB y trae USD): este
      // precio solo sirve como PROPORCIÓN entre modelos del mismo contenedor.
      usdPar: Number.isFinite(precio) && precio > 0 ? precio : null,
      cbm,
    });
    porContenedor.set(l.contenedor_id, arr);
  }
  for (const c of contenedores) {
    const lin = porContenedor.get(c.id);
    if (!lin?.length) continue;
    const id = idContenedor(c.numero);
    const det: DetalleContenedor = {
      id: id?.id ?? String(c.numero),
      anio: id?.anio ?? null,
      iso: c.numero_naviera ? String(c.numero_naviera).toUpperCase() : null,
      fuente: "packing",
      lineas: lin,
    };
    if (id) porId.set(id.id, det);
    for (const iso of [c.numero_naviera, c.numero]) {
      if (iso && /^[A-Z]{4}\d{7}$/i.test(String(iso))) porIso.set(String(iso).toUpperCase(), det);
    }
  }
  return { porId, porIso };
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

/** Recalcula todo y lo guarda. `db` debe poder leer todas las tablas (admin). */
export async function recalcularCosteo(db: DB, accountId: string): Promise<ResultadoCosteo> {
  const t0 = Date.now();
  const avisos: string[] = [];
  const fuentes: ResultadoCosteo["fuentes"] = {
    cuentas: { ok: false, error: null, contenedores: 0 },
    numeros: { ok: false, error: null, modelos: 0 },
    excel: null,
    packing: 0,
  };

  let pagos: ReturnType<typeof leerCostingGetac> = [];
  let comisiones = new Map<string, number>();
  try {
    const libro = await bajarLibro(limpiarUrl(process.env.CUENTAS_SHEET_URL, URL_CUENTAS_OMISION));
    pagos = leerCostingGetac(await pestana(libro, "COSTING GETAC"));
    try {
      comisiones = leerComisiones(await pestana(libro, "COMISSION JOANNE"));
    } catch {
      avisos.push("No encontré la pestaña «COMISSION JOANNE»: los contenedores van sin comisión.");
    }
    fuentes.cuentas = { ok: true, error: null, contenedores: pagos.length };
  } catch (err) {
    fuentes.cuentas.error = (err as Error).message;
  }

  let cbmPorPar = new Map<string, number>();
  try {
    const libro = await bajarLibro(limpiarUrl(process.env.NUMEROS_SHEET_URL, URL_NUMEROS_OMISION));
    cbmPorPar = leerCbmPorPar(await pestana(libro, "CALZADO"));
    fuentes.numeros = { ok: true, error: null, modelos: cbmPorPar.size };
  } catch (err) {
    fuentes.numeros.error = (err as Error).message;
  }

  const excel = await leerCacheAppGuardado<ExcelCosteoGuardado>(db, accountId, CLAVE_COSTEO_EXCEL);
  const delExcel = new Map<string, DetalleContenedor>();
  if (excel.estado === "encontrado") {
    const e = excel.valor.datos;
    for (const d of e.contenedores) if (!delExcel.has(d.id)) delExcel.set(d.id, d);
    fuentes.excel = { nombre: e.nombre, subidoEn: e.subidoEn, contenedores: e.contenedores.length };
  }

  let erp: Awaited<ReturnType<typeof detallesDelErp>> = { porId: new Map(), porIso: new Map() };
  try {
    erp = await detallesDelErp(db, accountId);
  } catch (err) {
    avisos.push(`No se pudieron leer los packing lists del ERP: ${(err as Error).message}`);
  }

  // El Excel de costeo manda (el dueño lo cuadra a mano); el packing list
  // del ERP cubre lo que el Excel no tenga.
  const contenedores = pagos.map((p) => {
    let det = delExcel.get(p.id) ?? null;
    if (!det) {
      det = erp.porId.get(p.id) ?? (p.iso ? erp.porIso.get(p.iso) ?? null : null);
      if (det) fuentes.packing++;
    }
    return costearContenedor(p, det, cbmPorPar, comisiones.get(p.id) ?? 0);
  });
  contenedores.sort(ordenContenedor);

  const existencias = await existenciasPorModelo(db, accountId, avisos);
  const config = await configPorProducto(db, accountId).catch(() => new Map());
  const modelos: CostoModeloVista[] = costosPorModelo(contenedores, existencias).map((m) => {
    const cfg = config.get(m.modelo) ?? null;
    return { ...m, categoria: cfg?.categoria ?? null, costoActual: cfg?.costo ?? null };
  });

  const resultado: ResultadoCosteo = {
    generadoEn: new Date().toISOString(),
    contenedores,
    modelos,
    fuentes,
    avisos,
  };
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
