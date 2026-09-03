/**
 * El Excel con TODOS los ASINs de un modelo, para pegárselos al contenido A+
 * cuando se crea en Seller Central (el A+ se aplica por ASIN hijo, uno por
 * talla y color).
 *
 * Dos hojas: "ASINs", con el detalle de cada hijo (talla, color, SKU, estado,
 * padre), y "Lista", una columna con puros ASINs sin encabezado para copiar y
 * pegar de un jalón en el cuadro de "Aplicar ASINs".
 *
 * Como el ZIP de fotos, es de la PUBLICACIÓN completa (GT117…GT122 si
 * comparten padre) y vive aparte de la ruta porque hay dos puertas: la del
 * dueño y la del link sin contraseña.
 */
import ExcelJS from "exceljs";
import type { DB } from "../datos/repos";
import { asinsDeModelo, enRangoContenido, etiquetaGrupo, type AsinModelo } from "./contenido-amazon";
import { nombreArchivo } from "./contenido-imagenes";

export type ResultadoExcel =
  | { ok: true; excel: Buffer; nombre: string }
  | { ok: false; error: string; status: number };

const ESTADOS: Record<string, string> = {
  Active: "Activo",
  Inactive: "Inactivo",
  Incomplete: "Incompleto",
};

/** Arma el libro a partir de la lista ya leída; separado para probarlo sin base. */
export async function libroDeAsins(asins: AsinModelo[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();

  const hoja = libro.addWorksheet("ASINs");
  hoja.columns = [
    { header: "ASIN", key: "asin", width: 14 },
    { header: "Modelo", key: "modelo", width: 10 },
    { header: "Color", key: "color", width: 14 },
    { header: "Talla", key: "talla", width: 8 },
    { header: "SKU (Amazon)", key: "sku", width: 26 },
    { header: "Estado", key: "estado", width: 11 },
    { header: "ASIN padre", key: "padre", width: 14 },
  ];
  for (const a of asins) {
    hoja.addRow({
      asin: a.asin ?? "",
      modelo: a.modelo,
      color: a.color,
      talla: a.talla,
      sku: a.sellerSku,
      estado: a.estado ? (ESTADOS[a.estado] ?? a.estado) : "",
      padre: a.padre ?? "",
    });
  }
  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true, color: { argb: "FFFFFFFF" } };
  encabezado.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2A78D6" },
  } as ExcelJS.Fill;
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };

  // Puros ASINs, sin repetir y sin encabezado: la columna se copia entera.
  const lista = libro.addWorksheet("Lista");
  lista.getColumn(1).width = 14;
  const unicos = [...new Set(asins.map((a) => a.asin).filter((a): a is string => Boolean(a)))];
  for (const asin of unicos) lista.addRow([asin]);

  return Buffer.from(await libro.xlsx.writeBuffer());
}

export async function armarExcelDeAsins(
  db: DB,
  cuenta: { id: string; pais: string | null },
  modeloCrudo: string,
): Promise<ResultadoExcel> {
  const modelo = (modeloCrudo ?? "").trim().toUpperCase();

  // La misma reja que el ZIP: nadie baja el catálogo entero desde el link.
  if (!/^[A-Z0-9]{3,12}$/.test(modelo) || !enRangoContenido(modelo)) {
    return { ok: false, error: "Ese modelo no está en la lista de contenido.", status: 400 };
  }

  const grupo = await asinsDeModelo(db, cuenta.id, modelo, cuenta.pais);
  if (!grupo || !grupo.asins.length) {
    return { ok: false, error: `No encontré ${modelo} en el catálogo de Amazon.`, status: 404 };
  }

  const etiqueta = etiquetaGrupo(grupo.codigos);
  return {
    ok: true,
    excel: await libroDeAsins(grupo.asins),
    nombre: `${nombreArchivo(etiqueta)} ASINs.xlsx`,
  };
}
