/**
 * Costos desde un Excel con número de modelo y costo.
 *
 * Dos columnas es todo lo que hace falta: la clave del modelo (el número
 * de diseño, tal como se conoce en el negocio) y su costo en MXN. Se leen
 * por nombre de encabezado, así que el archivo puede traer más columnas o
 * renglones de título arriba.
 *
 * El costo se guarda con la clave canónica y se busca por el diseño del
 * SKU: "499-IP15PM" cuesta lo que diga el renglón "499".
 */
import { leerHoja as leerCeldas } from "../importar/leer-hoja";
import { canonizar, claveCanonica, desglosar } from "./sku";

export interface FilaCosto {
  modelo: string;
  etiqueta: string;
  costo: number;
}

export interface ResultadoCostos {
  filas: FilaCosto[];
  avisos: string[];
}

const ENC_MODELO = ["MODELO", "MODELOS", "DISENO", "DISEÑO", "CLAVE", "SKU", "NUMERO", "NO", "NUM", "CODIGO"];
/** Encabezados que SIEMPRE son costo por unidad. */
const ENC_UNITARIO = ["COSTO UNITARIO", "PRECIO UNITARIO", "UNITARIO", "VALOR", "VALOR UNITARIO", "COSTO MXN", "COSTO UNIT"];
/** Encabezados que son costo por unidad… salvo que al lado haya CANTIDAD: ahí es el total. */
const ENC_COSTO = ["COSTO", "COSTOS", "PRECIO"];
const ENC_CANTIDAD = ["CANTIDAD", "CANT", "UNIDADES", "PIEZAS", "EXISTENCIA", "EXISTENCIAS", "STOCK"];

function numero(s: string): number | null {
  const limpio = String(s ?? "").replace(/[$,\s]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

function es(celda: string, opciones: string[]): boolean {
  const k = canonizar(celda);
  return opciones.some((e) => k === canonizar(e));
}

/**
 * Encuentra las columnas de modelo y costo.
 *
 * La pestaña TOTALES del sheet de inventario trae `| CANTIDAD | VALOR | COSTO`
 * con el modelo en la primera columna SIN encabezado: ahí VALOR es el costo
 * por unidad y COSTO es cantidad × valor. Por eso, cuando hay una columna de
 * cantidad, se prefiere la unitaria; y si no hay encabezado de modelo, se
 * toma la primera columna a la izquierda del costo.
 */
function encontrarColumnas(celdas: string[][]): { fila: number; modelo: number; costo: number } | null {
  for (let r = 0; r < Math.min(celdas.length, 15); r++) {
    const f = celdas[r] ?? [];
    let modelo = -1;
    let unitario = -1;
    let costo = -1;
    let cantidad = -1;
    f.forEach((celda, i) => {
      if (!celda) return;
      if (modelo < 0 && es(celda, ENC_MODELO)) modelo = i;
      else if (unitario < 0 && es(celda, ENC_UNITARIO)) unitario = i;
      else if (costo < 0 && es(celda, ENC_COSTO)) costo = i;
      else if (cantidad < 0 && es(celda, ENC_CANTIDAD)) cantidad = i;
    });
    const colCosto = unitario >= 0 && (cantidad >= 0 || costo < 0) ? unitario : costo >= 0 ? costo : unitario;
    if (colCosto < 0) continue;
    if (modelo < 0) {
      // Sin encabezado de modelo: la primera columna vacía o de texto a la izquierda.
      modelo = 0;
      for (let c = 0; c < colCosto; c++) {
        if (!f[c] || (!es(f[c], ENC_UNITARIO) && !es(f[c], ENC_COSTO) && !es(f[c], ENC_CANTIDAD))) {
          modelo = c;
          break;
        }
      }
      if (modelo === colCosto) continue;
    }
    return { fila: r, modelo, costo: colCosto };
  }
  return null;
}

export function leerCostosDeCeldas(celdas: string[][]): ResultadoCostos {
  const enc = encontrarColumnas(celdas);
  // Sin encabezados reconocibles: la forma más simple, dos columnas (modelo, costo).
  const colModelo = enc?.modelo ?? 0;
  const colCosto = enc?.costo ?? 1;
  const filaEnc = enc?.fila ?? -1;

  const filas: FilaCosto[] = [];
  const avisos: string[] = [];
  const vistos = new Set<string>();

  for (let r = filaEnc + 1; r < celdas.length; r++) {
    const f = celdas[r] ?? [];
    const etiqueta = (f[colModelo] ?? "").trim();
    const costoTxt = f[colCosto] ?? "";
    if (!etiqueta) continue;
    if (/^total/i.test(etiqueta)) continue;
    const costo = numero(costoTxt);
    if (costo == null) {
      if (costoTxt.trim()) avisos.push(`Fila ${r + 1}: "${etiqueta}" con costo no numérico "${costoTxt}".`);
      continue;
    }
    if (costo <= 0) continue;
    const modelo = claveCanonica(etiqueta);
    if (!modelo) continue;
    if (vistos.has(modelo)) {
      avisos.push(`Fila ${r + 1}: "${etiqueta}" repetido; se usa el último.`);
      const i = filas.findIndex((x) => x.modelo === modelo);
      if (i >= 0) filas[i] = { modelo, etiqueta, costo };
      continue;
    }
    vistos.add(modelo);
    filas.push({ modelo, etiqueta, costo });
  }

  if (!filas.length) {
    throw new Error("No se encontró ningún renglón con modelo y costo. Se esperan dos columnas: MODELO y COSTO (o la pestaña TOTALES del sheet de inventario).");
  }
  return { filas, avisos };
}

/**
 * Lee el Excel de costos (MODELO, COSTO).
 *
 * El sheet de inventario trae una pestaña TOTALES con valores por diseño,
 * pero la operación decidió que de ahí NO se toma información: los costos
 * viven en su propio Excel. Si llega ese archivo por error, se rechaza en
 * vez de leerlo a medias.
 */
export async function leerCostos(buffer: ArrayBuffer | Buffer, nombre?: string): Promise<ResultadoCostos> {
  const primeraHoja = await nombrePrimeraHoja(buffer);
  if (primeraHoja && /TOTAL/i.test(primeraHoja)) {
    throw new Error(
      `La primera pestaña del archivo se llama "${primeraHoja}": parece el sheet de inventario. Los costos van en un Excel aparte con dos columnas, MODELO y COSTO.`,
    );
  }
  const celdas = await leerCeldas(buffer, { nombre });
  return leerCostosDeCeldas(celdas);
}

async function nombrePrimeraHoja(buffer: ArrayBuffer | Buffer): Promise<string | null> {
  try {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);
    return wb.worksheets[0]?.name ?? null;
  } catch {
    return null; // .xls o .csv: no hay nombres de hoja que revisar
  }
}

/**
 * El costo de un SKU de MELI: primero por su clave completa, luego por su
 * diseño. Devuelve null cuando no hay dato (nunca 0, que parecería gratis).
 */
export function costoDeSku(sku: string, costos: Map<string, number>): number | null {
  const completa = costos.get(claveCanonica(sku));
  if (completa != null) return completa;
  const d = desglosar(sku);
  const porDiseno = costos.get(d.diseno);
  if (porDiseno != null) return porDiseno;
  // La N o la C de más también se cuela en el Excel de costos: "499N".
  const sinLetra = d.diseno.replace(/[A-Z]$/, "");
  if (sinLetra !== d.diseno) {
    const v = costos.get(sinLetra);
    if (v != null) return v;
  }
  return null;
}
