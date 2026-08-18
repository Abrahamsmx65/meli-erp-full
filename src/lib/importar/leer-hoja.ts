/**
 * Lectura de hojas de cálculo, en los dos formatos que existen en la práctica.
 *
 *   .xlsx  -> ExcelJS (mantenida, sin vulnerabilidades conocidas)
 *   .xls   -> SheetJS, que es la única que lee el formato viejo
 *
 * Las proformas de la fábrica vienen en .xls de 2011, así que no hay opción.
 *
 * NOTA DE SEGURIDAD — por qué el código se ve más aparatoso de lo necesario:
 * la versión de SheetJS que hay en npm (0.18.5) arrastra un fallo conocido de
 * contaminación de prototipo, y el camino por el que se explota es su función
 * `sheet_to_json`, que construye objetos con las llaves que trae el archivo.
 * Aquí NO se usa: se leen las celdas una por una por su dirección y solo se
 * saca su valor. Un archivo malicioso no tiene por dónde meter una llave
 * `__proto__` porque nunca se construye un objeto con llaves del archivo.
 */
import ExcelJS from "exceljs";

export type Filas = string[][];

function texto(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return texto(o.result);
    if ("text" in o) return texto(o.text);
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
    if ("hyperlink" in o && "text" in o) return texto(o.text);
  }
  return String(v).trim();
}

export function esFormatoViejo(nombre: string | undefined, buffer: Uint8Array): boolean {
  if (nombre && /\.xls$/i.test(nombre)) return true;
  // Firma de "Composite Document File" (los .xls de antes de 2007).
  return (
    buffer.length > 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
}

async function leerXlsx(buffer: ArrayBuffer | Buffer, hoja?: string): Promise<Filas> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = hoja ? wb.getWorksheet(hoja) : wb.worksheets[0];
  if (!ws) throw new Error("El archivo no tiene hojas legibles.");

  const filas: Filas = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      vals[col - 1] = texto(cell.value);
    });
    filas.push(vals);
  });
  return filas;
}

async function leerXls(buffer: Buffer, hoja?: string): Promise<Filas> {
  // Import dinámico: así el formato viejo no pesa en el arranque de la app.
  const XLSX = await import("xlsx");

  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    // Nada de fórmulas ni estilos: menos superficie de parseo.
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
  });

  const nombreHoja = hoja ?? wb.SheetNames[0];
  const ws = wb.Sheets[nombreHoja];
  if (!ws) throw new Error("El archivo no tiene hojas legibles.");

  const ref = ws["!ref"];
  if (!ref) return [];

  const rango = XLSX.utils.decode_range(ref);
  const filas: Filas = [];

  // Se recorre por dirección de celda a propósito. `sheet_to_json` haría esto
  // en una línea, pero es justo la función con el fallo de contaminación de
  // prototipo: construye objetos usando como llaves lo que diga el archivo.
  for (let r = rango.s.r; r <= rango.e.r; r++) {
    const fila: string[] = [];
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const celda = ws[XLSX.utils.encode_cell({ r, c })];
      // Solo el valor, nunca el objeto de la celda.
      fila[c - rango.s.c] = celda ? texto(celda.v) : "";
    }
    filas.push(fila);
  }

  return filas;
}

export async function leerHoja(
  buffer: ArrayBuffer | Buffer,
  opts?: { nombre?: string; hoja?: string },
): Promise<Filas> {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  if (esFormatoViejo(opts?.nombre, buf)) {
    return leerXls(buf, opts?.hoja);
  }

  try {
    return await leerXlsx(buf, opts?.hoja);
  } catch (err) {
    // Un .xls con extensión equivocada acaba aquí.
    try {
      return await leerXls(buf, opts?.hoja);
    } catch {
      throw err;
    }
  }
}
