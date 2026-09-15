import { describe, expect, it } from "vitest";
import { aliasParaIndusther } from "./tiktok-3pl";
import { claveComparacion } from "../importar/sku";

describe("aliasParaIndusther", () => {
  it("lleva el SKU del ERP al nombre que Industher usa en su bodega TikTok; otras bodegas no cuentan", () => {
    const alias = aliasParaIndusther([
      { sku_caja: "GT134-NAVY / RED-25-MX", almacen: "TikTok" },
      { sku_caja: "GT134-BLK-24-MX", almacen: "Tik Tok" },
      { sku_caja: "GT150-CAMEL-25", almacen: "Caseshop" },
    ]);
    expect(alias.get(claveComparacion("GT134-NAVY-RED-25-MX"))).toBe("GT134-NAVY / RED-25-MX");
    expect(alias.get(claveComparacion("GT134-BLK-24-MX"))).toBe("GT134-BLK-24-MX");
    expect(alias.get(claveComparacion("GT150-CAMEL-25"))).toBeUndefined();
  });
});
