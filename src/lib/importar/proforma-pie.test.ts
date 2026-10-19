/**
 * El pie de la proforma de CHAOZHOU (datos del banco) se leía como un
 * renglón: modelo «BANK'S NAME:THE BANK OF EAST ASIA,LIMITED» con el color
 * de arriba y un «10» como talla 24, y daba de alta una corrida basura
 * (IN10181–IN10183, 18-oct-2026).
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { importarProforma, pareceModelo } from "./proforma";

describe("lo que no es modelo en la columna «Item No.»", () => {
  it("reconoce modelos y descarta el pie del banco, encabezados y colores", () => {
    for (const m of ["GT114", "GT104-1", "MY2304", "GT148G", "686", "GT 144"]) expect(pareceModelo(m)).toBe(true);
    for (const m of [
      "BANK'S NAME:THE BANK OF EAST ASIA,LIMITED",
      "ITEM NO.",
      "CREAM",
      "SWIFT CODE: BEASHKHH",
      "10 DES VOEUX ROAD CENTRAL, HONG KONG",
    ])
      expect(pareceModelo(m)).toBe(false);
  });

  it("la proforma con el banco abajo solo trae los renglones del pedido", async () => {
    const wb = new ExcelJS.Workbook();
    const h = wb.addWorksheet("PI");
    h.addRow(["PI : IN10183"]);
    h.addRow(["Item No.", "COLOR", "23MX", "24MX", "25MX", "26MX", "27MX", "PER CTN", "CTNS", "PRS", "FOB PRICE"]);
    h.addRow(["GT144", "BROWN", 3, 15, 10, 15, 5, 48, 20, 960, 2.2]);
    h.addRow(["", "CREAM", 3, 13, 15, 9, 8, 48, 20, 960, 2.2]);
    h.addRow(["TOTAL", "", "", "", "", "", "", "", 40, 1920]);
    h.addRow([]);
    h.addRow(["BANK'S NAME:THE BANK OF EAST ASIA,LIMITED", "", "", 10]);
    h.addRow(["ACCOUNT NO: 015-123-45-67890", "", "", 10]);
    const p = await importarProforma(Buffer.from(await wb.xlsx.writeBuffer()), { nombre: "IN10183 (GT144) Assorted Size.xlsx" });
    expect(p.lineas.map((l) => [l.modelo, l.color, l.cajas])).toEqual([
      ["GT144", "BROWN", 20],
      ["GT144", "CREAM", 20],
    ]);
  });
});
