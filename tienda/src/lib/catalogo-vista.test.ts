import { describe, expect, it } from "vitest";
import { categoriaVisible, rangoTallas, tituloCorto } from "./catalogo-vista";

describe("tituloCorto", () => {
  it("quita la marca y suaviza lo gritado, conserva las siglas", () => {
    expect(tituloCorto("GETAC CHANCLAS MUJER, SANDALIAS HOMBRE con Plantilla de corcho Suela EVA")).toBe(
      "Chanclas mujer, sandalias hombre con Plantilla de corcho Suela EVA",
    );
    expect(tituloCorto("GETAC Pantuflas de Plataforma para Mujer")).toBe("Pantuflas de Plataforma para Mujer");
    expect(tituloCorto("Botas UGG")).toBe("Botas UGG");
  });
});

describe("rangoTallas", () => {
  it("rango cuando son seguidas", () => {
    expect(rangoTallas(["23", "24", "25", "26", "27", "28"])).toBe("23 a 28");
    expect(rangoTallas(["22", "22.5", "23", "23.5"])).toBe("22 a 23.5");
  });
  it("lista cuando no", () => {
    expect(rangoTallas(["23", "25", "28"])).toBe("23, 25, 28");
    expect(rangoTallas(["CH", "M", "G"])).toBe("CH, M, G");
    expect(rangoTallas(["24", "25"])).toBe("24, 25");
  });
});

describe("categoriaVisible", () => {
  it("junta las que solo cambian de mayúsculas", () => {
    expect(categoriaVisible("Botas lluvia")).toBe(categoriaVisible("BOTAS  LLUVIA"));
    expect(categoriaVisible(" ")).toBeNull();
  });
});
