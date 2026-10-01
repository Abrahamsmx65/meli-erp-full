import { describe, expect, it } from "vitest";
import { agregarVentasDiarias, diaMx, modeloDeSku, muestrasEnRango, origenDeVentas, resumenPorModelo } from "./ventas";

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
    // ya liquidado por TikTok: 800 sobre 1000 cobrados
    { orderId: "v1", estado: "IN_TRANSIT", creadoEn: "2026-09-02T15:00:00Z", esMuestra: false, netoRecibido: 800, pagoEsperado: 800, afiliado: 50 },
    // por liquidar: TikTok dice que pagará 700 por 1000 cobrados
    { orderId: "v2", estado: "AWAITING_SHIPMENT", creadoEn: "2026-09-02T16:00:00Z", esMuestra: false, netoRecibido: null, pagoEsperado: 700, afiliado: 0 },
    // sin dato: TikTok aún no tiene transacciones
    { orderId: "v3", estado: "AWAITING_SHIPMENT", creadoEn: "2026-09-02T16:30:00Z", esMuestra: false, netoRecibido: null, pagoEsperado: null },
    { orderId: "m1", estado: "IN_TRANSIT", creadoEn: "2026-09-02T17:00:00Z", esMuestra: true, netoRecibido: null },
    { orderId: "fuera", estado: "IN_TRANSIT", creadoEn: "2026-08-20T17:00:00Z", esMuestra: false, netoRecibido: 100 },
    { orderId: "cancelado", estado: "CANCELLED", creadoEn: "2026-09-02T18:00:00Z", esMuestra: false, netoRecibido: null, pagoEsperado: 0 },
  ];
  const renglones = [
    { orderId: "v1", skuInterno: "GT134-BLK-24-MX", cantidad: 1, precio: 600, estado: "IN_TRANSIT" },
    { orderId: "v1", skuInterno: "GT150-CAMEL-25-MX", cantidad: 1, precio: 400, estado: "IN_TRANSIT" },
    { orderId: "v2", skuInterno: "GT134-BLK-26-MX", cantidad: 2, precio: 500, estado: "AWAITING_SHIPMENT" },
    { orderId: "v3", skuInterno: "GT134-BLK-27-MX", cantidad: 1, precio: 450, estado: "AWAITING_SHIPMENT" },
    { orderId: "m1", skuInterno: "GT134-BLK-23-MX", cantidad: 1, precio: 0, estado: "IN_TRANSIT" },
    { orderId: "fuera", skuInterno: "GT134-BLK-23-MX", cantidad: 1, precio: 500, estado: "IN_TRANSIT" },
    { orderId: "cancelado", skuInterno: "GT134-BLK-23-MX", cantidad: 1, precio: 500, estado: "CANCELLED" },
  ];
  const rango = { desde: "2026-09-01", hasta: "2026-09-03" };

  it("la muestra no es venta: ni en el día ni en el modelo", () => {
    const dia = agregarVentasDiarias(ordenes, renglones);
    expect(dia.find((v) => v.sku === "GT134-BLK-23-MX" && v.fecha === "2026-09-02")).toBeUndefined();
    expect(muestrasEnRango(ordenes, rango).map((o) => o.orderId)).toEqual(["m1"]);
  });

  it("agrupa por modelo con el número de TikTok (liquidado o por liquidar), reparte por precio y separa lo sin dato; lo cancelado no existe", () => {
    const r = resumenPorModelo(ordenes, renglones, rango);
    expect(r.map((m) => m.modelo)).toEqual(["GT134", "GT150"]);
    const gt134 = r[0];
    expect(gt134.unidades).toBe(4);
    expect(gt134.pedidos).toBe(3);
    expect(gt134.cobrado).toBe(2050);
    // v1: 800 sobre 1000 cobrados → al GT134 (600) le tocan 480, liquidados;
    // v2: 700 por liquidar, todo GT134; v3 sin dato.
    expect(gt134.aRecibir).toBeCloseTo(1180);
    expect(gt134.aRecibirLiquidado).toBeCloseTo(480);
    expect(gt134.aRecibirPorLiquidar).toBeCloseTo(700);
    expect(gt134.afiliado).toBeCloseTo(30); // 50 × 0.6
    expect(gt134.unidadesConDato).toBe(3);
    expect(gt134.pedidosSinDato).toBe(1);
    expect(gt134.cobradoSinDato).toBe(450);
    expect(gt134.unidadesSinDato).toBe(1);
    expect(gt134.pedidosLiquidados).toBe(1);
    expect(gt134.tallas.map((t) => [t.sku, t.unidades, Math.round(t.aRecibir)])).toEqual([
      ["GT134-BLK-24-MX", 1, 480],
      ["GT134-BLK-26-MX", 2, 700],
      ["GT134-BLK-27-MX", 1, 0],
    ]);
    expect(r[1].aRecibir).toBeCloseTo(320);
    expect(r[1].afiliado).toBeCloseTo(20);
    expect(modeloDeSku("gt134-blk-24-mx")).toBe("GT134");
  });
});

describe("origenDeVentas", () => {
  const rango = { desde: "2026-09-01", hasta: "2026-09-30" };
  const ordenes = [
    { orderId: "1", estado: "COMPLETED", creadoEn: "2026-09-10T15:00:00Z", creador: "ana", afiliadoLeido: true },
    { orderId: "2", estado: "DELIVERED", creadoEn: "2026-09-11T15:00:00Z", creador: "ana", afiliadoLeido: true },
    { orderId: "3", estado: "IN_TRANSIT", creadoEn: "2026-09-12T15:00:00Z", creador: "beto", afiliadoLeido: true },
    { orderId: "4", estado: "COMPLETED", creadoEn: "2026-09-13T15:00:00Z", creador: null, afiliadoLeido: true },
    { orderId: "5", estado: "COMPLETED", creadoEn: "2026-09-14T15:00:00Z", creador: null, afiliadoLeido: false },
    { orderId: "6", estado: "CANCELLED", creadoEn: "2026-09-14T15:00:00Z", creador: "ana", afiliadoLeido: true },
    { orderId: "7", estado: "COMPLETED", creadoEn: "2026-10-02T15:00:00Z", creador: "ana", afiliadoLeido: true },
    { orderId: "8", estado: "COMPLETED", creadoEn: "2026-09-15T15:00:00Z", creador: "ana", afiliadoLeido: true, esMuestra: true },
  ];
  const renglones = [
    { orderId: "1", skuInterno: "GT1-BLK-24-MX", cantidad: 1, precio: 400, estado: "COMPLETED" },
    { orderId: "2", skuInterno: "GT1-BLK-25-MX", cantidad: 2, precio: 300, estado: "COMPLETED" },
    { orderId: "3", skuInterno: "GT2-BLK-25-MX", cantidad: 1, precio: 200, estado: "IN_TRANSIT" },
    { orderId: "3", skuInterno: "GT2-BLK-26-MX", cantidad: 1, precio: 100, estado: "CANCELLED" },
    { orderId: "4", skuInterno: "GT1-BLK-24-MX", cantidad: 1, precio: 500, estado: "COMPLETED" },
    { orderId: "5", skuInterno: "GT1-BLK-24-MX", cantidad: 1, precio: 100, estado: "COMPLETED" },
    { orderId: "6", skuInterno: "GT1-BLK-24-MX", cantidad: 1, precio: 900, estado: "CANCELLED" },
    { orderId: "7", skuInterno: "GT1-BLK-24-MX", cantidad: 1, precio: 900, estado: "COMPLETED" },
    { orderId: "8", skuInterno: "GT1-BLK-24-MX", cantidad: 1, precio: 0, estado: "COMPLETED" },
  ];
  it("reparte lo cobrado entre creadores, tienda y sin revisar; cancelados, muestras y fuera de rango no entran", () => {
    const o = origenDeVentas(ordenes, renglones, rango);
    expect(o.total).toMatchObject({ pedidos: 5, unidades: 6, cobrado: 1800 });
    expect(o.creadores).toMatchObject({ pedidos: 3, unidades: 4, cobrado: 1200, porcentaje: (1200 / 1800) * 100 });
    expect(o.tienda).toMatchObject({ pedidos: 1, unidades: 1, cobrado: 500 });
    expect(o.sinRevisar).toMatchObject({ pedidos: 1, unidades: 1, cobrado: 100 });
  });
  it("el top va por cobrado, con su % del total del rango", () => {
    const o = origenDeVentas(ordenes, renglones, rango);
    expect(o.top.map((t) => t.creador)).toEqual(["ana", "beto"]);
    expect(o.top[0]).toMatchObject({ pedidos: 2, unidades: 3, cobrado: 1000 });
    expect(o.top[0].porcentaje).toBeCloseTo(55.56, 1);
    expect(o.creadoresDistintos).toBe(2);
  });
  it("se topa en N y sin ventas todo es cero", () => {
    expect(origenDeVentas(ordenes, renglones, rango, 1).top).toHaveLength(1);
    const vacio = origenDeVentas([], [], rango);
    expect(vacio.total.porcentaje).toBe(0);
    expect(vacio.top).toEqual([]);
  });
});
