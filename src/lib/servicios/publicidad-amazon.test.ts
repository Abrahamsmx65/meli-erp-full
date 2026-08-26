import { describe, expect, it } from "vitest";
import { armarPublicidadAmazon } from "./publicidad-amazon";

/**
 * El panel de publicidad de Amazon junta las ventas diarias con el gasto de
 * ads del reporte de economía por SKU, a nivel MODELO. Aquí se prueba el
 * amarre por seller_sku (con sufijo -MX incluido), los denominadores del
 * por-unidad (los del reporte de economía, no los del periodo) y el orden
 * alfabético.
 */

const venta = (seller_sku: string, unidades: number, importe: number) => ({
  seller_sku,
  fecha: "2026-08-01",
  unidades,
  importe,
});

const eco = (
  seller_sku: string,
  publicidad: number,
  extra?: Partial<{ unidades: number; ventas: number; fecha: string }>,
) => ({
  seller_sku,
  fecha: extra?.fecha ?? "2026-08-01",
  unidades: extra?.unidades ?? 0,
  ventas: extra?.ventas ?? 0,
  publicidad,
});

describe("armarPublicidadAmazon", () => {
  it("junta ventas y economía por modelo con el sufijo -MX fuera", () => {
    const p = armarPublicidadAmazon({
      ventas: [venta("GT128-23-BLK-MX", 4, 2000), venta("GT128-24-BLK-MX", 6, 3000)],
      economia: [
        eco("GT128-23-BLK-MX", 120, { unidades: 3, ventas: 1500 }),
        eco("GT128-24-BLK-MX", 80, { unidades: 5, ventas: 2500 }),
      ],
      costoDeModelo: new Map([["GT128", 200]]),
    });

    expect(p.filas).toHaveLength(1);
    const f = p.filas[0];
    expect(f.modelo).toBe("GT128");
    expect(f.unidades).toBe(10);
    expect(f.importe).toBe(5000);
    expect(f.gastoAds).toBe(200);
    // El por-unidad usa las unidades del reporte de economía (8), no las 10.
    expect(f.costoPorUnidad).toBeCloseTo(25);
    expect(f.tacos).toBeCloseTo(200 / 4000);
    // Ganancia estimada = venta − costo×unidades = 5000 − 2000.
    expect(f.ganancia).toBe(3000);
    expect(f.gananciaNeta).toBe(2800);
  });

  it("sin economía del modelo el gasto queda en null, no en cero", () => {
    const p = armarPublicidadAmazon({
      ventas: [venta("MY2307-BLACK-25", 3, 1200)],
      economia: [],
      costoDeModelo: new Map(),
    });
    expect(p.filas[0].gastoAds).toBeNull();
    expect(p.filas[0].costoPorUnidad).toBeNull();
    expect(p.filas[0].gananciaNeta).toBeNull();
    expect(p.aviso).not.toBeNull();
  });

  it("ordena alfabéticamente por modelo y reporta hasta cuándo hay economía", () => {
    const p = armarPublicidadAmazon({
      ventas: [venta("MY2307-BLACK-25", 5, 2500), venta("GT104-NAVY-26", 1, 400)],
      economia: [eco("MY2307-BLACK-25", 50, { fecha: "2026-08-20" })],
      costoDeModelo: new Map(),
    });
    expect(p.filas.map((f) => f.modelo)).toEqual(["GT104", "MY2307"]);
    expect(p.economiaHasta).toBe("2026-08-20");
    expect(p.aviso).toBeNull();
  });

  it("suma los totales con los denominadores de la economía", () => {
    const p = armarPublicidadAmazon({
      ventas: [venta("GT104-NAVY-26", 10, 4000), venta("MY2307-BLACK-25", 10, 6000)],
      economia: [
        eco("GT104-NAVY-26", 100, { unidades: 8, ventas: 3200 }),
        eco("MY2307-BLACK-25", 300, { unidades: 8, ventas: 4800 }),
      ],
      costoDeModelo: new Map([
        ["GT104", 100],
        ["MY2307", 200],
      ]),
    });
    expect(p.totales.gastoAds).toBe(400);
    expect(p.totales.unidades).toBe(20);
    expect(p.totales.costoPorUnidad).toBeCloseTo(25); // 400 / 16 de economía
    expect(p.totales.tacos).toBeCloseTo(0.05); // 400 / 8000 de economía
    // (4000 − 100×10) + (6000 − 200×10) = 3000 + 4000.
    expect(p.totales.ganancia).toBe(7000);
    expect(p.totales.coberturaCosto).toBe(1);
  });
});
