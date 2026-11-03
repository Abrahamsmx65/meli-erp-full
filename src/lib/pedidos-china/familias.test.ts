import { describe, expect, it } from "vitest";
import {
  agruparPorFamilia,
  armarMapaFamilias,
  familiaDe,
  grupoDeModelo,
  listarFamilias,
  nombreDeFamilia,
  validarFamilia,
} from "./familias";

const mapa = armarMapaFamilias([
  { modelo: "gt117", familia: "GT117-GT122" },
  { modelo: "GT118", familia: "GT117-GT122" },
  { modelo: "GT122", familia: "gt117-gt122" },
  { modelo: "GT104-1", familia: "GT104" },
]);

describe("familias de modelos", () => {
  it("encuentra la familia sin importar cómo se escriba el modelo", () => {
    expect(familiaDe(mapa, "GT117")).toBe("GT117-GT122");
    expect(familiaDe(mapa, "gt122")).toBe("GT117-GT122");
    expect(familiaDe(mapa, "GT104-1")).toBe("GT104");
    expect(familiaDe(mapa, "GT119")).toBeNull();
    expect(familiaDe(null, "GT117")).toBeNull();
    expect(grupoDeModelo(mapa, "GT118")).toBe("GT117-GT122");
    expect(grupoDeModelo(mapa, "gt148")).toBe("GT148");
  });

  it("agrupa por familia conservando el orden de aparición", () => {
    const g = agruparPorFamilia(
      [{ modelo: "GT148" }, { modelo: "GT117" }, { modelo: "GT179" }, { modelo: "GT122" }, { modelo: "GT118" }],
      mapa,
    );
    expect(g.map((x) => [x.nombre, x.familia, x.elementos.map((e) => e.modelo)])).toEqual([
      ["GT148", null, ["GT148"]],
      ["GT117-GT122", "GT117-GT122", ["GT117", "GT122", "GT118"]],
      ["GT179", null, ["GT179"]],
    ]);
  });

  it("lista las familias con sus modelos en orden natural", () => {
    expect(listarFamilias(mapa)).toEqual([
      { familia: "GT104", modelos: ["GT104-1"] },
      { familia: "GT117-GT122", modelos: ["GT117", "GT118", "GT122"] },
    ]);
  });

  it("propone el nombre con el primero y el último modelo", () => {
    expect(nombreDeFamilia(["GT122", "GT117", "GT119"])).toBe("GT117-GT122");
    expect(nombreDeFamilia(["GT117"])).toBe("GT117");
    expect(nombreDeFamilia([])).toBe("");
  });

  it("valida el alta: nombre, dos modelos distintos y forma de modelo", () => {
    expect(validarFamilia(" gt117-gt122 ", ["GT117", "gt118", "GT117"])).toEqual({
      familia: "GT117-GT122",
      modelos: ["GT117", "GT118"],
    });
    expect(() => validarFamilia("", ["GT117", "GT118"])).toThrow(/nombre/);
    expect(() => validarFamilia("X", ["GT117"])).toThrow(/dos modelos/);
    expect(() => validarFamilia("X", ["GT117", "hola"])).toThrow(/no parece un modelo/);
  });
});
