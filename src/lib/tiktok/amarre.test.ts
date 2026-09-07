import { describe, expect, it } from "vitest";
import { indexarCatalogo } from "../etiquetas/resolver";
import { amarrarSkuTikTok, pareceSkuDeCalzado } from "./amarre";

const indice = indexarCatalogo([
  { sku: "GT135-DK BROWN-26" },
  { sku: "GT128-BEIGE-24" },
]);

describe("amarrarSkuTikTok", () => {
  it("amarra igual", () => {
    const a = amarrarSkuTikTok("GT128-BEIGE-24", indice, new Map());
    expect(a).toEqual({ skuInterno: "GT128-BEIGE-24", origen: "exacto" });
  });

  it("ignora el sufijo de país y los espacios del color", () => {
    expect(amarrarSkuTikTok("gt135-dkbrown-26-MX", indice, new Map()).skuInterno).toBe(
      "GT135-DK BROWN-26",
    );
  });

  it("aguanta la talla antes del color, como en Amazon", () => {
    expect(amarrarSkuTikTok("GT128-24-BEIGE", indice, new Map())).toEqual({
      skuInterno: "GT128-BEIGE-24",
      origen: "ordenado",
    });
  });

  it("el mapeo manual gana sobre todo lo demás", () => {
    const manual = new Map([["GT128-BEIGE-24", "GT135-DK BROWN-26"]]);
    expect(amarrarSkuTikTok("GT128-BEIGE-24", indice, manual)).toEqual({
      skuInterno: "GT135-DK BROWN-26",
      origen: "manual",
    });
  });

  it("lo que no cuadra se queda sin amarrar, no se inventa", () => {
    expect(amarrarSkuTikTok("ALGO-RARO-99", indice, new Map())).toEqual({
      skuInterno: null,
      origen: null,
    });
    expect(amarrarSkuTikTok("", indice, new Map()).skuInterno).toBeNull();
    expect(amarrarSkuTikTok(null, indice, new Map()).skuInterno).toBeNull();
  });
});

describe("SKU propio de TikTok (no está en MELI)", () => {
  it("un MODELO-COLOR-TALLA que MELI no tiene se acepta tal cual, como propio", () => {
    expect(amarrarSkuTikTok("MY2304-PURPLE-25-MX", indice, new Map())).toEqual({ skuInterno: "MY2304-PURPLE-25-MX", origen: "propio" });
    expect(amarrarSkuTikTok("gt134-navy / red-24-mx", indice, new Map())).toEqual({ skuInterno: "GT134-NAVY / RED-24-MX", origen: "propio" });
  });
  it("lo que no tiene forma de calzado se queda sin amarrar", () => {
    expect(amarrarSkuTikTok("caja-regalo", indice, new Map())).toEqual({ skuInterno: null, origen: null });
    expect(pareceSkuDeCalzado("GT150-Camel-MX26")).toBe(false);
    expect(pareceSkuDeCalzado("MY2304-PURPLE-25")).toBe(true);
  });
});
