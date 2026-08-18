import { describe, expect, it } from "vitest";
import { coincide, terminosDeBusqueda } from "./filtro";

describe("búsqueda del plan", () => {
  const t = terminosDeBusqueda;

  it("sin búsqueda deja pasar todo", () => {
    expect(coincide("GT110-NAVY-26-MX", t(""))).toBe(true);
    expect(coincide("lo que sea", t(null))).toBe(true);
  });

  it("filtra por modelo", () => {
    expect(coincide("GT110-NAVY-26-MX", t("GT110"))).toBe(true);
    expect(coincide("GT143-NAVY-26-MX", t("GT110"))).toBe(false);
  });

  it("no distingue mayúsculas", () => {
    expect(coincide("GT110-NAVY-26-MX", t("gt110"))).toBe(true);
  });

  it("exige todas las palabras, en cualquier orden", () => {
    expect(coincide("GT110-NAVY-26-MX", t("gt110 navy"))).toBe(true);
    expect(coincide("GT110-NAVY-26-MX", t("navy gt110"))).toBe(true);
    expect(coincide("GT110-NAVY-26-MX", t("gt110 cream"))).toBe(false);
  });

  it("encuentra colores con espacio", () => {
    expect(coincide("GT135-DK BROWN-25-MX", t("dk brown"))).toBe(true);
    expect(coincide("GT135-DK BROWN-25-MX", t("brown dk 25"))).toBe(true);
  });

  it("ignora espacios de más", () => {
    expect(coincide("GT110-NAVY-26-MX", t("  gt110   navy  "))).toBe(true);
  });
});
