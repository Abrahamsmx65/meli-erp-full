import { describe, expect, it } from "vitest";
import { aliasDe, armarMapaAlias, claveAlias, colorEfectivo } from "./alias-color";

describe("alias de color del pedido → MELI", () => {
  const mapa = armarMapaAlias([
    { modelo: "gt074", color: "NAVY (AZUL MARINO)", color_meli: "BLUE", color_pedido: "NAVY (AZUL MARINO)" },
    { modelo: "MY2307", color: "GREY BLUE", color_meli: null, color_pedido: "GREY BLUE" },
  ]);

  it("la clave no depende de mayúsculas, espacios ni paréntesis", () => {
    expect(claveAlias("GT074", "navy (azul marino)")).toBe("GT074|NAVYAZULMARINO");
    expect(claveAlias("gt074", "NAVY-AZUL-MARINO")).toBe(claveAlias("GT074", "NAVY (AZUL MARINO)"));
  });

  it("traduce el color ligado y deja igual lo demás", () => {
    expect(colorEfectivo(mapa, "GT074", "NAVY (AZUL MARINO)")).toBe("BLUE");
    expect(colorEfectivo(mapa, "GT074", "BLK")).toBe("BLK");
    expect(colorEfectivo(mapa, "GT999", "NAVY (AZUL MARINO)")).toBe("NAVY (AZUL MARINO)");
    expect(colorEfectivo(null, "GT074", "NAVY (AZUL MARINO)")).toBe("NAVY (AZUL MARINO)");
  });

  it("un color confirmado como nuevo se reconoce pero no se traduce", () => {
    expect(aliasDe(mapa, "MY2307", "GREY BLUE")?.colorMeli).toBeNull();
    expect(colorEfectivo(mapa, "MY2307", "GREY BLUE")).toBe("GREY BLUE");
  });

  it("descarta filas sin modelo o sin color", () => {
    const m = armarMapaAlias([{ modelo: "", color: "BLK", color_meli: "BLK", color_pedido: "BLK" }]);
    expect(m.size).toBe(0);
  });
});
