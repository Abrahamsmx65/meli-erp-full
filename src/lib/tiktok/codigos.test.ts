import { describe, expect, it } from "vitest";
import { codigosDeProducto, codigosMeliDeSku, indexarCodigosMeli } from "./codigos";

describe("los códigos Full de MELI por SKU", () => {
  // El MISMO zapato se publica en las DOS cuentas de MELI y cada una le da
  // su propio código Full (verificado con GT134-BLK-24-MX: FIEE49194 en
  // calzado y JNQX88982 en la otra cuenta). Los dos valen para ese par.
  const ix = indexarCodigosMeli([
    { sku: "GT134-NAVY-24-MX", inventoryId: "FIEE49194" }, // cuenta de calzado
    { sku: "GT134-NAVY-24", inventoryId: "JNQX88982" }, // la otra cuenta, sin sufijo
    { sku: "501-IP15-BLACK", inventoryId: "MLM33333333" }, // una funda de verdad
    { sku: "GT125-25-BLK-MX", inventoryId: "MLM44444444" }, // pedazos en otro orden
    { sku: "GT200-BLK-25", inventoryId: null },
  ]);

  it("un SKU con código en las DOS cuentas acepta los dos", () => {
    expect(codigosMeliDeSku(ix, "GT134-NAVY-24-MX")).toEqual(["FIEE49194", "JNQX88982"]);
    expect(codigosMeliDeSku(ix, "GT134-NAVY-24")).toEqual(["FIEE49194", "JNQX88982"]);
  });

  it("amarra por clave canónica, ordenada y aplastada; cómo esté escrito el SKU da igual", () => {
    expect(codigosMeliDeSku(ix, "501-IP15-BLACK")).toEqual(["MLM33333333"]);
    // El SKU de TikTok trae color y talla en el orden del ERP; el de MELI, al revés.
    expect(codigosMeliDeSku(ix, "GT125-BLK-25-MX")).toEqual(["MLM44444444"]);
    expect(codigosMeliDeSku(ix, "gt134 navy 24")).toEqual(["FIEE49194", "JNQX88982"]);
  });

  it("un SKU sin código Full o desconocido no trae nada", () => {
    expect(codigosMeliDeSku(ix, "GT200-BLK-25")).toEqual([]);
    expect(codigosMeliDeSku(ix, "GT999-RED-27")).toEqual([]);
    expect(codigosMeliDeSku(new Map(), "GT134-NAVY-24")).toEqual([]);
  });
});

describe("los códigos que dan por bueno un par", () => {
  it("el FNSKU va primero, luego los de MELI, sin repetidos y en mayúsculas", () => {
    expect(codigosDeProducto({ fnsku: "x001abc", codigos: ["mlm1", "MLM1", "MLM2"] })).toEqual([
      "X001ABC",
      "MLM1",
      "MLM2",
    ]);
  });
  it("un par sin nada no se puede verificar", () => {
    expect(codigosDeProducto({ fnsku: null, codigos: [] })).toEqual([]);
    expect(codigosDeProducto({})).toEqual([]);
  });
});
