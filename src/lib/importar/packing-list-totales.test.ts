/**
 * Packing lists que se leían mal (11-oct-2026): la fila de total se contaba
 * como un renglón más y el contenedor salía al doble contra su BL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { importarPackingList } from "./packing-list";

const fixture = (n: string) => readFileSync(join(process.cwd(), "fixtures", n));

describe("la fila de total no es un renglón", () => {
  it("S271-2026: el total «合计» (713) no se suma; quedan las 713 cajas del BL", async () => {
    const pl = await importarPackingList(fixture("packing-list-S271-HAMU5029953.xls"), { nombre: "S271-2026 (HAMU5029953).xls" });
    expect(pl.totales.cajas).toBe(713);
    expect(pl.contenedor).toBe("HAMU5029953");
    expect(pl.lineas.some((l) => l.cajas === 713)).toBe(false);
  });

  it("un total SIN letrero (S267-2026: 530 debajo de GT104-6) no se lee como otro bloque", async () => {
    const wb = new ExcelJS.Workbook();
    const h = wb.addWorksheet("PL");
    h.addRow(["S267-2026 Packing List (Container :WHSU6786505   / Seal :   WHA2680578  )"]);
    h.addRow(["Photo", "PO", "Style", "color", "Size", "Prs/ctn", "Means", "", "", "Ctns", "Prs"]);
    h.addRow(["", "IN10151", "GT104-2", "GREY", "39-45(25-30)", 48, 0.68, 0.3, 0.42, 90, 4320]);
    h.addRow(["", "", "GT104-6", "BROWN", "39-45(25-30)", 48, 0.68, 0.3, 0.42, 40, 1920]);
    h.addRow(["", "", "", "", "", "", "", "", "", 130, 6240]);
    const pl = await importarPackingList(Buffer.from(await wb.xlsx.writeBuffer()), { nombre: "pl.xlsx" });
    expect(pl.totales.cajas).toBe(130);
    expect(pl.lineas.map((l) => [l.modelo, l.cajas])).toEqual([
      ["GT104-2", 90],
      ["GT104-6", 40],
    ]);
  });

  it("una fila de continuación con pares por caja SÍ es renglón (S269-2026: GT134 BLK 41 + 51)", async () => {
    const wb = new ExcelJS.Workbook();
    const h = wb.addWorksheet("PL");
    h.addRow(["S269-2026 Packing List (Container : KKFU7878526 / Seal : CNEA34678)"]);
    h.addRow(["Photo", "", "Style", "color", "Size", "Prs/ctn", "Means", "", "", "Ctns", "Prs"]);
    h.addRow(["", "IN10159", "GT134", "BLK (NEGRO)", "", 48, 0.58, 0.35, 0.43, 41, 1968]);
    h.addRow(["", "", "", "", "", 48, 0.61, 0.48, 0.45, 51, 2448]);
    h.addRow(["Total", "", "", "", "", "", "", "", "", 92, 4416]);
    const pl = await importarPackingList(Buffer.from(await wb.xlsx.writeBuffer()), { nombre: "pl.xlsx" });
    expect(pl.totales.cajas).toBe(92);
    expect(pl.lineas).toHaveLength(2);
  });
});

describe("el color con la traducción", () => {
  it("S270-2026: «COGNAC   coñac» queda COGNAC, no «COGNAC CO»", async () => {
    const pl = await importarPackingList(fixture("packing-list-S270-TIIU9082344.xls"), { nombre: "S270-2026 Packing List (TIIU9082344).xls" });
    expect(pl.totales.cajas).toBe(500);
    const gt264 = pl.lineas.find((l) => l.modelo === "GT264");
    expect(gt264?.color).toBe("COGNAC");
  });
});
