import { describe, expect, it } from "vitest";
import { diasDelMes, mesSiguiente, mesesDelFijo, proporcionDelMes } from "./gastos-fijos";

describe("meses de un gasto fijo", () => {
  it("va del mes de alta hasta el tope, sin pasar de su baja", () => {
    expect(mesesDelFijo({ desde: "2026-08", hasta: null }, "2026-10")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(mesesDelFijo({ desde: "2026-08", hasta: "2026-09" }, "2026-12")).toEqual(["2026-08", "2026-09"]);
    expect(mesesDelFijo({ desde: "2026-11", hasta: null }, "2026-10")).toEqual([]);
  });

  it("cruza de año", () => {
    expect(mesSiguiente("2026-12")).toBe("2027-01");
    expect(mesSiguiente("2026-01", -1)).toBe("2025-12");
    expect(mesesDelFijo({ desde: "2026-11", hasta: null }, "2027-02")).toHaveLength(4);
  });
});

describe("proporción del mes que cuenta (mes en curso proporcional a los días)", () => {
  it("un mes cerrado y completo cuenta entero", () => {
    expect(proporcionDelMes("2026-09", "2026-09-01", "2026-09-30", "2026-10-09")).toBe(1);
  });

  it("el mes en curso cuenta lo transcurrido, sin pasar de hoy", () => {
    // 9 de octubre: 9 de 31 días, aunque el rango pida el mes completo.
    expect(proporcionDelMes("2026-10", "2026-10-01", "2026-10-31", "2026-10-09")).toBeCloseTo(9 / 31);
  });

  it("los «mismos días» del mes anterior cuentan esos días", () => {
    expect(proporcionDelMes("2026-09", "2026-09-01", "2026-09-09", "2026-10-09")).toBeCloseTo(9 / 30);
  });

  it("un solo día es una parte del mes y un rango fuera del mes no cuenta", () => {
    expect(proporcionDelMes("2026-02", "2026-02-10", "2026-02-10", "2026-10-09")).toBeCloseTo(1 / diasDelMes("2026-02"));
    expect(proporcionDelMes("2026-09", "2026-10-01", "2026-10-05", "2026-10-09")).toBe(0);
  });
});
