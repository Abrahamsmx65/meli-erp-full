import { describe, expect, it } from "vitest";
import { ventasDesdeOrdenes } from "./corte";

describe("ventasDesdeOrdenes", () => {
  it("arma los renglones sku|día desde las órdenes, sin las canceladas, y deja sin neto los días incompletos", () => {
    const { ventas, sinRenglones } = ventasDesdeOrdenes([
      { orderId: 1, fecha: "2026-08-03", total: 300, neto: 150, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2,
        renglones: [{ sku: "499-A", unidades: 2, importe: 200, comision: 30 }, { sku: "501-B", unidades: 1, importe: 100, comision: 15 }] },
      { orderId: 2, fecha: "2026-08-03", total: 100, neto: 60, netoActual: 58, reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2,
        renglones: [{ sku: "499-A", unidades: 1, importe: 100, comision: 15 }] },
      { orderId: 3, fecha: "2026-08-03", total: 500, neto: 250, netoActual: null, reembolsado: 500, estado: "cancelled", estadoPago: "refunded", revisiones: 1,
        renglones: [{ sku: "499-A", unidades: 5, importe: 500, comision: 75 }] },
      { orderId: 4, fecha: "2026-08-04", total: 100, neto: 0, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: null, revisiones: 0,
        renglones: [{ sku: "499-A", unidades: 1, importe: 100, comision: 15 }] },
      { orderId: 5, fecha: "2026-08-04", total: 100, neto: 50, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: null, revisiones: 0,
        renglones: [{ sku: "501-B", unidades: 1, importe: 100, comision: 15 }] },
      { orderId: 6, fecha: "2026-08-05", total: 100, neto: 50, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: null, revisiones: 0, renglones: null },
    ]);
    expect(sinRenglones).toBe(1);
    const dia3 = ventas.filter((v) => v.fecha === "2026-08-03").sort((a, b) => a.sku.localeCompare(b.sku));
    // 499-A: 100 (orden 1, 2/3 de 150) + 58 (orden 2, neto actual) = 158
    expect(dia3).toEqual([
      { sku: "499-A", fecha: "2026-08-03", unidades: 3, ordenes: 2, importe: 300, comision: 45, neto: 158, netoConfirmado: true },
      { sku: "501-B", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 15, neto: 50, netoConfirmado: true },
    ]);
    // El SKU pendiente se estima; el otro SKU conserva su saldo confirmado.
    const dia4 = ventas.filter((v) => v.fecha === "2026-08-04").sort((a, b) => a.sku.localeCompare(b.sku));
    expect(dia4).toEqual([
      { sku: "499-A", fecha: "2026-08-04", unidades: 1, ordenes: 1, importe: 100, comision: 15, neto: 0, netoConfirmado: false },
      { sku: "501-B", fecha: "2026-08-04", unidades: 1, ordenes: 1, importe: 100, comision: 15, neto: 50, netoConfirmado: true },
    ]);
    expect(dia4.reduce((a, v) => a + (v.importe ?? 0), 0)).toBe(200);
  });

  it.each([0, -15])("reparte un saldo actual confirmado de %s", (saldo) => {
    const { ventas } = ventasDesdeOrdenes([{
      orderId: 7,
      fecha: "2026-08-06",
      total: 200,
      neto: 170,
      netoActual: saldo,
      netoLeido: true,
      reembolsado: 0,
      estado: "paid",
      estadoPago: "approved",
      revisiones: 2,
      renglones: [{ sku: "F1-NEGRO", unidades: 1, importe: 200 }],
    }]);

    expect(ventas).toHaveLength(1);
    expect(ventas[0].neto).toBe(saldo);
    expect(ventas[0].netoConfirmado).toBe(true);
  });
});
