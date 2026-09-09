import { describe, expect, it } from "vitest";
import { sumarResumen, type Totales } from "./ventas";

const vacio = (): Totales => ({
  unidades: 0, ordenes: 0, importe: 0, comision: 0, neto: 0, costo: 0, ganancia: 0,
  unidadesSinNeto: 0, ventaSinNeto: 0, unidadesSinCosto: 0, netoConCosto: 0, netoSinCosto: 0,
});

describe("sumarResumen (nada se estima)", () => {
  it("solo el neto real entra al neto y a la ganancia; la venta sin depósito se declara aparte", () => {
    const t = vacio();
    sumarResumen(t, {
      sku: "499-A06", unidades: 3, ordenes: 3, importe: 300, comision: 45,
      neto: 102, unidades_sin_neto: 1, importe_sin_neto: 100, comision_sin_neto: 15,
    }, 20);
    expect(t.neto).toBe(102);
    expect(t.ventaSinNeto).toBe(100);
    expect(t.unidadesSinNeto).toBe(1);
    // ganancia = neto real − costo de TODAS las unidades vendidas (3 × 20)
    expect(t.costo).toBe(60);
    expect(t.ganancia).toBe(42);
  });

  it("sin costo cargado, el neto no cuenta como ganancia", () => {
    const t = vacio();
    sumarResumen(t, { sku: "501-B", unidades: 1, ordenes: 1, importe: 100, comision: 15, neto: 51, unidades_sin_neto: 0, importe_sin_neto: 0, comision_sin_neto: 0 }, null);
    expect(t.neto).toBe(51);
    expect(t.netoSinCosto).toBe(51);
    expect(t.ganancia).toBe(0);
    expect(t.unidadesSinCosto).toBe(1);
  });
});
