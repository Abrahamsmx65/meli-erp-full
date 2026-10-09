import { describe, expect, it } from "vitest";
import { ajustesDelPeriodo, diaMxDeSegundos, interpretarEstados, unirEstados } from "./estados-cuenta";

// 2026-09-30 23:30 de México = 2026-10-01 05:30 UTC
const FIN_SEP_MX = Date.UTC(2026, 9, 1, 5, 30) / 1000;
const MITAD_SEP = Date.UTC(2026, 8, 15, 12) / 1000;

describe("estados de cuenta de TikTok", () => {
  it("lee la forma del SDK (statements[] con montos en texto) y el día en hora de México", () => {
    const e = interpretarEstados({
      next_page_token: "x",
      statements: [
        { id: "7693710971541407489", statement_time: FIN_SEP_MX, settlement_amount: "12345.67", revenue_amount: "15000", fee_amount: "-2500.33", shipping_cost_amount: "-100", adjustment_amount: "-54.00", payment_status: "PAID", currency: "MXN" },
        { id: "sin-fecha" },
      ],
    });
    expect(e).toEqual([
      { id: "7693710971541407489", fecha: FIN_SEP_MX, dia: "2026-09-30", liquidado: 12345.67, ingreso: 15000, cargos: -2500.33, envio: -100, ajustes: -54, estadoPago: "PAID" },
    ]);
    expect(diaMxDeSegundos(FIN_SEP_MX)).toBe("2026-09-30");
  });

  it("suma los ajustes del periodo por la fecha del estado, con su signo", () => {
    const estados = interpretarEstados({
      statements: [
        { id: "a", statement_time: MITAD_SEP, settlement_amount: "1000", adjustment_amount: "-120.5" },
        { id: "b", statement_time: FIN_SEP_MX, settlement_amount: "500", adjustment_amount: "20" },
        { id: "c", statement_time: FIN_SEP_MX + 86_400, settlement_amount: "700", adjustment_amount: "-999" },
      ],
    });
    expect(ajustesDelPeriodo(estados, "2026-09-01", "2026-09-30")).toEqual({
      estados: 2,
      liquidado: 1500,
      ajustes: -100.5,
      conAjuste: [
        { dia: "2026-09-15", id: "a", ajustes: -120.5 },
        { dia: "2026-09-30", id: "b", ajustes: 20 },
      ],
    });
  });

  it("al releer, la versión nueva de un estado reemplaza a la vieja", () => {
    const [viejo] = interpretarEstados({ statements: [{ id: "a", statement_time: MITAD_SEP, adjustment_amount: "0", payment_status: "PROCESSING" }] });
    const [nuevo] = interpretarEstados({ statements: [{ id: "a", statement_time: MITAD_SEP, adjustment_amount: "-5", payment_status: "PAID" }] });
    expect(unirEstados([viejo], [nuevo])).toEqual([nuevo]);
  });
});
