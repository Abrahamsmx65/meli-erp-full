import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { importarPackingList } from "./packing-list";

// S263-2026: cajas de UNA talla, la europea afuera y la MEXICANA en el
// paréntesis, sin columna de pares por talla.
async function hoja(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PL");
  ws.addRow(["Order No.", "Style", "Color", "Size", "Ctns", "Prs/ctn", "Total prs"]);
  ws.addRow(["IN10148", "GT114", "BLK (NEGRO)", "39 (26)", 10, 48, 480]);
  ws.addRow(["", "", "", "41 (27)", 10, 48, 480]);
  ws.addRow(["", "", "", "42（28）", 15, 48, 720]);
  ws.addRow(["IN10149", "GT115", "BEIGE", "36-41 (23-27)", 5, 24, 120]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("talla mexicana en el paréntesis", () => {
  it("cada renglón es una caja unitalla con la talla MX", async () => {
    const pl = await importarPackingList(await hoja(), { nombre: "packing.xlsx" });
    const gt114 = pl.lineas.filter((l) => l.modelo === "GT114");
    expect(gt114.map((l) => [l.talla, l.cajas, l.paresPorCaja])).toEqual([
      ["26", 10, 48],
      ["27", 10, 48],
      ["28", 15, 48],
    ]);
    // Un rango sigue siendo corrida, no talla.
    expect(pl.lineas.find((l) => l.modelo === "GT115")?.talla).toBeNull();
    expect(pl.totales.cajas).toBe(40);
  });
});
