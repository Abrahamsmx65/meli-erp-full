import { describe, expect, it } from "vitest";
import { corridaParaIndusther, leerPaginacion } from "./corridas-integracion";

describe("corridaParaIndusther", () => {
  it("una caja de corrida va con sus tallas y el barcode del color", () => {
    const c = corridaParaIndusther({
      pedido: "IN10079",
      modelo: "GT221",
      color: "LT BROWN",
      tallas: { "23": 5, "24": 10, "25": "13" },
      total: 28,
      origen: "proforma",
      actualizado_en: "2026-10-20T10:00:00Z",
    });
    expect(c).toMatchObject({
      color: "LT BROWN",
      unitalla: false,
      talla: null,
      tallas: { "23": 5, "24": 10, "25": 13 },
      paresPorCaja: 28,
      barcode: "IN10079-GT221-LT-BROWN",
      clave: "IN10079|GT221|LT BROWN",
    });
  });

  it("la caja de una talla separa la talla del color", () => {
    const c = corridaParaIndusther({
      pedido: "IN10121",
      modelo: "GT114",
      color: "TABACO BROWN-25",
      tallas: { "25": 24 },
      total: 24,
      origen: "sheet",
      actualizado_en: null,
    });
    expect(c).toMatchObject({
      color: "TABACO BROWN",
      unitalla: true,
      talla: "25",
      paresPorCaja: 24,
      barcode: "IN10121-GT114-TABACO-BROWN-25",
      clave: "IN10121|GT114|TABACO BROWN-25",
    });
  });

  it("tallas en cero o basura no viajan", () => {
    const c = corridaParaIndusther({ pedido: "IN1", modelo: "GT1", color: "BLK", tallas: { "23": 0, "24": "x", "25": 6 }, total: 6, origen: null, actualizado_en: null });
    expect(c.tallas).toEqual({ "25": 6 });
    expect(c.unitalla).toBe(true);
    expect(c.color).toBe("BLK");
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
