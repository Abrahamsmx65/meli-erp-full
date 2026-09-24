import { describe, expect, it } from "vitest";
import { aliasParaIndusther, paresDeSalidas, referenciaDeLote } from "./tiktok-3pl";
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

describe("referenciaDeLote", () => {
  it("es única por lote (la primera salida) y distingue corte de reintento", () => {
    expect(referenciaDeLote(68, 1001)).toBe("TT-CORTE-68-1001");
    expect(referenciaDeLote(68, 1501)).toBe("TT-CORTE-68-1501");
    expect(referenciaDeLote(null, 1501)).toBe("TT-REINTENTO-1501");
  });
});

describe("paresDeSalidas", () => {
  it("cuenta PARES, no renglones: 683 renglones con 13 de dos pares son 696 (corte #38, 24-sep-2026)", () => {
    const renglones = [
      ...Array.from({ length: 670 }, () => ({ pares: 1 })),
      ...Array.from({ length: 13 }, () => ({ pares: 2 })),
    ];
    expect(renglones).toHaveLength(683);
    expect(paresDeSalidas(renglones)).toBe(696);
    expect(paresDeSalidas([{ pares: null }, { pares: undefined }, { pares: 3 }])).toBe(3);
  });
});
