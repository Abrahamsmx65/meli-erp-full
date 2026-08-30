import { describe, expect, it } from "vitest";
import { indexarCatalogo } from "../etiquetas/resolver";
import { amarrarSkuTikTok } from "./amarre";

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
