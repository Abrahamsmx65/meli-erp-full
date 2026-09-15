import { describe, expect, it } from "vitest";
import { agruparGemelas, llevaPrefijoNC, sumarPorPrincipal } from "./gemelas";

describe("gemelas", () => {
  it("la N- es la principal aunque las dos estén activas o pausadas", () => {
    const g = agruparGemelas([
      { sku: "462-A57", estado: "active" },
      { sku: "N-462-A57", estado: "active" },
      { sku: "462-A07", estado: "paused" },
      { sku: "N-462-A07", estado: "paused" },
    ]);
    expect(g.principalDe.get("462-A57")).toBe("N-462-A57");
    expect(g.principalDe.get("N-462-A57")).toBe("N-462-A57");
    expect(g.principalDe.get("462-A07")).toBe("N-462-A07");
    expect(g.absorbidas.get("N-462-A57")).toEqual(["462-A57"]);
  });

  it("una N- cerrada en MELI ya no manda: gana la que sigue viva", () => {
    const g = agruparGemelas([
      { sku: "N-462-A55", estado: "closed" },
      { sku: "462-A55", estado: "active" },
    ]);
    expect(g.principalDe.get("N-462-A55")).toBe("462-A55");
  });

  it("guiones y mayúsculas distintas también son gemelas; sin gemela, cada quien es su principal", () => {
    const g = agruparGemelas([{ sku: "462-Rmn13pro-4G", estado: "paused" }, { sku: "N-462-Rmn13pro-4g", estado: "active" }, { sku: "499-i17promax" }]);
    expect(g.principalDe.get("462-Rmn13pro-4G")).toBe("N-462-Rmn13pro-4g");
    expect(g.principalDe.get("499-i17promax")).toBe("499-i17promax");
    expect(g.absorbidas.has("499-i17promax")).toBe(false);
  });

  it("N antes que C; un 462-A52 y un 462-A52-purple NO son gemelas", () => {
    const g = agruparGemelas([{ sku: "C-675-A17" }, { sku: "N-675-A17" }, { sku: "462-A52" }, { sku: "462-A52-purple" }]);
    expect(g.principalDe.get("C-675-A17")).toBe("N-675-A17");
    expect(g.principalDe.get("462-A52-purple")).toBe("462-A52-purple");
  });

  it("suma bajo la principal", () => {
    const g = agruparGemelas([{ sku: "462-A57" }, { sku: "N-462-A57" }]);
    const m = sumarPorPrincipal(g, new Map([["462-A57", 160], ["N-462-A57", 2], ["499-i15", 5]]));
    expect(m.get("N-462-A57")).toBe(162);
    expect(m.has("462-A57")).toBe(false);
    expect(m.get("499-i15")).toBe(5);
  });

  it("reconoce el prefijo suelto", () => {
    expect(llevaPrefijoNC("N-462-A57")).toBe(true);
    expect(llevaPrefijoNC("462N-A57")).toBe(true);
    expect(llevaPrefijoNC("462-A57")).toBe(false);
    expect(llevaPrefijoNC("CH-650-i16promax")).toBe(false);
  });
});
