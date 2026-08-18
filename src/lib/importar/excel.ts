/**
 * Lectura de los dos formatos de Excel que usa la operación:
 *
 *   CORRIDAS BASE   -> qué tallas y cuántos pares trae cada corrida
 *   EXISTENCIAS     -> cuántas cajas hay de cada cosa y en qué almacén
 *
 * Los encabezados se buscan por nombre, no por posición, para que el archivo
 * pueda traer columnas de más, filas de título arriba, o venir en otro orden
 * sin que la importación truene.
 */
import ExcelJS from "exceljs";
import { canonizar, esCorrida, normalizarTalla } from "./sku";

export type Celda = string | number | null;

/** Una corrida: la receta de tallas de una caja. */
export interface Corrida {
  pedido: string;
  modelo: string;
  color: string;
  /** talla -> pares */
  tallas: Record<string, number>;
  total: number;
}

/** Un renglón del reporte de existencias. */
export interface FilaExistencia {
  almacen: string;
  codigoAlmacen: string;
  skuCaja: string;
  pedido: string;
  modelo: string;
  color: string;
  talla: string;
  contenedor: string;
  cajasFisicas: number;
  cajasApartadas: number;
  enCamino: number;
  cajasDisponibles: number;
  paresPorCaja: number;
  paresDisponibles: number;
}

export interface Aviso {
  fila: number;
  mensaje: string;
}

// ---------------------------------------------------------------------------
function texto(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null) {
    // ExcelJS devuelve objetos para fórmulas y texto enriquecido.
    const o = v as Record<string, unknown>;
    if ("result" in o) return texto(o.result);
    if ("text" in o) return texto(o.text);
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
  }
  return String(v).trim();
}

function numero(v: unknown): number {
  const t = texto(v);
  if (!t || t === "-" || t === "—") return 0;
  const n = Number(t.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Busca la fila de encabezados: la primera que contenga todas las columnas obligatorias. */
function localizarEncabezado(
  filas: Celda[][],
  obligatorias: string[],
  limite = 15,
): { indice: number; mapa: Map<string, number> } | null {
  const objetivo = obligatorias.map(canonizar);

  for (let i = 0; i < Math.min(limite, filas.length); i++) {
    const mapa = new Map<string, number>();
    filas[i].forEach((c, j) => {
      const k = canonizar(texto(c));
      if (k && !mapa.has(k)) mapa.set(k, j);
    });
    if (objetivo.every((o) => mapa.has(o))) return { indice: i, mapa };
  }
  return null;
}

async function leerHoja(buffer: ArrayBuffer | Buffer, hoja?: string): Promise<Celda[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = hoja ? wb.getWorksheet(hoja) : wb.worksheets[0];
  if (!ws) throw new Error("El archivo no tiene hojas legibles.");

  const filas: Celda[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: Celda[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      vals[col - 1] = (cell.value as Celda) ?? null;
    });
    filas.push(vals);
  });
  return filas;
}

// ---------------------------------------------------------------------------
// CORRIDAS BASE
// ---------------------------------------------------------------------------
export interface ResultadoCorridas {
  corridas: Corrida[];
  avisos: Aviso[];
  /** tallas detectadas como columnas, en orden */
  tallas: string[];
}

export async function importarCorridas(
  buffer: ArrayBuffer | Buffer,
  hoja?: string,
): Promise<ResultadoCorridas> {
  const filas = await leerHoja(buffer, hoja);
  const enc = localizarEncabezado(filas, ["PEDIDO", "MODELO", "COLOR"]);
  if (!enc) {
    throw new Error(
      "No encontré las columnas PEDIDO, MODELO y COLOR. ¿Es el archivo de corridas?",
    );
  }

  const { indice, mapa } = enc;
  const cabecera = filas[indice];

  // Las columnas de talla son las que tienen un número por encabezado.
  const colsTalla: { col: number; talla: string }[] = [];
  cabecera.forEach((c, j) => {
    const t = texto(c);
    if (!t) return;
    if (canonizar(t) === "TOTAL") return;
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) colsTalla.push({ col: j, talla: normalizarTalla(n) });
  });

  if (!colsTalla.length) {
    throw new Error("No encontré columnas de talla (encabezados numéricos) en el archivo.");
  }

  const cPedido = mapa.get("PEDIDO")!;
  const cModelo = mapa.get("MODELO")!;
  const cColor = mapa.get("COLOR")!;
  const cTotal = mapa.get("TOTAL");

  const avisos: Aviso[] = [];
  const porClave = new Map<string, Corrida>();

  for (let i = indice + 1; i < filas.length; i++) {
    const f = filas[i];
    const pedido = texto(f[cPedido]);
    const modelo = texto(f[cModelo]);
    const color = texto(f[cColor]);
    if (!pedido || !modelo) continue;

    const tallas: Record<string, number> = {};
    let suma = 0;
    for (const { col, talla } of colsTalla) {
      const pares = numero(f[col]);
      if (pares > 0) {
        tallas[talla] = (tallas[talla] ?? 0) + pares;
        suma += pares;
      }
    }
    if (suma <= 0) continue;

    const totalDeclarado = cTotal != null ? numero(f[cTotal]) : 0;
    if (totalDeclarado > 0 && totalDeclarado !== suma) {
      avisos.push({
        fila: i + 1,
        mensaje: `${pedido}/${modelo}/${color}: el TOTAL dice ${totalDeclarado} pero las tallas suman ${suma}. Se usan las tallas.`,
      });
    }

    const clave = claveCorrida(pedido, modelo, color);
    const previa = porClave.get(clave);

    if (!previa) {
      porClave.set(clave, { pedido, modelo, color, tallas, total: suma });
      continue;
    }

    // Duplicado: si trae exactamente lo mismo, es ruido del export y se ignora.
    const igual =
      previa.total === suma &&
      Object.keys(tallas).length === Object.keys(previa.tallas).length &&
      Object.entries(tallas).every(([t, q]) => previa.tallas[t] === q);

    if (!igual) {
      avisos.push({
        fila: i + 1,
        mensaje: `${pedido}/${modelo}/${color}: aparece más de una vez con tallas distintas. Se conserva la última.`,
      });
      porClave.set(clave, { pedido, modelo, color, tallas, total: suma });
    }
  }

  return {
    corridas: [...porClave.values()],
    avisos,
    tallas: colsTalla.map((c) => c.talla),
  };
}

export function claveCorrida(pedido: string, modelo: string, color: string): string {
  return `${canonizar(pedido)}|${canonizar(modelo)}|${canonizar(color)}`;
}

// ---------------------------------------------------------------------------
// EXISTENCIAS GLOBALES
// ---------------------------------------------------------------------------
export interface ResultadoExistencias {
  filas: FilaExistencia[];
  avisos: Aviso[];
  almacenes: string[];
}

export async function importarExistencias(
  buffer: ArrayBuffer | Buffer,
  hoja?: string,
): Promise<ResultadoExistencias> {
  const filas = await leerHoja(buffer, hoja);
  const enc = localizarEncabezado(filas, ["SKU", "MODELO", "COLOR", "TALLA"]);
  if (!enc) {
    throw new Error(
      "No encontré las columnas SKU, Modelo, Color y Talla. ¿Es el reporte de existencias?",
    );
  }

  const { indice, mapa } = enc;
  const col = (...nombres: string[]): number | undefined => {
    for (const n of nombres) {
      const i = mapa.get(canonizar(n));
      if (i != null) return i;
    }
    return undefined;
  };

  const cAlmacen = col("Almacén", "Almacen");
  const cCodAlmacen = col("Código almacén", "Codigo almacen");
  const cSku = col("SKU")!;
  const cPedido = col("N-Pedido", "N Pedido", "Pedido");
  const cModelo = col("Modelo")!;
  const cColor = col("Color")!;
  const cTalla = col("Talla")!;
  const cContenedor = col("Contenedor");
  const cFisicas = col("Cajas físicas", "Cajas fisicas");
  const cApartadas = col("Cajas apartadas");
  const cCamino = col("En camino");
  const cDisponibles = col("Cajas disponibles");
  const cParesCaja = col("Pares por caja");
  const cParesDisp = col("Pares disponibles");

  const avisos: Aviso[] = [];
  const salida: FilaExistencia[] = [];
  const almacenes = new Set<string>();

  for (let i = indice + 1; i < filas.length; i++) {
    const f = filas[i];
    const skuCaja = texto(f[cSku]);
    const modelo = texto(f[cModelo]);
    if (!skuCaja || !modelo) continue;

    const fisicas = cFisicas != null ? numero(f[cFisicas]) : 0;
    const apartadas = cApartadas != null ? numero(f[cApartadas]) : 0;
    const disponiblesCol = cDisponibles != null ? numero(f[cDisponibles]) : NaN;
    // Si el reporte no trae "Cajas disponibles", se deduce.
    const disponibles = Number.isFinite(disponiblesCol) ? disponiblesCol : Math.max(0, fisicas - apartadas);

    if (Number.isFinite(disponiblesCol) && fisicas > 0 && disponiblesCol !== fisicas - apartadas) {
      avisos.push({
        fila: i + 1,
        mensaje: `${skuCaja}: "Cajas disponibles" (${disponiblesCol}) no cuadra con físicas − apartadas (${fisicas - apartadas}). Se respeta la columna del reporte.`,
      });
    }

    const almacen = cAlmacen != null ? texto(f[cAlmacen]) : "";
    if (almacen) almacenes.add(almacen);

    salida.push({
      almacen,
      codigoAlmacen: cCodAlmacen != null ? texto(f[cCodAlmacen]) : "",
      skuCaja,
      pedido: cPedido != null ? texto(f[cPedido]) : "",
      modelo,
      color: texto(f[cColor]),
      talla: normalizarTalla(f[cTalla]),
      contenedor: cContenedor != null ? texto(f[cContenedor]) : "",
      cajasFisicas: fisicas,
      cajasApartadas: apartadas,
      enCamino: cCamino != null ? numero(f[cCamino]) : 0,
      cajasDisponibles: disponibles,
      paresPorCaja: cParesCaja != null ? numero(f[cParesCaja]) : 0,
      paresDisponibles: cParesDisp != null ? numero(f[cParesDisp]) : 0,
    });
  }

  return { filas: salida, avisos, almacenes: [...almacenes].sort() };
}

export { esCorrida };
