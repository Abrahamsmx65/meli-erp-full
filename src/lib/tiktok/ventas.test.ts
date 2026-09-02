import { describe, expect, it } from "vitest";
import { agregarVentasDiarias, diaMx } from "./ventas";

describe("diaMx", () => {
  it("un pedido de las 20:19 hora México del día 1 es del día 1, aunque en UTC ya sea día 2", () => {
    expect(diaMx("2026-09-02T02:19:50Z")).toBe("2026-09-01");
  });
  it("uno de las 09:00 hora México es del mismo día", () => {
    expect(diaMx("2026-09-01T15:00:00Z")).toBe("2026-09-01");
  });
});

describe("agregarVentasDiarias", () => {
  const ordenes = [
    { orderId: "a", estado: "AWAITING_SHIPMENT", creadoEn: "2026-09-01T15:00:00Z" },
    { orderId: "b", estado: "IN_TRANSIT", creadoEn: "2026-09-02T02:19:50Z" }, // 20:19 del día 1
    { orderId: "c", estado: "CANCELLED", creadoEn: "2026-09-01T16:00:00Z" },
    { orderId: "d", estado: "UNPAID", creadoEn: "2026-09-01T17:00:00Z" },
  ];
  const renglones = [
    { orderId: "a", skuInterno: "GT134-BLK-24-MX", cantidad: 1, precio: 500, estado: "AWAITING_SHIPMENT" },
    { orderId: "b", skuInterno: "GT134-BLK-24-MX", cantidad: 1, precio: 500, estado: "IN_TRANSIT" },
    { orderId: "b", skuInterno: "GT134-BLK-26-MX", cantidad: 2, precio: 450, estado: "IN_TRANSIT" },
    { orderId: "c", skuInterno: "GT134-BLK-24-MX", cantidad: 1, precio: 500, estado: "CANCELLED" },
    { orderId: "d", skuInterno: "GT134-BLK-24-MX", cantidad: 1, precio: 500, estado: "UNPAID" },
    { orderId: "a", skuInterno: null, cantidad: 1, precio: 500, estado: "AWAITING_SHIPMENT" },
  ];

  it("junta las dos ventas del mismo día y talla aunque una sea de la noche", () => {
    const v = agregarVentasDiarias(ordenes, renglones);
    expect(v).toEqual([
      { sku: "GT134-BLK-24-MX", fecha: "2026-09-01", unidades: 2, ordenes: 2, importe: 1000 },
      { sku: "GT134-BLK-26-MX", fecha: "2026-09-01", unidades: 2, ordenes: 1, importe: 900 },
    ]);
  });

  it("no cuenta cancelados, sin pagar ni renglones sin SKU", () => {
    const v = agregarVentasDiarias(ordenes, renglones);
    expect(v.reduce((a, x) => a + x.unidades, 0)).toBe(4);
  });
});
