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
  it("una talla con menos de 5 cajas no se separa: va en corrida", () => {
    // 25 pide 4 cajas justas (96/24) y 26 ni una: todo en corrida.
    const p = armarPedidoColor({ "25": 96, "26": 40 }, 24);
    expect(p.unitallas).toHaveLength(0);
    expect(p.cajasCorrida).toBe(Math.ceil(136 / 24));
  });

  it("la talla que justifica 5+ cajas se separa como unitalla", () => {
    const p = armarPedidoColor({ "24": 1080, "25": 1080, "26": 480 }, 24);
    const uni26 = p.unitallas.find((u) => u.talla === "26");
    expect(uni26?.cajas).toBe(20);
    // Las tallas 24 y 25 también superan 5 cajas cada una: también unitalla.
    expect(p.unitallas.find((u) => u.talla === "24")?.cajas).toBe(45);
    expect(p.unitallas.find((u) => u.talla === "25")?.cajas).toBe(45);
    expect(p.cajasCorrida).toBe(0);
  });

  it("sin mínimo por color: un pedido chico también separa unitallas", () => {
    // El color entero pide 12 cajas (< 100, la vieja regla lo bloqueaba):
    // la 26 justifica 5 cajas exactas (120/24) y se separa igual; la 24 se
    // queda en corrida con sus 48 pares.
    const p = armarPedidoColor({ "24": 48, "26": 120 }, 24);
    expect(p.unitallas).toEqual([{ talla: "26", cajas: 5 }]);
    expect(p.cajasCorrida).toBe(2);
    expect(p.corridaPropuesta).toEqual({ "24": 24 });
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

  it("las unitallas se separan con el faltante EXACTO, no con el de corrida", () => {
    // Si el faltante de corrida viniera inflado en la talla 26, las cajas
    // COMPLETAS de una talla igual se miden con el número exacto: 26 solo
    // justifica 10 cajas exactas (240 pares), no las 20 del inflado.
    const corrida = { "24": 1200, "25": 1200, "26": 480 };
    const exacto = { "24": 1200, "25": 1200, "26": 240 };
    const p = armarPedidoColor(corrida, 24, exacto);
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

describe("faltante por talla (stock descontado al 100% siempre)", () => {
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
  };

  it("con cobertura corta (< 100 días) el régimen es se_agota, faltante exacto", () => {
    // 300 pares / 6 al día = 50 días de cobertura < 100 → se agota. El stock
    // se venderá antes de que llegue el pedido, pero cubre la primera parte
    // del horizonte: IGNORARLO (comportamiento viejo) pedía 360 pares
    // teniendo 300 — 6× lo necesario y el contenedor todavía en el barco.
    const r = faltantesPorRegimen({ ...base, coberturaDias: 50 });
    expect(r.regimen).toBe("se_agota");
    expect(r.faltantePorTalla["24"]).toBe(2 * 180 - 300);
    expect(r.faltantePorTalla["25"]).toBe(4 * 180);
  });

  it("con cobertura larga TAMBIÉN se descuenta completo (antes era 70%)", () => {
    // El descuento amortiguado fabricaba faltantes fantasma: 30% del stock
    // aparecía como "faltante" en colores con meses de cobertura. Ahora el
    // Pedido 1 cuadra con el Detalle SKU: faltante = demanda − stock.
    const r = faltantesPorRegimen({ ...base, coberturaDias: 150 });
    expect(r.regimen).toBe("repone");
    expect(r.faltantePorTalla["24"]).toBe(2 * 180 - 300);
    expect(r.faltantePorTalla["25"]).toBe(4 * 180);
  });

  it("el faltante EXACTO es el mismo que el de corrida, en ambos regímenes", () => {
    const corto = faltantesPorRegimen({ ...base, coberturaDias: 50 });
    const largo = faltantesPorRegimen({ ...base, coberturaDias: 150 });
    for (const r of [corto, largo]) {
      expect(r.faltanteExactoPorTalla).toEqual(r.faltantePorTalla);
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
    // La 25 justifica 5 cajas exactas y se separa como unitalla; el resto
    // se reparte en corrida a partes iguales (12/12 en 24).
    expect(pedido.unitallas).toEqual([{ talla: "25", cajas: 5 }]);
    expect(pedido.corridaPropuesta).toEqual({ "26": 12, "27": 12 });
  });
});
