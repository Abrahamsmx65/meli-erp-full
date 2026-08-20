import { describe, expect, it } from "vitest";
import { armarPedidoColor, repartirCorrida } from "./compras";

describe("corrida propuesta", () => {
  it("reparte los pares de la caja en proporción al faltante y suma exacto", () => {
    const corrida = repartirCorrida({ "24": 300, "25": 300, "26": 600 }, 24);
    expect(Object.values(corrida).reduce((a, b) => a + b, 0)).toBe(24);
    expect(corrida["26"]).toBe(12);
    expect(corrida["24"]).toBe(6);
    expect(corrida["25"]).toBe(6);
  });

  it("una talla sin faltante no entra a la corrida", () => {
    const corrida = repartirCorrida({ "24": 100, "25": 0 }, 24);
    expect(corrida["25"]).toBeUndefined();
    expect(corrida["24"]).toBe(24);
  });
});

describe("reglas de unitalla", () => {
  it("pedido chico: todo va en corrida aunque una talla pese mucho", () => {
    // 50 cajas totales (< 100): sin unitallas.
    const p = armarPedidoColor({ "25": 800, "26": 400 }, 24);
    expect(p.unitallas).toHaveLength(0);
    expect(p.cajasCorrida).toBe(Math.ceil(1200 / 24));
  });

  it("pedido grande: la talla que justifica 10+ cajas se separa como unitalla", () => {
    // Total 2640 pares = 110 cajas (>= 100). La talla 26 pide 480 pares =
    // 20 cajas unitalla; el resto va en corrida.
    const p = armarPedidoColor({ "24": 1080, "25": 1080, "26": 480 }, 24);
    const uni26 = p.unitallas.find((u) => u.talla === "26");
    expect(uni26?.cajas).toBe(20);
    // Las tallas 24 y 25 también superan 10 cajas cada una: también unitalla.
    expect(p.unitallas.find((u) => u.talla === "24")?.cajas).toBe(45);
    expect(p.unitallas.find((u) => u.talla === "25")?.cajas).toBe(45);
    expect(p.cajasCorrida).toBe(0);
  });

  it("los pares no se pierden ni se duplican al separar unitallas", () => {
    const faltante = { "23": 500, "24": 2000, "25": 900, "26": 100 };
    const total = Object.values(faltante).reduce((a, b) => a + b, 0);
    const p = armarPedidoColor(faltante, 24);
    const paresPedidos =
      p.cajasCorrida * 24 + p.unitallas.reduce((a, u) => a + u.cajas * 24, 0);
    // Se pide al menos el faltante y a lo más una caja extra por el redondeo.
    expect(paresPedidos).toBeGreaterThanOrEqual(total);
    expect(paresPedidos).toBeLessThan(total + 24 * 2);
  });
});
