/**
 * Inventario de bodega desde Google Sheets.
 *
 * El sheet tiene VARIAS pestañas y cada pestaña es un DISEÑO de funda: adentro
 * van sus modelos de celular, colores y cantidades. Como el sheet lo llenan a
 * mano, la lectura no da por hecho un formato: encuentra el renglón de
 * encabezados por sus nombres y acepta dos maneras de acomodar los datos:
 *
 *   TABLA    un renglón por producto, con columnas MODELO / COLOR / CANTIDAD
 *            (y opcionalmente SKU y DISEÑO).
 *   MATRIZ   modelos hacia abajo en la primera columna, colores hacia la
 *            derecha en el encabezado, y la cantidad en el cruce.
 *
 * Si el sheet se comparte como "cualquiera con el enlace puede ver", Google
 * lo entrega como .xlsx en una URL fija de exportación, sin llaves ni OAuth.
 * La URL vive en YAPANIZCEL_SHEET_URL.
 *
 * Lo que no se entiende NO se tira en silencio: sale en `avisos`, con hoja y
 * renglón, para que se vea en pantalla qué se quedó fuera.
 */
import ExcelJS from "exceljs";
import { canonizar } from "./sku";

export interface FilaInventario {
  skuBodega: string;
  hoja: string;
  diseno: string;
  modelo: string;
  color: string;
  cantidad: number;
}

export interface Aviso {
  hoja: string;
  fila: number | null;
  mensaje: string;
}

export interface ResultadoInventario {
  filas: FilaInventario[];
  avisos: Aviso[];
  hojas: { nombre: string; formato: "tabla" | "matriz" | "sin_datos"; renglones: number }[];
}

/** Una hoja como matriz de textos, tal como la entrega ExcelJS. */
export type Celdas = string[][];

export function configuracionSheets(): { url: string } | null {
  const cruda = (process.env.YAPANIZCEL_SHEET_URL ?? "").trim().replace(/^["']+|["']+$/g, "");
  if (!cruda) return null;
  return { url: urlExportacion(cruda) };
}

export function urlExportacion(url: string): string {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) {
    throw new Error("YAPANIZCEL_SHEET_URL no parece una URL de Google Sheets (docs.google.com/spreadsheets/d/…).");
  }
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
}

export async function descargarSheet(): Promise<Buffer> {
  const config = configuracionSheets();
  if (!config) {
    throw new Error(
      "Falta YAPANIZCEL_SHEET_URL en el entorno. Pega ahí la URL del sheet de inventario (compartido como 'cualquiera con el enlace puede ver').",
    );
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(config.url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error("Google Sheets no contestó en 30 segundos.");
    throw new Error(`No se pudo alcanzar Google Sheets: ${e.message}`);
  }
  if (!respuesta.ok) {
    throw new Error(`Google Sheets contestó ${respuesta.status}. Revisa que el sheet esté compartido como "cualquiera con el enlace puede ver".`);
  }
  const buf = Buffer.from(await respuesta.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('Google regresó una página de inicio de sesión en vez del archivo: el sheet no es público. Compártelo como "cualquiera con el enlace puede ver".');
  }
  return buf;
}

function texto(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return texto(o.result);
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
    if ("text" in o) return texto(o.text);
  }
  return String(v).trim();
}

/** Todas las hojas del libro, celda por celda (nunca `sheet_to_json`). */
export async function leerLibro(buf: Buffer): Promise<{ nombre: string; celdas: Celdas }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const celdas: Celdas = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        vals[col - 1] = texto(cell.value);
      });
      celdas[n - 1] = vals;
    });
    return { nombre: ws.name, celdas };
  });
}

// ---------------------------------------------------------------------------
// Detección del formato
// ---------------------------------------------------------------------------
const ENCABEZADOS = {
  sku: ["SKU", "CLAVE", "CODIGO"],
  modelo: ["MODELO", "MODELOS", "CELULAR", "TELEFONO", "EQUIPO"],
  color: ["COLOR", "COLORES"],
  cantidad: ["CANTIDAD", "CANT", "EXISTENCIA", "EXISTENCIAS", "STOCK", "PIEZAS", "PZAS", "PZS", "INVENTARIO", "TOTAL", "DISPONIBLE"],
  diseno: ["DISENO", "DISEÑO", "DISENIO"],
};

function esEncabezado(celda: string, opciones: string[]): boolean {
  const c = canonizar(celda);
  return opciones.some((o) => c === canonizar(o));
}

function numero(s: string): number | null {
  const limpio = String(s ?? "").replace(/[,\s]/g, "");
  if (limpio === "") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

interface Columnas {
  fila: number;
  sku: number | null;
  modelo: number | null;
  color: number | null;
  cantidad: number | null;
  diseno: number | null;
}

/** Busca, en los primeros renglones, el que trae los encabezados de tabla. */
function encontrarColumnas(celdas: Celdas): Columnas | null {
  for (let r = 0; r < Math.min(celdas.length, 15); r++) {
    const fila = celdas[r] ?? [];
    const cols: Columnas = { fila: r, sku: null, modelo: null, color: null, cantidad: null, diseno: null };
    fila.forEach((c, i) => {
      if (!c) return;
      if (cols.sku == null && esEncabezado(c, ENCABEZADOS.sku)) cols.sku = i;
      else if (cols.modelo == null && esEncabezado(c, ENCABEZADOS.modelo)) cols.modelo = i;
      else if (cols.color == null && esEncabezado(c, ENCABEZADOS.color)) cols.color = i;
      else if (cols.cantidad == null && esEncabezado(c, ENCABEZADOS.cantidad)) cols.cantidad = i;
      else if (cols.diseno == null && esEncabezado(c, ENCABEZADOS.diseno)) cols.diseno = i;
    });
    // Es tabla si tiene cantidad y algo con qué identificar el producto.
    if (cols.cantidad != null && (cols.sku != null || cols.modelo != null)) return cols;
  }
  return null;
}

/**
 * Formato matriz: el primer renglón con dos o más textos hacia la derecha de
 * la primera columna es el de colores; los renglones de abajo traen el
 * modelo en la primera columna y números en el cruce.
 */
function encontrarMatriz(celdas: Celdas): { fila: number; colModelo: number; colores: { col: number; nombre: string }[] } | null {
  for (let r = 0; r < Math.min(celdas.length, 15); r++) {
    const fila = celdas[r] ?? [];

    // La esquina puede venir vacía o decir "MODELO": de ahí a la derecha van
    // los colores. Si la fila trae números, no es encabezado.
    let esquina = fila.findIndex((c) => c && esEncabezado(c, ENCABEZADOS.modelo));
    if (esquina < 0) esquina = 0;

    const colores: { col: number; nombre: string }[] = [];
    let hayNumeros = false;
    for (let i = esquina + 1; i < fila.length; i++) {
      const c = (fila[i] ?? "").trim();
      if (!c) continue;
      if (numero(c) != null) {
        hayNumeros = true;
        break;
      }
      if (!esEncabezado(c, ENCABEZADOS.cantidad)) colores.push({ col: i, nombre: c });
    }
    if (hayNumeros || colores.length < 2) continue;

    // Confirmar con los renglones de abajo: texto a la izquierda del primer
    // color (ese es el modelo) y un número en algún cruce.
    const primeraColor = colores[0].col;
    for (let k = r + 1; k < Math.min(celdas.length, r + 6); k++) {
      const f = celdas[k] ?? [];
      let colModelo = -1;
      for (let c = 0; c < primeraColor; c++) {
        const t = (f[c] ?? "").trim();
        if (t && numero(t) == null) {
          colModelo = c;
          break;
        }
      }
      if (colModelo < 0) continue;
      if (colores.some((c) => numero(f[c.col] ?? "") != null)) return { fila: r, colModelo, colores };
    }
  }
  return null;
}

/** Arma el SKU de bodega cuando la hoja no trae columna de SKU. */
export function armarSkuBodega(diseno: string, modelo: string, color: string): string {
  return [canonizar(diseno), canonizar(modelo), canonizar(color)].filter(Boolean).join("-");
}

/**
 * Lee una hoja. El nombre de la pestaña es el diseño, salvo que la hoja
 * traiga su propia columna de diseño.
 */
export function leerHoja(nombre: string, celdas: Celdas): {
  filas: FilaInventario[];
  avisos: Aviso[];
  formato: "tabla" | "matriz" | "sin_datos";
} {
  const filas: FilaInventario[] = [];
  const avisos: Aviso[] = [];
  const disenoHoja = nombre.trim();

  const cols = encontrarColumnas(celdas);
  if (cols) {
    for (let r = cols.fila + 1; r < celdas.length; r++) {
      const f = celdas[r] ?? [];
      const sku = cols.sku != null ? (f[cols.sku] ?? "").trim() : "";
      const modelo = cols.modelo != null ? (f[cols.modelo] ?? "").trim() : "";
      const color = cols.color != null ? (f[cols.color] ?? "").trim() : "";
      const diseno = cols.diseno != null && (f[cols.diseno] ?? "").trim() ? (f[cols.diseno] ?? "").trim() : disenoHoja;
      const cantidadTxt = f[cols.cantidad!] ?? "";

      if (!sku && !modelo) continue; // renglón vacío o de título
      if (/^total/i.test(modelo) || /^total/i.test(sku)) continue;

      const cantidad = numero(cantidadTxt);
      if (cantidad == null) {
        if (cantidadTxt.trim()) avisos.push({ hoja: nombre, fila: r + 1, mensaje: `Cantidad no numérica: "${cantidadTxt}".` });
        continue;
      }

      filas.push({
        skuBodega: sku || armarSkuBodega(diseno, modelo, color),
        hoja: nombre,
        diseno: canonizar(diseno),
        modelo: canonizar(modelo) || (sku ? "" : ""),
        color: canonizar(color),
        cantidad: Math.max(0, Math.round(cantidad)),
      });
    }
    return { filas, avisos, formato: "tabla" };
  }

  const matriz = encontrarMatriz(celdas);
  if (matriz) {
    for (let r = matriz.fila + 1; r < celdas.length; r++) {
      const f = celdas[r] ?? [];
      const modelo = (f[matriz.colModelo] ?? "").trim();
      if (!modelo || /^total/i.test(modelo)) continue;
      for (const c of matriz.colores) {
        const txt = f[c.col] ?? "";
        if (!txt.trim()) continue;
        const cantidad = numero(txt);
        if (cantidad == null) {
          avisos.push({ hoja: nombre, fila: r + 1, mensaje: `Cantidad no numérica en ${c.nombre}: "${txt}".` });
          continue;
        }
        filas.push({
          skuBodega: armarSkuBodega(disenoHoja, modelo, c.nombre),
          hoja: nombre,
          diseno: canonizar(disenoHoja),
          modelo: canonizar(modelo),
          color: canonizar(c.nombre),
          cantidad: Math.max(0, Math.round(cantidad)),
        });
      }
    }
    return { filas, avisos, formato: "matriz" };
  }

  return { filas, avisos: [{ hoja: nombre, fila: null, mensaje: "No se reconoció ni tabla (MODELO/COLOR/CANTIDAD) ni matriz (modelos abajo, colores a la derecha)." }], formato: "sin_datos" };
}

/** Lee todas las pestañas y junta. Un SKU repetido entre pestañas se SUMA y se avisa. */
export function leerInventario(hojas: { nombre: string; celdas: Celdas }[]): ResultadoInventario {
  const porSku = new Map<string, FilaInventario>();
  const avisos: Aviso[] = [];
  const resumen: ResultadoInventario["hojas"] = [];

  for (const h of hojas) {
    const r = leerHoja(h.nombre, h.celdas);
    avisos.push(...r.avisos);
    resumen.push({ nombre: h.nombre, formato: r.formato, renglones: r.filas.length });
    for (const f of r.filas) {
      const previa = porSku.get(f.skuBodega);
      if (previa) {
        previa.cantidad += f.cantidad;
        avisos.push({ hoja: h.nombre, fila: null, mensaje: `${f.skuBodega} aparece más de una vez (también en "${previa.hoja}"): se sumó.` });
      } else {
        porSku.set(f.skuBodega, { ...f });
      }
    }
  }

  return { filas: [...porSku.values()], avisos, hojas: resumen };
}
