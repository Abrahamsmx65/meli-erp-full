import { describe, expect, it } from "vitest";
import { detalleModelos, modelosDeContenedor, resumenModelos } from "./contenedores";

describe("una línea por contenedor", () => {
  const modelos = [
    { modelo: "GT148", color: "BLACK", cajas: 250, pares: 6000 },
    { modelo: "GT148", color: "CREAM", cajas: 80, pares: 1920 },
    { modelo: "GT150", color: "DK BROWN", cajas: 120, pares: 2880 },
    { modelo: "GT190", color: "", cajas: 13, pares: 156 },
    { modelo: "GT194", color: "BLACK", cajas: 15, pares: 180 },
  ];

  it("el renglón enseña los modelos DISTINTOS y cuántos quedan fuera", () => {
    expect(resumenModelos(modelos)).toBe("GT148, GT150, GT190 +1");
    expect(resumenModelos(modelos.slice(0, 2))).toBe("GT148");
    expect(resumenModelos([])).toBe("");
  });

  it("el detalle del mouse trae cada modelo con su color, cajas y pares, y los pedidos", () => {
    const texto = detalleModelos({ modelos: modelos.slice(0, 2), pedidos: [{ pedido: "IN10079", cajas: 690 }] });
    expect(texto.split("\n")).toEqual([
      "GT148 BLACK · 250 cajas · 6,000 pares",
      "GT148 CREAM · 80 cajas · 1,920 pares",
      "Pedidos: IN10079 (690)",
    ]);
  });

  it("un modelo sin color ni pares no inventa texto", () => {
    expect(detalleModelos({ modelos: [{ modelo: "GT104-1", color: "", cajas: 2, pares: 0 }], pedidos: [] })).toBe(
      "GT104-1 · 2 cajas",
    );
  });
});

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
