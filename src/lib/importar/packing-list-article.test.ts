import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { importarPackingList, modeloConPedido } from "./packing-list";

async function libro(filas: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const f of filas) ws.addRow(f);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Calcado del S272-2026 (FUZHOU, 23-oct-2026): «Article no» con el pedido en
// el paréntesis, «Mex 23 -30» para la corrida y «Mex 27» para la caja de una talla.
describe("packing list con «Article no» (S272-2026)", () => {
  it("parte modelo y pedido del paréntesis, con paréntesis de ancho completo", () => {
    expect(modeloConPedido("GT142 (IN10161)")).toEqual({ modelo: "GT142", pedido: "IN10161" });
    expect(modeloConPedido("MY2307（IN10163）")).toEqual({ modelo: "MY2307", pedido: "IN10163" });
    expect(modeloConPedido("GT142")).toEqual({ modelo: "GT142", pedido: null });
  });

  it("lee corridas, cajas de una talla «Mex 27» y no cuenta el total", async () => {
    const b = await libro([
      ["S272-2026 Packing List"],
      ["PICTURE", "Article no", "COLOR", "SIZE", "PRS/CTN", "TOTAL CTNS", "TOTAL PRS", "CBM", "G.W", "N.W"],
      ["", "GT142 (IN10161)", "GREY BLUE", "Mex 23 -30", 48, 40, 1920, 6.56, 428, 388],
      ["", "", "NAVY", "", 48, 20, 960, 3.28, 214, 194],
      ["", "MY2307（IN10162）", "BLK", "Mex 27", 48, 50, 2400, 7.65, 515, 465],
      ["", "", "", "Mex 28", 48, 20, 960, 3.06, 206, 186],
      ["", "", "", "", "Total", "70CTNS", "4320PRS", 20.5, "1363KGS", "1233KGS"],
    ]);
    const p = await importarPackingList(b, { nombre: "S272-2026 Packing List (CBHU9139560).xls" });
    expect(p.referencia).toBe("S272-2026");
    expect(p.contenedor).toBe("CBHU9139560");
    expect(p.lineas.map((l) => [l.pedido, l.modelo, l.color, l.talla, l.cajas])).toEqual([
      ["IN10161", "GT142", "GREY BLUE", null, 40],
      ["IN10161", "GT142", "NAVY", null, 20],
      ["IN10162", "MY2307", "BLK", "27", 50],
      ["IN10162", "MY2307", "BLK", "28", 20],
    ]);
    expect(p.totales.cajas).toBe(130);
    // «G.W» sin «Total G.W» es el peso del renglón: 428 kg ÷ 40 cajas.
    expect(p.lineas[0].pesoKg).toBe(10.7);
  });
});
