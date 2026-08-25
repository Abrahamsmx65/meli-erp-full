import { describe, expect, it } from "vitest";
import {
  armarPedidoColor,
  faltantesPorRegimen,
  paresPorCajaNormalizado,
  repartirCorrida,
} from "./compras";

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

  it("las unitallas se separan con el faltante EXACTO, no con el amortiguado", () => {
    // El régimen amortiguado infla el faltante de la talla 26 (por el 70%),
    // pero para cajas COMPLETAS de una talla el número exacto manda: 26 solo
    // justifica 10 cajas exactas (240 pares), no las 20 del amortiguado.
    const amortiguado = { "24": 1200, "25": 1200, "26": 480 };
    const exacto = { "24": 1200, "25": 1200, "26": 240 };
    const p = armarPedidoColor(amortiguado, 24, exacto);
    expect(p.unitallas.find((u) => u.talla === "26")?.cajas).toBe(10);
  });
});

describe("pares por caja normalizados (12/24/36/48)", () => {
  it("respeta los totales históricos que ya caen en el set", () => {
    for (const t of [12, 24, 36, 48]) expect(paresPorCajaNormalizado(t)).toBe(t);
  });

  it("lleva el histórico al valor más cercano del set", () => {
    expect(paresPorCajaNormalizado(20)).toBe(24);
    expect(paresPorCajaNormalizado(26)).toBe(24);
    expect(paresPorCajaNormalizado(40)).toBe(36);
    expect(paresPorCajaNormalizado(100)).toBe(48);
    expect(paresPorCajaNormalizado(6)).toBe(12);
  });

  it("en empate gana la caja más grande", () => {
    expect(paresPorCajaNormalizado(30)).toBe(36);
    expect(paresPorCajaNormalizado(18)).toBe(24);
    expect(paresPorCajaNormalizado(42)).toBe(48);
  });
});

describe("regímenes de reposición (B: umbral 100 días, descuento 70%)", () => {
  const base = {
    demandaPorTalla: new Map([
      ["24", 2],
      ["25", 4],
    ]),
    inventarioPorTalla: new Map([
      ["24", 300],
      ["25", 0],
    ]),
    horizonte: 180,
    umbralAgotamientoDias: 100,
    descuentoStock: 0.7,
  };

  it("con cobertura corta (< 100 días) el stock se descuenta COMPLETO", () => {
    // 300 pares / 6 al día = 50 días de cobertura < 100 → se agota. El stock
    // se venderá antes de que llegue el pedido, pero cubre la primera parte
    // del horizonte: IGNORARLO (comportamiento viejo) pedía 360 pares
    // teniendo 300 — 6× lo necesario y el contenedor todavía en el barco.
    const r = faltantesPorRegimen({ ...base, coberturaDias: 50 });
    expect(r.regimen).toBe("se_agota");
    expect(r.faltantePorTalla["24"]).toBe(2 * 180 - 300);
    expect(r.faltantePorTalla["25"]).toBe(4 * 180);
  });

  it("con cobertura larga el stock se descuenta al 70%", () => {
    const r = faltantesPorRegimen({ ...base, coberturaDias: 150 });
    expect(r.regimen).toBe("repone");
    expect(r.faltantePorTalla["24"]).toBe(Math.round(2 * 180 - 0.7 * 300));
    expect(r.faltantePorTalla["25"]).toBe(4 * 180);
  });

  it("el faltante EXACTO siempre descuenta el stock completo, en ambos regímenes", () => {
    const corto = faltantesPorRegimen({ ...base, coberturaDias: 50 });
    const largo = faltantesPorRegimen({ ...base, coberturaDias: 150 });
    for (const r of [corto, largo]) {
      expect(r.faltanteExactoPorTalla["24"]).toBe(2 * 180 - 300);
      expect(r.faltanteExactoPorTalla["25"]).toBe(4 * 180);
    }
  });

  it("una talla con más stock que demanda no pide nada en ningún faltante", () => {
    const r = faltantesPorRegimen({
      ...base,
      inventarioPorTalla: new Map([
        ["24", 5000],
        ["25", 0],
      ]),
      coberturaDias: 500,
    });
    expect(r.faltantePorTalla["24"]).toBeUndefined();
    expect(r.faltanteExactoPorTalla["24"]).toBeUndefined();
  });
});

describe("opción 2: pedido solo según la venta (sin descontar stock)", () => {
  it("la corrida solo-venta sigue a la demanda del horizonte aunque haya stock de sobra", () => {
    // Misma demanda por talla, stock enorme: la opción 1 no pediría nada,
    // la opción 2 pide la venta completa del horizonte. La demanda ya viene
    // corregida por agotamientos, así que una talla en cero con venta
    // estimada también entra.
    const demandaHorizonte = { "25": 120, "26": 60, "27": 60 };
    const pedido = armarPedidoColor(demandaHorizonte, 24, demandaHorizonte);
    const cajas =
      pedido.cajasCorrida + pedido.unitallas.reduce((a, u) => a + u.cajas, 0);
    expect(cajas).toBe(Math.ceil(240 / 24));
    // El reparto de la caja respeta la proporción de venta (12/6/6 en 24).
    expect(pedido.corridaPropuesta).toEqual({ "25": 12, "26": 6, "27": 6 });
  });
});
