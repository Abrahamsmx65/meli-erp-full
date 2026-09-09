import { describe, expect, it } from "vitest";
import { cascadaDeEvento, cascadaDePedido, clasificarEventos, claveDeEvento } from "./finanzas";

const m = (CurrencyAmount: number) => ({ CurrencyCode: "MXN", CurrencyAmount });

describe("cascada de un evento de la Finances API de Amazon", () => {
  it("separa principal, impuesto, comisión, FBA, retenido y promociones, y el neto es la suma con signo", () => {
    const c = cascadaDeEvento({
      AmazonOrderId: "702-1234567-1234567",
      ShipmentItemList: [
        {
          SellerSKU: "GT135-DK-25-MX",
          QuantityShipped: 1,
          ItemChargeList: [
            { ChargeType: "Principal", ChargeAmount: m(500) },
            { ChargeType: "Tax", ChargeAmount: m(80) },
          ],
          ItemFeeList: [
            { FeeType: "Commission", FeeAmount: m(-87) },
            { FeeType: "FBAPerUnitFulfillmentFee", FeeAmount: m(-95.5) },
            { FeeType: "VariableClosingFee", FeeAmount: m(-1) },
          ],
          ItemTaxWithheldList: [
            {
              TaxCollectionModel: "MarketplaceFacilitator",
              TaxesWithheld: [
                { ChargeType: "MarketplaceFacilitatorVAT-Principal", ChargeAmount: m(-40) },
              ],
            },
          ],
          PromotionList: [{ PromotionType: "Shipping", PromotionAmount: m(-10) }],
        },
      ],
    });
    expect(c).toMatchObject({
      principal: 500,
      impuestoCobrado: 80,
      comision: -87,
      fba: -95.5,
      otrasTarifas: -1,
      retenido: -40,
      promociones: -10,
      unidades: 1,
    });
    expect(c.neto).toBe(346.5);
    expect(c.porNombre["Renglón:Commission"]).toBe(-87);
    expect(c.porNombre["Retenido:MarketplaceFacilitator:MarketplaceFacilitatorVAT-Principal"]).toBe(-40);
  });

  it("la cascada por renglón separa los SKUs y los cargos de orden van en un renglón sin SKU", () => {
    const c = cascadaDeEvento({
      OrderFeeList: [{ FeeType: "FBAPerOrderFulfillmentFee", FeeAmount: m(-5) }],
      ShipmentItemList: [
        { SellerSKU: "A-1", QuantityShipped: 1, ItemChargeList: [{ ChargeType: "Principal", ChargeAmount: m(100) }], ItemFeeList: [{ FeeType: "Commission", FeeAmount: m(-15) }] },
        { SellerSKU: "B-2", QuantityShipped: 2, ItemChargeList: [{ ChargeType: "Principal", ChargeAmount: m(50) }] },
      ],
    });
    expect(c.renglones).toEqual([
      expect.objectContaining({ sku: "A-1", unidades: 1, principal: 100, comision: -15, neto: 85 }),
      expect.objectContaining({ sku: "B-2", unidades: 2, principal: 50, neto: 50 }),
      expect.objectContaining({ sku: null, fba: -5, neto: -5 }),
    ]);
    expect(c.neto).toBe(130);
    expect(c.unidades).toBe(3);
  });

  it("clasificarEventos aplana todas las listas: publicidad con IVA, cargos de servicio y lo desconocido sin monto", () => {
    const ev = clasificarEventos({
      ShipmentEventList: [{ AmazonOrderId: "702-1", PostedDate: "2026-08-17T19:19:28Z", ShipmentItemList: [{ SellerSKU: "X", QuantityShipped: 1, ItemChargeList: [{ ChargeType: "Principal", ChargeAmount: m(10) }] }] }],
      ProductAdsPaymentEventList: [{ postedDate: "2026-08-18T00:00:00Z", transactionType: "CHARGE", invoiceId: "INV-1", baseValue: m(-100), taxValue: m(-16), transactionValue: m(-116) }],
      ServiceFeeEventList: [{ FeeReason: "Storage Fee", FeeList: [{ FeeType: "FBAStorageFee", FeeAmount: m(-30) }] }],
      RaraEventList: [{ PostedDate: "2026-08-18T00:00:00Z", Cosa: m(-1) }],
      ChargebackEventList: [],
    } as any);
    expect(ev.map((e) => e.lista)).toEqual(["ShipmentEventList", "ProductAdsPaymentEventList", "ServiceFeeEventList", "RaraEventList"]);
    expect(ev[0]).toMatchObject({ amazonOrderId: "702-1", postedEn: "2026-08-17T19:19:28Z", monto: 10, clasificado: true });
    expect(ev[0].cascada?.renglones[0].sku).toBe("X");
    expect(ev[1]).toMatchObject({ monto: -116, base: -100, impuesto: -16, descripcion: "CHARGE INV-1", postedEn: "2026-08-18T00:00:00Z", cascada: null });
    expect(ev[2]).toMatchObject({ monto: -30, descripcion: "Storage Fee" });
    expect(ev[3]).toMatchObject({ monto: null, clasificado: false });
    // La clave es la huella del crudo: el mismo evento dos veces da la misma clave.
    expect(claveDeEvento("ShipmentEventList", ev[0].crudo)).toBe(ev[0].clave);
    expect(new Set(ev.map((e) => e.clave)).size).toBe(4);
  });

  it("los reembolsos van aparte de las ventas", () => {
    const { ventas, reembolsos } = cascadaDePedido({
      ShipmentEventList: [{ ShipmentItemList: [{ QuantityShipped: 1, ItemChargeList: [{ ChargeType: "Principal", ChargeAmount: m(100) }] }] }],
      RefundEventList: [{ ShipmentItemAdjustmentList: [{ ItemChargeAdjustmentList: [{ ChargeType: "Principal", ChargeAmount: m(-100) }], ItemFeeAdjustmentList: [{ FeeType: "Commission", FeeAmount: m(15) }] }] }],
    });
    expect(ventas[0].neto).toBe(100);
    expect(reembolsos[0]).toMatchObject({ principal: -100, comision: 15, neto: -85 });
  });
});

describe("eventos idénticos en la misma página", () => {
  it("dos cargos iguales (misma huella) conservan los dos con claves distintas, y releer da las mismas claves", () => {
    const pagina = {
      ServiceFeeEventList: [
        { FeeList: [{ FeeType: "FBAInboundTransportationFee", FeeAmount: m(-619.27) }] },
        { FeeList: [{ FeeType: "FBAInboundTransportationFee", FeeAmount: m(-619.27) }] },
        { FeeList: [{ FeeType: "FBAInboundTransportationFee", FeeAmount: m(-619.27) }] },
      ],
    } as any;
    const a = clasificarEventos(pagina);
    const b = clasificarEventos(pagina);
    expect(a.map((e) => e.monto)).toEqual([-619.27, -619.27, -619.27]);
    expect(new Set(a.map((e) => e.clave)).size).toBe(3);
    expect(a[1].clave).toBe(`${a[0].clave}#2`);
    expect(a[2].clave).toBe(`${a[0].clave}#3`);
    expect(b.map((e) => e.clave)).toEqual(a.map((e) => e.clave));
    // Sin fecha de asiento: la ingesta los fecha al cierre del grupo.
    expect(a[0].postedEn).toBeNull();
  });
});
