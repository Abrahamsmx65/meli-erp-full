import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { colorDelSku, colorParaIndusther, excelIndusther, leerPaginacion, separarCorrida, tablaDeCorridas } from "./corridas-integracion";

const fila = (color: string, tallas: Record<string, unknown>) => ({
  pedido: "IN10126",
  modelo: "GT142",
  color,
  tallas,
  total: null,
  origen: "proforma",
  actualizado_en: null,
});

describe("separarCorrida", () => {
  it("una caja de corrida se queda con su color y sus tallas", () => {
    expect(separarCorrida(fila("CREAM", { "23": 8, "24": 14, "25": "10", "26": 9, "27": 7 }))).toMatchObject({
      color: "CREAM",
      talla: null,
      paresPorCaja: 48,
      clave: "IN10126|GT142|CREAM",
    });
  });

  it("la caja de una talla separa la talla pegada al color", () => {
    expect(separarCorrida(fila("TABACO BROWN-25", { "25": 24 }))).toMatchObject({ color: "TABACO BROWN", talla: "25", paresPorCaja: 24 });
  });

  it("tallas en cero o basura no viajan", () => {
    expect(separarCorrida(fila("BLK", { "23": 0, "24": "x", "25": 6 })).tallas).toEqual({ "25": 6 });
  });
});

describe("color del Sku", () => {
  it("es lo que sigue a PEDIDO-MODELO-", () => {
    expect(colorDelSku("IN10079-GT228-LT BROWN", "IN10079", "GT228")).toBe("LT BROWN");
    expect(colorDelSku("IN10079-GT104-5-GREEN", "IN10079", "GT104-5")).toBe("GREEN");
    expect(colorDelSku("OTRO", "IN10079", "GT228")).toBeNull();
  });

  it("toma el color de MELI y, sin variante, el del pedido; la unitalla con su talla", () => {
    const c = separarCorrida({ ...fila("BLACK", { "23": 8, "24": 16 }), pedido: "IN10079", modelo: "GT217" });
    expect(colorParaIndusther(c, "GT217-BLK-23-MX")).toBe("BLK");
    expect(colorParaIndusther(c, null)).toBe("BLACK");
    const u = separarCorrida({ ...fila("TABACO BROWN-25", { "25": 24 }), pedido: "IN10121", modelo: "GT114" });
    expect(colorParaIndusther(u, "GT114-TABACO BROWN-25-MX")).toBe("TABACO BROWN-25");
  });
});

describe("tablaDeCorridas", () => {
  it("PEDIDO | MODELO | COLOR | tallas en orden | TOTAL, como el 686_19.xlsx", () => {
    const t = tablaDeCorridas([
      { pedido: "IN10126", modelo: "GT142", color: "CREAM", tallas: { "23": 8, "24": 14, "25": 10, "26": 9, "27": 7 } },
      { pedido: "IN10115", modelo: "GT136", color: "BLK", tallas: { "23": 3, "24": 8, "25": 9, "26": 9, "27": 7, "28": 5, "29": 3, "30": 4 } },
    ]);
    expect(t.columnas).toEqual(["PEDIDO", "MODELO", "COLOR", "23", "24", "25", "26", "27", "28", "29", "30", "TOTAL"]);
    expect(t.filas[0]).toMatchObject({ PEDIDO: "IN10126", "28": null, "30": null, TOTAL: 48 });
    expect(t.filas[1].TOTAL).toBe(48);
  });

  it("el Excel pone «-» donde no hay talla", async () => {
    const t = tablaDeCorridas([{ pedido: "IN10117", modelo: "GT134", color: "CREAM", tallas: { "23": 8, "28": 3 } }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await excelIndusther([{ nombre: "Sheet1", tabla: t, vacio: "-" }])) as any);
    const ws = wb.getWorksheet("Sheet1")!;
    expect(ws.getRow(1).values).toEqual([undefined, "PEDIDO", "MODELO", "COLOR", "23", "28", "TOTAL"]);
    expect(ws.getRow(2).values).toEqual([undefined, "IN10117", "GT134", "CREAM", 8, 3, 11]);
  });
});

describe("leerPaginacion", () => {
  it("por omisión 1000 desde el inicio", () => {
    expect(leerPaginacion(new URLSearchParams())).toEqual({ limit: 1000, offset: 0, desde: null });
  });
  it("rechaza límites fuera de rango y fechas inválidas", () => {
    expect(leerPaginacion(new URLSearchParams("limit=5000"))).toHaveProperty("error");
    expect(leerPaginacion(new URLSearchParams("offset=-1"))).toHaveProperty("error");
    expect(leerPaginacion(new URLSearchParams("desde=ayer"))).toHaveProperty("error");
  });
  it("normaliza desde a ISO", () => {
    expect(leerPaginacion(new URLSearchParams("desde=2026-10-21"))).toEqual({ limit: 1000, offset: 0, desde: "2026-10-21T00:00:00.000Z" });
  });
});
