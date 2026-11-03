import { describe, expect, it } from "vitest";
import { contenidoPorModelo, ordenarPorId } from "./contenedores-vista";

describe("contenido por modelo y orden por ID (11-oct-2026)", () => {
  it("agrupa por modelo con sus colores, en orden natural", () => {
    const r = contenidoPorModelo([
      { modelo: "GT1040", color: "BLK", cajas: 5 },
      { modelo: "GT114", color: "DK BROWN", cajas: 20, foto: "https://x/114.jpg" },
      { modelo: "GT114", color: "BLK", cajas: 30 },
      { modelo: "GT99", color: "CREAM", cajas: 10 },
      { modelo: "GT114", color: "PINK", cajas: 0 },
    ]);
    expect(r.map((m) => m.modelo)).toEqual(["GT99", "GT114", "GT1040"]);
    expect(r[1]).toEqual({
      modelo: "GT114",
      foto: "https://x/114.jpg",
      cajas: 50,
      colores: [
        { color: "BLK", cajas: 30 },
        { color: "DK BROWN", cajas: 20 },
      ],
    });
  });

  it("los contenedores van por nuestro ID: S99 antes de S100, S259 antes de S260-2026", () => {
    const r = ordenarPorId([{ numero: "S260-2026" }, { numero: "S100" }, { numero: "S259" }, { numero: "S99" }]);
    expect(r.map((c) => c.numero)).toEqual(["S99", "S100", "S259", "S260-2026"]);
  });
});
