import { describe, expect, it } from "vitest";
import { claveCorrida, normalizarCorridaUnitalla } from "./excel";

describe("claveCorrida: la caja del almacén encuentra la receta de su pedido", () => {
  it("BLACK de la proforma y BLK de EnvioPack son la misma corrida (IN10105, GT251)", () => {
    expect(claveCorrida("IN10105", "GT251", "BLK")).toBe(claveCorrida("IN10105", "GT251", "BLACK"));
  });
  it("DK.BROWN y DK BROWN, LT.BROWN y LT BROWN, DARK BROWN y DK BROWN", () => {
    expect(claveCorrida("IN10105", "GT255", "DK.BROWN")).toBe(claveCorrida("IN10105", "GT255", "DK BROWN"));
    expect(claveCorrida("IN10112", "GT170", "LT.BROWN")).toBe(claveCorrida("IN10112", "GT170", "LT BROWN"));
    expect(claveCorrida("IN10112", "GT170", "DARK BROWN")).toBe(claveCorrida("IN10112", "GT170", "DK BROWN"));
  });
  it("otro pedido u otro color siguen siendo otra receta", () => {
    expect(claveCorrida("IN10105", "GT251", "BLK")).not.toBe(claveCorrida("IN10106", "GT251", "BLK"));
    expect(claveCorrida("IN10105", "GT251", "BLK")).not.toBe(claveCorrida("IN10105", "GT251", "BROWN"));
  });
});

describe("normalizarCorridaUnitalla: la talla de la caja de una talla va pegada al color (20-oct-2026)", () => {
  it("«IN10057-24 · GT114 · BLK» y «IN10121 · GT114-23 · BEIGE» pasan a color-talla", () => {
    expect(normalizarCorridaUnitalla({ pedido: "IN10057-24", modelo: "GT114", color: "BLK", tallas: { "24": 24 }, total: 24 })).toEqual({
      pedido: "IN10057",
      modelo: "GT114",
      color: "BLK-24",
      tallas: { "24": 24 },
      total: 24,
    });
    expect(normalizarCorridaUnitalla({ pedido: "IN10121", modelo: "GT114-23", color: "BEIGE", tallas: { "23": 24 }, total: 24 })).toMatchObject({
      pedido: "IN10121",
      modelo: "GT114",
      color: "BEIGE-23",
    });
  });
  it("la que ya viene bien, un modelo con número (GT104-5) y una corrida de varias tallas no se tocan", () => {
    const bien = { pedido: "IN10121", modelo: "GT114", color: "TABACO BROWN-25", tallas: { "25": 24 }, total: 24 };
    expect(normalizarCorridaUnitalla(bien)).toBe(bien);
    const gt104 = { pedido: "RT02-25", modelo: "GT104-5", color: "GREEN", tallas: { "25": 50 }, total: 50 };
    expect(normalizarCorridaUnitalla(gt104)).toMatchObject({ pedido: "RT02", modelo: "GT104-5", color: "GREEN-25" });
    const corrida = { pedido: "IN10053-25", modelo: "GT104-1", color: "BLK", tallas: { "25": 3, "26": 6 }, total: 9 };
    expect(normalizarCorridaUnitalla(corrida)).toBe(corrida);
  });
});
