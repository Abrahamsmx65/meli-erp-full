import { describe, expect, it } from "vitest";
import { sugerirParecidos } from "./sugerencias";

describe("sugerirParecidos", () => {
  const pubs = [
    "GT150-Negro-MX23",
    "GT150-Camel-MX23",
    "GT150-Negro-MX24",
    "GT151-BLK-23-MX",
    "MY2304-CAMEL-27-MX",
  ];
  it("mismo modelo y misma talla, aunque la talla venga como MX23 y el color en otro idioma", () => {
    expect(sugerirParecidos("GT150-BLK-23-MX", pubs)).toEqual(["GT150-Negro-MX23", "GT150-Camel-MX23"]);
  });
  it("el propio SKU y otros modelos o tallas no salen", () => {
    expect(sugerirParecidos("MY2304-BROWN-27", pubs)).toEqual(["MY2304-CAMEL-27-MX"]);
    expect(sugerirParecidos("GT160-BLK-23", pubs)).toEqual([]);
  });
  it("el del mismo nombre canónico sí se sugiere, y primero (publicación amarrada a otro lado)", () => {
    const conGemelo = ["GT102-NAVY-24-MX", "GT102-WHITE-24-MX"];
    expect(sugerirParecidos("GT102-WHITE-24", conGemelo)).toEqual(["GT102-WHITE-24-MX", "GT102-NAVY-24-MX"]);
    // el idéntico exacto no se sugiere a sí mismo
    expect(sugerirParecidos("GT102-WHITE-24-MX", conGemelo)).toEqual(["GT102-NAVY-24-MX"]);
  });
});
