import { describe, expect, it } from "vitest";
import { agregarVentasDiarias, diaMx, estimarPorCobrar, modeloDeSku, muestrasEnRango, resumenPorModelo } from "./ventas";

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

describe("muestras y resumen por modelo", () => {
  const ordenes = [
    { orderId: "v1", estado: "IN_TRANSIT", creadoEn: "2026-09-02T15:00:00Z", esMuestra: false, netoRecibido: 800 },
    { orderId: "v2", estado: "AWAITING_SHIPMENT", creadoEn: "2026-09-02T16:00:00Z", esMuestra: false, netoRecibido: null },
    { orderId: "m1", estado: "IN_TRANSIT", creadoEn: "2026-09-02T17:00:00Z", esMuestra: true, netoRecibido: null },
    { orderId: "fuera", estado: "IN_TRANSIT", creadoEn: "2026-08-20T17:00:00Z", esMuestra: false, netoRecibido: 100 },
  ];
  const renglones = [
    { orderId: "v1", skuInterno: "GT134-BLK-24-MX", cantidad: 1, precio: 600, estado: "IN_TRANSIT" },
    { orderId: "v1", skuInterno: "GT150-CAMEL-25-MX", cantidad: 1, precio: 400, estado: "IN_TRANSIT" },
    { orderId: "v2", skuInterno: "GT134-BLK-26-MX", cantidad: 2, precio: 500, estado: "AWAITING_SHIPMENT" },
    { orderId: "m1", skuInterno: "GT134-BLK-23-MX", cantidad: 1, precio: 0, estado: "IN_TRANSIT" },
    { orderId: "fuera", skuInterno: "GT134-BLK-23-MX", cantidad: 1, precio: 500, estado: "IN_TRANSIT" },
  ];
  const rango = { desde: "2026-09-01", hasta: "2026-09-03" };

  it("la muestra no es venta: ni en el día ni en el modelo", () => {
    const dia = agregarVentasDiarias(ordenes, renglones);
    expect(dia.find((v) => v.sku === "GT134-BLK-23-MX" && v.fecha === "2026-09-02")).toBeUndefined();
    expect(muestrasEnRango(ordenes, rango).map((o) => o.orderId)).toEqual(["m1"]);
  });

  it("agrupa por modelo, reparte el neto por precio y cuenta lo sin liquidar", () => {
    const r = resumenPorModelo(ordenes, renglones, rango);
    expect(r.map((m) => m.modelo)).toEqual(["GT134", "GT150"]);
    const gt134 = r[0];
    expect(gt134.unidades).toBe(3);
    expect(gt134.pedidos).toBe(2);
    expect(gt134.cobrado).toBe(1600);
    // v1 liquidó 800 sobre 1000 cobrados: al GT134 (600) le tocan 480
    expect(gt134.recibido).toBeCloseTo(480);
    expect(gt134.cobradoLiquidado).toBe(600);
    expect(gt134.unidadesLiquidadas).toBe(1);
    expect(gt134.sinLiquidar).toBe(1);
    expect(gt134.tallas.map((t) => [t.sku, t.unidades])).toEqual([["GT134-BLK-24-MX", 1], ["GT134-BLK-26-MX", 2]]);
    expect(r[1].recibido).toBeCloseTo(320);
    expect(modeloDeSku("gt134-blk-24-mx")).toBe("GT134");
  });
});

describe("estimarPorCobrar", () => {
  it("estima lo pendiente con el porcentaje observado en lo liquidado, y sin base no inventa", () => {
    const base = { modelo: "GT134", unidades: 0, pedidos: 0, cobrado: 0, sinLiquidar: 0, unidadesLiquidadas: 0, unidadesSinLiquidar: 0, tallas: [] };
    // Liquidado: recibió 800 de 1000 cobrados (80%); pendiente: 500 cobrados.
    const conBase = estimarPorCobrar([
      { ...base, recibido: 800, cobradoLiquidado: 1000, cobradoSinLiquidar: 500 },
    ]);
    expect(conBase.ratio).toBeCloseTo(0.8);
    expect(conBase.porCobrar).toBeCloseTo(400);

    // Nada liquidado todavía: no hay porcentaje que observar.
    const sinBase = estimarPorCobrar([
      { ...base, recibido: 0, cobradoLiquidado: 0, cobradoSinLiquidar: 500 },
    ]);
    expect(sinBase.ratio).toBeNull();
    expect(sinBase.porCobrar).toBeNull();
  });
});
