import { describe, expect, it } from "vitest";
import { armarEtiquetasYz, datosDeEtiquetaYz, varianteFunda } from "./etiquetas";

const catalogo = [
  { sku: "499-IP15PM-BLK", inventory_id: "QPLW61342", titulo: "Funda 499 iPhone 15 Pro Max", modelo: "IP15PM", color: "BLK" },
  { sku: "501-A54", inventory_id: null, titulo: "Funda 501 Samsung A54", modelo: "A54", color: null },
  { sku: "601-iPad10", inventory_id: "ABCD12345", titulo: "Funda iPad 10", modelo: "IPAD10", color: null },
];

describe("armarEtiquetasYz", () => {
  it("amarra exacto, sin sufijo de sitio y aplastado", () => {
    const r = armarEtiquetasYz(catalogo, [
      { sku: "499-IP15PM-BLK", cantidad: 3 },
      { sku: "499-ip15pm-blk-mx", cantidad: 2 },
      { sku: "601IPAD10", cantidad: 1 },
    ]);
    expect(r.map((e) => [e.sku, e.codigoFull, e.cantidad])).toEqual([
      ["499-IP15PM-BLK", "QPLW61342", 3],
      ["499-IP15PM-BLK", "QPLW61342", 2],
      ["601-iPad10", "ABCD12345", 1],
    ]);
    expect(r[0].variante).toBe("IP15PM - BLK");
    expect(r[0].problema).toBeNull();
    expect(r[0].fnsku).toBeNull();
  });

  it("declara lo que no tiene código Full o no está en el catálogo", () => {
    const r = armarEtiquetasYz(catalogo, [
      { sku: "501-A54", cantidad: 1 },
      { sku: "999-NADA", cantidad: 1 },
    ]);
    expect(r[0].codigoFull).toBeNull();
    expect(r[0].problema).toMatch(/código Full/);
    expect(r[1].problema).toMatch(/no está en el catálogo/);
  });

  it("ignora renglones sin SKU o sin cantidad y topa en 999", () => {
    const r = armarEtiquetasYz(catalogo, [
      { sku: "", cantidad: 5 },
      { sku: "499-IP15PM-BLK", cantidad: 0 },
      { sku: "499-IP15PM-BLK", cantidad: 5000 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].cantidad).toBe(999);
  });
});

describe("datosDeEtiquetaYz", () => {
  it("arma el bloque de MELI con el SKU al pie", () => {
    const [e] = armarEtiquetasYz(catalogo, [{ sku: "499-IP15PM-BLK", cantidad: 4 }]);
    expect(datosDeEtiquetaYz(e)).toEqual({
      codigo: "QPLW61342",
      titulo: "Funda 499 iPhone 15 Pro Max",
      variante: "IP15PM - BLK",
      pie: "SKU: 499-IP15PM-BLK",
      cantidad: 4,
    });
  });
});

describe("varianteFunda", () => {
  it("junta modelo y color, y no deja guiones sueltos", () => {
    expect(varianteFunda("IP15PM", "BLK")).toBe("IP15PM - BLK");
    expect(varianteFunda("A54", null)).toBe("A54");
    expect(varianteFunda(null, null)).toBe("");
  });
});
