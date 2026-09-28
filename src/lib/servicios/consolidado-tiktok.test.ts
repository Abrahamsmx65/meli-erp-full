import { describe, expect, it } from "vitest";
import { bloqueTikTok, rangoTikTok } from "./consolidado-tiktok";
import { armarConsolidado } from "./consolidado";

const ordenes = [
  { orderId: "a", estado: "DELIVERED", creadoEn: "2026-09-10T18:00:00Z", netoRecibido: 400, desglose: { comision: 50, envio: 20, isrRetenido: 10, ivaRetenido: 15 } },
  { orderId: "b", estado: "AWAITING_SHIPMENT", creadoEn: "2026-09-10T20:00:00Z", pagoEsperado: null },
  { orderId: "c", estado: "CANCELLED", creadoEn: "2026-09-10T20:00:00Z", pagoEsperado: 999 },
  { orderId: "d", estado: "IN_TRANSIT", creadoEn: "2026-09-11T04:00:00Z", pagoEsperado: 200 },
  // agosto: TikTok no cuenta antes de septiembre
  { orderId: "e", estado: "COMPLETED", creadoEn: "2026-08-20T18:00:00Z", netoRecibido: 100 },
];
const renglones = [
  { orderId: "a", skuInterno: "GT134-BLK-24-MX", cantidad: 2, precio: 250, estado: null },
  { orderId: "b", skuInterno: "GT134-BLK-25-MX", cantidad: 1, precio: 250, estado: null },
  { orderId: "c", skuInterno: "GT134-BLK-25-MX", cantidad: 1, precio: 250, estado: null },
  { orderId: "d", skuInterno: "MY2304-PURPLE-23-MX", cantidad: 1, precio: 300, estado: null },
  { orderId: "e", skuInterno: "GT134-BLK-26-MX", cantidad: 1, precio: 250, estado: null },
];
const config = new Map([["GT134", { costo: 100, categoria: "Tenis" }]]);

describe("rangoTikTok", () => {
  it("nada antes de septiembre de 2026; un rango que lo cruza arranca el 1-sep", () => {
    expect(rangoTikTok({ desde: "2026-08-01", hasta: "2026-08-31" })).toBeNull();
    expect(rangoTikTok({ desde: "2026-08-15", hasta: "2026-09-05" })).toEqual({ desde: "2026-09-01", hasta: "2026-09-05" });
  });
});

describe("bloqueTikTok", () => {
  it("neto = lo que TikTok paga; lo sin número queda fuera con su costo; cancelados y agosto no cuentan", () => {
    const b = bloqueTikTok({ ordenes, renglones }, config, { desde: "2026-09-01", hasta: "2026-09-30" })!;
    expect(b.canal).toBe("tiktok");
    expect(b.unidades).toBe(4);
    expect(b.ordenes).toBe(3);
    expect(b.ventaBruta).toBe(1_050);
    expect(b.neto).toBe(600);
    // venta con número = 1,050 − 250 (pedido b)
    expect(b.coberturaNeto).toBeCloseTo(800 / 1_050);
    // GT134: 2 pares con dato × 100; el par del pedido b espera; MY2304 sin costo
    expect(b.costoProducto).toBe(200);
    expect(b.desglosePlataforma).toMatchObject({ comision: 50, envio: 20, isr: 10, iva: 15, otros: 800 - 600 - 95 });
    expect(b.exacto).toBe(false);
    expect(b.avisos.join(" ")).toContain("sin costo capturado para MY2304");
    expect(b.avisos.join(" ")).toContain("POR LIQUIDAR");
  });

  it("entra al corte general como cuarto canal con su ganancia", () => {
    const b = bloqueTikTok({ ordenes, renglones }, config, { desde: "2026-09-01", hasta: "2026-09-30" })!;
    const cns = armarConsolidado({ periodo: "2026-09", desde: "2026-09-01", hasta: "2026-09-30", bloques: [b] });
    const k = cns.canales.find((x) => x.canal === "tiktok")!;
    expect(k.nombre).toBe("TikTok Shop");
    expect(k.utilidadNeta).toBe(400);
  });

  it("agosto no tiene canal de TikTok", () => {
    expect(bloqueTikTok({ ordenes, renglones }, config, { desde: "2026-08-01", hasta: "2026-08-31" })).toBeNull();
  });
});
