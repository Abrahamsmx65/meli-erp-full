import { describe, expect, it } from "vitest";
import { modelosDeContenedor } from "./contenedores";

describe("qué viene en un contenedor", () => {
  it("agrupa por modelo + color, suma cajas y deriva pares de la receta del pedido", () => {
    const modelos = modelosDeContenedor([
      { modelo: "GT114", color: "BLK", cajas: 10, paresPorCaja: 12 },
      { modelo: "gt114", color: "blk", cajas: 5, paresPorCaja: 12 },
      { modelo: "GT114", color: "BROWN", cajas: 3, paresPorCaja: 12 },
      { modelo: "GT104-1", color: null, cajas: 2, paresPorCaja: 0 },
      { modelo: "GT999", color: "RED", cajas: 0, paresPorCaja: 12 },
    ]);
    expect(modelos).toEqual([
      { modelo: "GT104-1", color: "", cajas: 2, pares: 0 },
      { modelo: "GT114", color: "BLK", cajas: 15, pares: 180 },
      { modelo: "GT114", color: "BROWN", cajas: 3, pares: 36 },
    ]);
  });
});
