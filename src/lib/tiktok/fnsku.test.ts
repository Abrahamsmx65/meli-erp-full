import { describe, expect, it } from "vitest";
import { claveComparacion } from "../importar/sku";
import { indexarAlias, resolverFnsku } from "./fnsku";

const amazon = new Map<string, any>([
  [claveComparacion("MY2304-BROWN-27-MX"), { fnsku: "X003RBE6YB" }],
  [claveComparacion("GT134-BLK-24-MX"), { fnsku: "X004KYMZZ1" }],
]);

describe("resolverFnsku", () => {
  const alias = indexarAlias([{ modelo: "MY2304", colorTikTok: "camel", colorAmazon: "BROWN" }]);
  it("directo cuando Amazon tiene el SKU tal cual", () => {
    expect(resolverFnsku(amazon, alias, "GT134-BLK-24-MX")).toBe("X004KYMZZ1");
  });
  it("CAMEL en TikTok → BROWN en Amazon por la equivalencia del modelo", () => {
    expect(resolverFnsku(amazon, alias, "MY2304-CAMEL-27-MX")).toBe("X003RBE6YB");
    expect(resolverFnsku(amazon, alias, "MY2304-CAMEL-27")).toBe("X003RBE6YB");
  });
  it("sin equivalencia o talla que Amazon no tiene: null, nunca se inventa", () => {
    expect(resolverFnsku(amazon, alias, "MY2304-CAMEL-25-MX")).toBeNull();
    expect(resolverFnsku(amazon, new Map(), "MY2304-CAMEL-27-MX")).toBeNull();
    expect(resolverFnsku(amazon, alias, "GT150-CAMEL-27-MX")).toBeNull();
  });
});
