import { describe, expect, it } from "vitest";
import { guiaDeTallas, textoGuiaTallas } from "./guia-tallas";

describe("guía de tallas", () => {
  it("talla MX = largo en cm, únicas y ordenadas", () => {
    expect(guiaDeTallas(["25", "23", "24", "23", "27", "23.5", "x"])).toEqual([
      { talla: "23", cm: "23 cm" },
      { talla: "23.5", cm: "23.5 cm" },
      { talla: "24", cm: "24 cm" },
      { talla: "25", cm: "25 cm" },
      { talla: "27", cm: "27 cm" },
    ]);
  });
  it("el párrafo de la descripción", () => {
    expect(textoGuiaTallas(guiaDeTallas(["23", "24"]))).toBe("Guía de tallas (largo de la plantilla): 23 = 23 cm · 24 = 24 cm");
    expect(textoGuiaTallas([])).toBe("");
  });
});
