import { describe, expect, it } from "vitest";
import { coincideEnSku, coincideRenglon, normalizarBusqueda } from "./inventario-busqueda";

const r = { skuMeli: "N-462-A57", titulo: "Mica Galaxy A57", diseno: "462", tipo: "Micas", skusBodega: ["462-A57"] };

describe("búsqueda de Bodega fundas", () => {
  it("el filtro mira SKU, título, diseño, tipo y bodega", () => {
    expect(coincideRenglon(r, normalizarBusqueda(" micas "))).toBe(true);
    expect(coincideRenglon(r, normalizarBusqueda("462"))).toBe(true);
    expect(coincideRenglon(r, "")).toBe(true);
    expect(coincideRenglon(r, "499")).toBe(false);
  });

  it("el diseño solo se abre si coincide el SKU, el título o la bodega, no su tipo", () => {
    expect(coincideEnSku(r, "A57")).toBe(true);
    expect(coincideEnSku(r, "GALAXY")).toBe(true);
    expect(coincideEnSku(r, "MICAS")).toBe(false);
    expect(coincideEnSku(r, "")).toBe(false);
  });
});
