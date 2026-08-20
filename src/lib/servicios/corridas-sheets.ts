/**
 * Corridas base directo desde Google Sheets.
 *
 * La operación mantiene las corridas en un sheet con el MISMO formato que el
 * Excel (PEDIDO, MODELO, COLOR y una columna por talla). Si el sheet se
 * comparte como "cualquiera con el enlace puede ver", Google lo entrega como
 * .xlsx en una URL fija de exportación — sin llaves ni OAuth — y de ahí en
 * adelante es el mismo importador de siempre.
 *
 * La URL del sheet vive en CORRIDAS_SHEET_URL (se acepta la URL normal del
 * navegador; aquí se convierte a la de exportación). Sincroniza el cron
 * diario y el botón en /importar.
 */
import ExcelJS from "exceljs";
import { importarCorridas, type ResultadoCorridas } from "../importar/excel";
import { upsertEnTandas, type DB } from "../datos/repos";
import { invalidar } from "./cache";
import { invalidarInventario } from "./inventario";

export function configuracionCorridasSheets(): { url: string } | null {
  const cruda = (process.env.CORRIDAS_SHEET_URL ?? "").trim().replace(/^["']+|["']+$/g, "");
  if (!cruda) return null;
  return { url: urlExportacionSheets(cruda) };
}

/**
 * Convierte la URL con la que se abre el sheet en el navegador
 * (https://docs.google.com/spreadsheets/d/ID/edit#gid=0) en la URL que lo
 * descarga como .xlsx. Se exporta el libro completo: la pestaña correcta se
 * detecta después por sus columnas.
 */
export function urlExportacionSheets(url: string): string {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) {
    throw new Error(
      "CORRIDAS_SHEET_URL no parece una URL de Google Sheets (docs.google.com/spreadsheets/d/…).",
    );
  }
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
}

/** Descarga el sheet como .xlsx. Nunca requiere credenciales. */
export async function descargarSheetCorridas(): Promise<Buffer> {
  const config = configuracionCorridasSheets();
  if (!config) {
    throw new Error(
      "Falta CORRIDAS_SHEET_URL en las variables de entorno. Pega ahí la URL de tu sheet de corridas (compartido como 'cualquiera con el enlace puede ver').",
    );
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(config.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new Error("Google Sheets no contestó en 30 segundos.");
    }
    throw new Error(`No se pudo alcanzar Google Sheets: ${e.message}`);
  }

  if (!respuesta.ok) {
    throw new Error(
      `Google Sheets contestó ${respuesta.status}. Revisa que el sheet esté compartido como "cualquiera con el enlace puede ver".`,
    );
  }

  const buf = Buffer.from(await respuesta.arrayBuffer());

  // Un .xlsx es un ZIP y siempre empieza con "PK". Si llega HTML es la
  // pantalla de inicio de sesión de Google: el sheet no es público.
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(
      'Google regresó una página de inicio de sesión en vez del archivo: el sheet no es público. Compártelo como "cualquiera con el enlace puede ver" (solo lectura).',
    );
  }

  return buf;
}

/**
 * Encuentra la pestaña de corridas por sus columnas (PEDIDO, MODELO, COLOR),
 * probando una por una. Así el sheet puede tener otras pestañas de trabajo
 * sin romper nada.
 */
export async function importarCorridasDeLibro(
  buf: Buffer,
): Promise<ResultadoCorridas & { hoja: string }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  let ultimoError: Error | null = null;
  for (const ws of wb.worksheets) {
    try {
      const r = await importarCorridas(buf, ws.name);
      return { ...r, hoja: ws.name };
    } catch (err) {
      ultimoError = err as Error;
    }
  }

  throw new Error(
    "Ninguna pestaña del sheet trae las columnas PEDIDO, MODELO y COLOR. " +
      `Pestañas revisadas: ${wb.worksheets.map((w) => w.name).join(", ")}. ` +
      (ultimoError?.message ?? ""),
  );
}

export interface ResumenCorridasSheets {
  corridas: number;
  hoja: string;
  tallas: string[];
  avisos: string[];
}

/**
 * Descarga, lee y guarda. Igual que el Excel de corridas: se ACUMULA (upsert
 * por pedido+modelo+color), porque una corrida vieja sigue describiendo las
 * cajas de ese pedido aunque ya no aparezca en el sheet.
 */
export async function sincronizarCorridasDesdeSheets(
  db: DB,
  accountId: string,
): Promise<ResumenCorridasSheets> {
  const buf = await descargarSheetCorridas();
  const r = await importarCorridasDeLibro(buf);

  if (!r.corridas.length) {
    throw new Error("El sheet se leyó bien pero no traía ninguna corrida; no se tocó nada.");
  }

  const filas = r.corridas.map((c) => ({
    account_id: accountId,
    pedido: c.pedido,
    modelo: c.modelo,
    color: c.color,
    tallas: c.tallas,
    total: c.total,
    origen: "sheets",
    actualizado_en: new Date().toISOString(),
  }));

  await upsertEnTandas(db, "corridas", filas, "account_id,pedido,modelo,color");

  invalidarInventario(accountId);
  await invalidar(db, accountId, "Se sincronizaron las corridas desde Google Sheets.");

  return {
    corridas: r.corridas.length,
    hoja: r.hoja,
    tallas: r.tallas,
    avisos: r.avisos.map((a) => `Fila ${a.fila}: ${a.mensaje}`),
  };
}
