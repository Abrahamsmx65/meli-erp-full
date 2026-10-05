import { describe, expect, it } from "vitest";
import { pendientePorLinea } from "./pendiente-china";

describe("lo que falta de un pedido a China", () => {
  it("un pedido que la bodega no conoce cuenta completo", () => {
    const r = pendientePorLinea([{ id: 1, modelo: "GT217", pares: 3600, cajas: 150, cajasRecibidas: 0 }], null);
    expect(r.get(1)).toBe(3600);
  });

  it("IN10079: lo recibido en contenedores sale, lo que sigue en el mar o en China cuenta", () => {
    const r = pendientePorLinea(
      [
        { id: 1, modelo: "GT217", pares: 3600, cajas: 150, cajasRecibidas: 50 },
        { id: 2, modelo: "GT148", pares: 2400, cajas: 100, cajasRecibidas: 0 },
      ],
      // La bodega no tiene el GT217 bajo este pedido; del GT148 ya tiene 1,000 físicos.
      new Map([["GT148", { fisico: 1000, enCamino: 200 }]]),
    );
    expect(r.get(1)).toBe(2400);
    // 2,400 − máx(0 por contenedor, 1,000 físicos) − 200 que la bodega ya cuenta en camino.
    expect(r.get(2)).toBe(1200);
  });

  it("un pedido que ya llegó completo no suma nada, aunque siga abierto", () => {
    const r = pendientePorLinea([{ id: 1, modelo: "GT120", pares: 6480, cajas: 270, cajasRecibidas: 0 }], new Map([["GT120", { fisico: 6480, enCamino: 0 }]]));
    expect(r.get(1)).toBe(0);
  });

  it("reparte el pendiente del modelo entre sus renglones según lo que le falta a cada uno", () => {
    const r = pendientePorLinea(
      [
        { id: "a", modelo: "GT150", pares: 1000, cajas: 40, cajasRecibidas: 40 },
        { id: "b", modelo: "GT150", pares: 1000, cajas: 40, cajasRecibidas: 0 },
      ],
      new Map(),
    );
    expect(r.get("a")).toBe(0);
    expect(r.get("b")).toBe(1000);
  });
});
