import { describe, expect, it } from "vitest";
import { cascadaDeEvento, cascadaDePedido } from "./finanzas";

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

  it("los reembolsos van aparte de las ventas", () => {
    const { ventas, reembolsos } = cascadaDePedido({
      ShipmentEventList: [{ ShipmentItemList: [{ QuantityShipped: 1, ItemChargeList: [{ ChargeType: "Principal", ChargeAmount: m(100) }] }] }],
      RefundEventList: [{ ShipmentItemAdjustmentList: [{ ItemChargeAdjustmentList: [{ ChargeType: "Principal", ChargeAmount: m(-100) }], ItemFeeAdjustmentList: [{ FeeType: "Commission", FeeAmount: m(15) }] }] }],
    });
    expect(ventas[0].neto).toBe(100);
    expect(reembolsos[0]).toMatchObject({ principal: -100, comision: 15, neto: -85 });
  });
});
