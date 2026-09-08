import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { armarEstadoResultados } from "./corte-meli";
import { excelDelCorte } from "./corte-meli-excel";

describe("excelDelCorte", () => {
  it("arma un libro con todas las hojas y números como números", async () => {
    const e = armarEstadoResultados({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 2, ordenes: 2, importe: 400, comision: 60, neto: 240 }],
      ordenes: [{ orderId: 1, fecha: "2026-08-03", total: 400, neto: 240, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2 }],
      modeloDeSku: new Map([["GT135-TABACO-25", "GT135"]]),
      config: new Map([["GT135", { categoria: "Corcho", costo: 60 }]]),
      adsPorModelo: new Map(),
      adsSinAmarre: 0,
      errorAds: null,
      gastos: [{ id: 1, fecha: "2026-08-10", concepto: "Almacenamiento", categoria: "full", monto: 100 }],
      cargos: [],
      cargosLeidos: true,
    });
    const buffer = await excelDelCorte(e);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((h) => h.name)).toEqual(["Resumen", "Por modelo", "Por categoría", "Por día", "Gastos a mano", "Facturado por MELI", "Avisos"]);
    const resumen = wb.getWorksheet("Resumen")!;
    const utilidad = resumen.getRow(16).getCell(2).value;
    expect(utilidad).toBe(e.utilidadNeta);
    expect(wb.getWorksheet("Por modelo")!.getRow(2).getCell(1).value).toBe("GT135");
    expect(wb.getWorksheet("Gastos a mano")!.getRow(2).getCell(4).value).toBe(100);
  });
});
