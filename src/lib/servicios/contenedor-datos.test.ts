import { describe, expect, it } from "vitest";
import { modeloBaseDeCosto } from "./contenedor-datos";

describe("modeloBaseDeCosto (GT104-1…6 del S267)", () => {
  it("quita el número de color del modelo", () => {
    expect(modeloBaseDeCosto("GT104-1")).toBe("GT104");
    expect(modeloBaseDeCosto("gt104-6")).toBe("GT104");
  });
  it("un modelo sin sufijo no tiene base", () => {
    expect(modeloBaseDeCosto("GT110")).toBeNull();
    expect(modeloBaseDeCosto("MY2304")).toBeNull();
  });
});
