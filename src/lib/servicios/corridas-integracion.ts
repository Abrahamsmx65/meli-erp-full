/**
 * Las corridas de la sección Corridas, en el FORMATO DE INDUSTHER
 * (`GET /api/integracion/corridas`; dueño, 21 y 22-oct-2026: «que Industher
 * jale nuestra información, solo lo de las corridas», «este es el formato
 * que ocupa en su sistema»; calcado de su archivo 686_19.xlsx):
 *
 *   PEDIDO | MODELO | COLOR | 23 | 24 | … | 30 | TOTAL
 *
 * Un renglón = la receta de UNA caja: pares por talla («-» si la talla no
 * viene) y TOTAL = pares por caja. El ERP NO le escribe a Industher: su
 * sistema pide y el ERP contesta.
 *
 * El COLOR es el mismo que lleva el Sku del archivo del contenedor
 * (`skuMeliDeCaja`: el color de MELI; sin variante en MELI, el del pedido),
 * para que PEDIDO-MODELO-COLOR de la corrida sea el Sku de la caja. La caja
 * de una sola talla lleva la talla pegada al color («TABACO BROWN-25»), igual
 * que su Sku y que la guarda el ERP.
 */
import ExcelJS from "exceljs";
import { skuMeliDeCaja } from "./bodega-contenedor";

export interface FilaCorrida {
  pedido: string;
  modelo: string;
  color: string;
  tallas: Record<string, unknown> | null;
  total: number | null;
  origen: string | null;
  actualizado_en: string | null;
}

export interface CorridaSeparada {
  pedido: string;
  modelo: string;
  /** el color sin la talla pegada */
  color: string;
  /** la talla de la caja unitalla; null en una caja de corrida */
  talla: string | null;
  tallas: Record<string, number>;
  paresPorCaja: number;
  /** como la guarda el ERP: "IN10121|GT114|TABACO BROWN-25" */
  clave: string;
}

function tallasLimpias(tallas: Record<string, unknown> | null): Record<string, number> {
  const fuera: Record<string, number> = {};
  for (const [t, v] of Object.entries(tallas ?? {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) fuera[String(t).trim()] = n;
  }
  return fuera;
}

/** Separa la talla pegada al color de la caja unitalla («BLK-24» → BLK + 24). */
export function separarCorrida(f: FilaCorrida): CorridaSeparada {
  const tallas = tallasLimpias(f.tallas);
  const llaves = Object.keys(tallas);
  const pedido = String(f.pedido ?? "").trim();
  const modelo = String(f.modelo ?? "").trim();
  const guardado = String(f.color ?? "").trim();
  let color = guardado;
  let talla: string | null = null;
  if (llaves.length === 1) {
    const sufijo = `-${llaves[0]}`;
    if (guardado.toUpperCase().endsWith(sufijo.toUpperCase()) && guardado.length > sufijo.length) {
      color = guardado.slice(0, -sufijo.length).trim();
      talla = llaves[0];
    }
  }
  const paresPorCaja = Object.values(tallas).reduce((s, n) => s + n, 0) || Number(f.total ?? 0) || 0;
  return { pedido, modelo, color, talla, tallas, paresPorCaja, clave: `${pedido}|${modelo}|${guardado}` };
}

/** El color tal como queda en el Sku de la caja: lo que sigue a «PEDIDO-MODELO-». */
export function colorDelSku(sku: string, pedido: string, modelo: string): string | null {
  const prefijo = `${pedido}-${modelo}-`.toUpperCase();
  return sku.toUpperCase().startsWith(prefijo) && sku.length > prefijo.length ? sku.slice(prefijo.length) : null;
}

/** El COLOR del renglón: el del Sku de la caja (con su talla si es unitalla). */
export function colorParaIndusther(c: CorridaSeparada, skuMeli: string | null | undefined): string {
  const sku = skuMeliDeCaja(c.pedido, c.modelo, c.color, c.talla, skuMeli);
  return colorDelSku(sku, c.pedido, c.modelo) ?? (c.talla ? `${c.color}-${c.talla}` : c.color);
}

export type CeldaIndusther = string | number | null;

export interface TablaIndusther {
  columnas: string[];
  filas: Record<string, CeldaIndusther>[];
}

const natural = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

/**
 * PEDIDO | MODELO | COLOR | una columna por talla (todas las que aparecen,
 * en orden) | TOTAL. Una talla que la caja no trae va en null (en el Excel,
 * «-», como el archivo de Industher).
 */
export function tablaDeCorridas(corridas: { pedido: string; modelo: string; color: string; tallas: Record<string, number> }[]): TablaIndusther {
  const tallas = [...new Set(corridas.flatMap((c) => Object.keys(c.tallas)))].sort(natural);
  const columnas = ["PEDIDO", "MODELO", "COLOR", ...tallas, "TOTAL"];
  const filas = corridas.map((c) => {
    const fila: Record<string, CeldaIndusther> = { PEDIDO: c.pedido, MODELO: c.modelo, COLOR: c.color };
    for (const t of tallas) fila[t] = c.tallas[t] ?? null;
    fila.TOTAL = Object.values(c.tallas).reduce((s, n) => s + n, 0);
    return fila;
  });
  return { columnas, filas };
}

/** Un Excel calcado del de Industher: una hoja «Sheet1» por tabla (o con el nombre dado), vacío = «-». */
export async function excelIndusther(hojas: { nombre: string; tabla: TablaIndusther; vacio?: string }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const h of hojas) {
    const ws = wb.addWorksheet(h.nombre);
    ws.addRow(h.tabla.columnas);
    for (const f of h.tabla.filas) ws.addRow(h.tabla.columnas.map((c) => f[c] ?? h.vacio ?? null));
    ws.getRow(1).font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Tope por página, igual que el API de inventario de Industher. */
export const LIMITE_CORRIDAS = 1000;

export function leerPaginacion(params: URLSearchParams): { limit: number; offset: number; desde: string | null } | { error: string } {
  const limit = params.has("limit") ? Number(params.get("limit")) : LIMITE_CORRIDAS;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITE_CORRIDAS) return { error: `limit va de 1 a ${LIMITE_CORRIDAS}.` };
  if (!Number.isInteger(offset) || offset < 0) return { error: "offset debe ser un entero ≥ 0." };
  const crudo = params.get("desde");
  let desde: string | null = null;
  if (crudo) {
    const ms = Date.parse(crudo);
    if (!Number.isFinite(ms)) return { error: "desde debe ser una fecha ISO (2026-10-21T00:00:00Z)." };
    desde = new Date(ms).toISOString();
  }
  return { limit, offset, desde };
}
