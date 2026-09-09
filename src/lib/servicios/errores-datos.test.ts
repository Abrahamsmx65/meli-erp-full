import { describe, expect, it } from "vitest";
import { esErrorColumnaLegacy, esErrorObjetoLegacy } from "./errores-datos";

describe("clasificación de fallos de datos", () => {
  it("permite el respaldo sólo para una columna legacy conocida", () => {
    expect(
      esErrorColumnaLegacy(
        { code: "42703", message: 'column ventas_diarias.neto does not exist' },
        ["neto"],
      ),
    ).toBe(true);
    expect(
      esErrorColumnaLegacy(
        { code: "42703", message: 'column ventas_diarias.otro does not exist' },
        ["neto"],
      ),
    ).toBe(false);
  });

  it("no confunde red, permisos ni timeout con un esquema viejo", () => {
    for (const error of [
      { code: "42501", message: "permission denied for table ventas_diarias" },
      { code: "57014", message: "canceling statement due to statement timeout" },
      new Error("fetch failed"),
    ]) {
      expect(esErrorColumnaLegacy(error, ["neto", "comision"])).toBe(false);
      expect(esErrorObjetoLegacy(error, ["amazon_listings"])).toBe(false);
    }
  });

  it("reconoce únicamente el objeto opcional nombrado", () => {
    const error = {
      code: "PGRST205",
      message: "Could not find the table 'public.amazon_listings' in the schema cache",
    };
    expect(esErrorObjetoLegacy(error, ["amazon_listings"])).toBe(true);
    expect(esErrorObjetoLegacy(error, ["amazon_skus"])).toBe(false);
  });
});