import { describe, expect, it } from "vitest";
import { normalizarCategoria } from "./categoria";

describe("normalizarCategoria", () => {
  it("todo en mayúsculas con un solo espacio", () => {
    expect(normalizarCategoria("Botas lluvia")).toBe("BOTAS LLUVIA");
    expect(normalizarCategoria("  sandalias   eva ")).toBe("SANDALIAS EVA");
    expect(normalizarCategoria("BOTAS LLUVIA")).toBe("BOTAS LLUVIA");
    expect(normalizarCategoria("mocasín")).toBe("MOCASÍN");
  });
  it("Fundas se queda como la busca YAPANIZCEL", () => {
    expect(normalizarCategoria("FUNDAS")).toBe("Fundas");
    expect(normalizarCategoria("fundas")).toBe("Fundas");
  });
  it("vacío = sin categoría", () => {
    expect(normalizarCategoria("   ")).toBeNull();
    expect(normalizarCategoria(null)).toBeNull();
  });
});
