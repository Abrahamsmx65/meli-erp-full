import { describe, expect, it } from "vitest";
import { configDeSku, costoDeSkuUnificado, modeloUnificado, soloCostos, type MapaCostos } from "./costos-unificados";

describe("modeloUnificado", () => {
  it("saca el modelo de calzado o el diseño de la funda", () => {
    expect(modeloUnificado("GT114-NEGRO-25")).toBe("GT114");
    expect(modeloUnificado("G650-BLK-26-MX")).toBe("G650");
    expect(modeloUnificado("MY2304-PURPLE-23")).toBe("MY2304");
    expect(modeloUnificado("437-RmPad-2-navy")).toBe("437");
    expect(modeloUnificado("499-IP15PM")).toBe("499");
    expect(modeloUnificado("N-462-A06")).toBe("462");
    expect(modeloUnificado("499N-A06")).toBe("499");
    expect(modeloUnificado("glass-A53")).toBe("GLASS");
    expect(modeloUnificado("")).toBe("");
  });
});

describe("configDeSku", () => {
  const mapa: MapaCostos = new Map([
    ["GT114", { categoria: "Corcho", costo: 60 }],
    ["499", { categoria: "Fundas", costo: 26.6 }],
    ["380", { categoria: "Fundas", costo: 50 }],
    ["380-CHICO", { categoria: "Fundas", costo: 59.4 }],
    ["462", { categoria: null, costo: 10.9 }],
  ]);

  it("amarra calzado y fundas al mismo mapa", () => {
    expect(costoDeSkuUnificado("GT114-NEGRO-25", mapa)).toBe(60);
    expect(costoDeSkuUnificado("499-IP15PM", mapa)).toBe(26.6);
    expect(costoDeSkuUnificado("N-462-A06", mapa)).toBe(10.9);
    expect(costoDeSkuUnificado("499N-A06", mapa)).toBe(26.6);
    expect(costoDeSkuUnificado("GT999-BLK-25", mapa)).toBeNull();
    expect(configDeSku("GT114-NEGRO-25", mapa)?.categoria).toBe("Corcho");
  });

  it("la clave completa le gana al diseño (380-CHICO vs 380)", () => {
    expect(costoDeSkuUnificado("380-CHICO", mapa)).toBe(59.4);
    expect(costoDeSkuUnificado("380-GRANDE", mapa)).toBe(50);
  });

  it("soloCostos deja fuera lo que no tiene costo", () => {
    const m = soloCostos(new Map([["A", { categoria: "x", costo: null }], ["B", { categoria: null, costo: 5 }]]));
    expect([...m.entries()]).toEqual([["B", 5]]);
  });
});
