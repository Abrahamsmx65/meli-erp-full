import { describe, expect, it } from "vitest";
import { codigosDeProducto, codigosMeliDeSku, indexarCodigosMeli } from "./codigos";

describe("los códigos Full de MELI por SKU", () => {
  const ix = indexarCodigosMeli([
    { sku: "GT134-NAVY-24-MX", inventoryId: "MLM11111111" }, // cuenta de calzado
    { sku: "GT134-NAVY-24", inventoryId: "MLM22222222" }, // la misma talla, sin sufijo
    { sku: "501-IP15-BLACK", inventoryId: "MLM33333333" }, // cuenta de fundas
    { sku: "GT125-25-BLK-MX", inventoryId: "MLM44444444" }, // pedazos en otro orden
    { sku: "GT200-BLK-25", inventoryId: null },
  ]);

  it("amarra por clave canónica, ordenada y aplastada", () => {
    expect(codigosMeliDeSku(ix, "GT134-NAVY-24-MX")).toEqual(["MLM11111111", "MLM22222222"]);
    expect(codigosMeliDeSku(ix, "GT134-NAVY-24")).toEqual(["MLM11111111", "MLM22222222"]);
    expect(codigosMeliDeSku(ix, "501-IP15-BLACK")).toEqual(["MLM33333333"]);
    // El SKU de TikTok trae color y talla en el orden del ERP; el de MELI, al revés.
    expect(codigosMeliDeSku(ix, "GT125-BLK-25-MX")).toEqual(["MLM44444444"]);
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
