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
const ENC_COSTO = ["COSTO", "COSTOS", "COSTO UNITARIO", "PRECIO", "PRECIO UNITARIO", "UNITARIO", "MXN", "COSTO MXN"];

function numero(s: string): number | null {
  const limpio = String(s ?? "").replace(/[$,\s]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

export function leerCostosDeCeldas(celdas: string[][]): ResultadoCostos {
  let colModelo = -1;
  let colCosto = -1;
  let filaEnc = -1;

  for (let r = 0; r < Math.min(celdas.length, 15) && filaEnc < 0; r++) {
    const f = celdas[r] ?? [];
    let m = -1;
    let c = -1;
    f.forEach((celda, i) => {
      const k = canonizar(celda);
      if (m < 0 && ENC_MODELO.some((e) => k === canonizar(e))) m = i;
      else if (c < 0 && ENC_COSTO.some((e) => k === canonizar(e))) c = i;
    });
    if (m >= 0 && c >= 0) {
      colModelo = m;
      colCosto = c;
      filaEnc = r;
    }
  }

  // Sin encabezados reconocibles: se asume la forma más simple, dos
  // columnas (modelo, costo) desde el primer renglón con un número a la derecha.
  if (filaEnc < 0) {
    colModelo = 0;
    colCosto = 1;
    filaEnc = -1;
  }

  const filas: FilaCosto[] = [];
  const avisos: string[] = [];
  const vistos = new Set<string>();

  for (let r = filaEnc + 1; r < celdas.length; r++) {
    const f = celdas[r] ?? [];
    const etiqueta = (f[colModelo] ?? "").trim();
    const costoTxt = f[colCosto] ?? "";
    if (!etiqueta) continue;
    const costo = numero(costoTxt);
    if (costo == null) {
      if (costoTxt.trim()) avisos.push(`Fila ${r + 1}: costo no numérico "${costoTxt}".`);
      continue;
    }
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
    throw new Error("No se encontró ningún renglón con modelo y costo. Se esperan dos columnas: MODELO y COSTO.");
  }
  return { filas, avisos };
}

export async function leerCostos(buffer: ArrayBuffer | Buffer, nombre?: string): Promise<ResultadoCostos> {
  const celdas = await leerCeldas(buffer, { nombre });
  return leerCostosDeCeldas(celdas);
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
