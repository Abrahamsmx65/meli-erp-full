import { describe, expect, it } from "vitest";
import { claveCorrida } from "./excel";

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
