import { describe, expect, it } from "vitest";
import { claveVentas, partirEnTandas, sumarResumen, TTL_VENTAS_MS, ventasNecesitaRefresco, type Totales } from "./ventas";

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
    // ganancia = neto real − costo SOLO de las unidades con depósito leído (2 × 20):
    // la unidad sin depósito queda fuera por los dos lados.
    expect(t.costo).toBe(40);
    expect(t.ganancia).toBe(62);
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

describe("monitor masticado", () => {
  it("la clave lleva el rango", () => {
    expect(claveVentas({ desde: "2026-09-10", hasta: "2026-10-09" })).toBe("ventas:v1:2026-09-10:2026-10-09");
  });

  it("se refresca si está invalidado, si ya pasó el TTL o si la fecha no se entiende", () => {
    const ahora = Date.parse("2026-10-09T12:00:00Z");
    const hace = (ms: number) => new Date(ahora - ms).toISOString();
    expect(ventasNecesitaRefresco(hace(60_000), true, ahora)).toBe(false);
    expect(ventasNecesitaRefresco(hace(60_000), false, ahora)).toBe(true);
    expect(ventasNecesitaRefresco(hace(TTL_VENTAS_MS + 1), true, ahora)).toBe(true);
    expect(ventasNecesitaRefresco("no-es-fecha", true, ahora)).toBe(true);
  });

  it("parte en tandas sin perder ni repetir", () => {
    const t = partirEnTandas([1, 2, 3, 4, 5, 6, 7], 3);
    expect(t).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(partirEnTandas([], 3)).toEqual([]);
  });
});
