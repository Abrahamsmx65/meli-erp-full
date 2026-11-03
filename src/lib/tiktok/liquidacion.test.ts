import { describe, expect, it } from "vitest";
import { agruparPorPedido, estadoDePago, idDePedido, interpretarTransacciones, listaDeTransacciones, normalizarSinLiquidar } from "./liquidacion";

// Un pedido real ya liquidado (586039883311973941, 25-sep-2026), recortado
// a los campos que se usan.
const LIQUIDADO = {
  order_id: "586039883311973941",
  statement_transactions: [
    {
      id: "7684778467955050247",
      status: "SETTLED",
      currency: "MXN",
      fee_amount: "-37.95",
      statement_id: "7688886541820856071",
      iva_vat_amount: "-8.07",
      revenue_amount: "116.97",
      statement_time: 1790294400,
      settlement_amount: "79.02",
      isr_income_tax_amount: "-2.52",
      customer_refund_amount: "0",
      customer_payment_amount: "116.97",
      fbm_shipping_cost_amount: "-49",
      shipping_cost_discount_amount: "49",
      affiliate_commission_amount: "0",
      adjustment_amount: "0",
    },
  ],
};

// La forma NUEVA (202501), recortada de un pedido real leído el 25-sep-2026
// (585847154291017119): venta liquidada y luego DEVUELTA; TikTok se queda
// con su comisión y el pedido acaba en −10.79.
const V202501_DEVUELTO = {
  currency: "MXN",
  order_id: "585847154291017119",
  total_count: 2,
  revenue_amount: "0",
  settlement_amount: "-10.79",
  fee_and_tax_amount: "-10.79",
  shipping_cost_amount: "0",
  order_create_time: 1788315590,
  sku_transactions: [
    {
      sku_id: "1737291709702440153",
      quantity: "1",
      statement_id: "7684070179757328135",
      fee_tax_amount: "-29",
      revenue_amount: "134.9",
      settlement_amount: "105.9",
      shipping_cost_amount: "0",
      fee_tax_breakdown: {
        fee: { sfp_service_fee_amount: "-10.79", fee_per_item_sold_amount: "-6", affiliate_commission_amount: "0", affiliate_ads_commission_amount: "0", affiliate_partner_commission_amount: "0", affiliate_commission_deposit: "-99", affiliate_commission_release: "99" },
        tax: { isr_amount: "-2.91", iva_amount: "-9.3" },
      },
      shipping_cost_breakdown: { actual_shipping_fee_amount: "-49", shipping_fee_discount_amount: "49", supplementary_component: { fbm_shipping_cost_amount: "-49", platform_shipping_fee_discount_amount: "49" } },
    },
    {
      sku_id: "1737291709702440153",
      quantity: "1",
      statement_id: "7685547307726571282",
      fee_tax_amount: "18.21",
      revenue_amount: "-134.9",
      settlement_amount: "-116.69",
      shipping_cost_amount: "0",
      fee_tax_breakdown: { fee: { sfp_service_fee_amount: "0", fee_per_item_sold_amount: "6" }, tax: { isr_amount: "2.91", iva_amount: "9.3" } },
    },
  ],
};

describe("interpretarTransacciones", () => {
  it("forma 202501: el total del pedido manda, la comisión y las retenciones salen del desglose, y una devolución deja el pago negativo", () => {
    const t = interpretarTransacciones(V202501_DEVUELTO);
    expect(t!.pago).toBeCloseTo(-10.79, 2);
    expect(t!.liquidado).toBe(true);
    expect(t!.transacciones).toBe(2);
    expect(t!.comision).toBeCloseTo(10.79, 2); // 10.79 + 6 − 6 (la devolución regresa el cargo por par)
    expect(t!.ivaRetenido).toBe(0); // −9.3 + 9.3
    expect(t!.isrRetenido).toBe(0);
    expect(t!.envio).toBe(0);
    expect(t!.afiliado).toBe(0); // deposit y release no cuentan
    expect(t!.reembolsos).toBeCloseTo(134.9, 2);
    expect(t!.cargos).toBeCloseTo(10.79, 2);
    expect(t!.statementId).toBe("7684070179757328135");
    expect(estadoDePago(t)).toBe("liquidado");
  });

  it("forma 202501 sin liquidar: sin statement_id la transacción cuenta en el pago pero el pedido queda por liquidar, con sus afiliados", () => {
    const d = {
      order_id: "x",
      settlement_amount: "61.20",
      sku_transactions: [
        { quantity: "1", statement_id: "", revenue_amount: "100", settlement_amount: "61.20", shipping_cost_amount: "-19",
          fee_tax_breakdown: { fee: { sfp_service_fee_amount: "-8", fee_per_item_sold_amount: "-6", affiliate_commission_amount: "-7", affiliate_partner_commission_amount: "-1.5" }, tax: { iva_amount: "-6.9", isr_amount: "-2.16" } } },
      ],
    };
    const t = interpretarTransacciones(d);
    expect(t!.pago).toBeCloseTo(61.2, 2);
    expect(t!.liquidado).toBe(false);
    expect(t!.afiliado).toBeCloseTo(8.5, 2);
    expect(t!.comision).toBeCloseTo(14, 2);
    expect(t!.envio).toBe(19);
    expect(t!.ivaRetenido).toBeCloseTo(6.9, 2);
    expect(estadoDePago(t)).toBe("por_liquidar");
  });

  it("forma 202501 vacía (total_count 0) es sin dato, no cero", () => {
    expect(interpretarTransacciones({ order_id: "x", total_count: 0, revenue_amount: "0", sku_transactions: [], settlement_amount: "0" })).toBeNull();
  });

  it("un pedido liquidado: el pago es el settlement_amount y se marca liquidado con su fecha", () => {
    const t = interpretarTransacciones(LIQUIDADO);
    expect(t).not.toBeNull();
    expect(t!.pago).toBeCloseTo(79.02, 2);
    expect(t!.liquidado).toBe(true);
    expect(t!.estados).toEqual(["SETTLED"]);
    expect(t!.ingreso).toBeCloseTo(116.97, 2);
    expect(t!.cargos).toBeCloseTo(37.95, 2);
    expect(t!.envio).toBe(0); // 49 cobrados, 49 subsidiados por TikTok
    expect(t!.ivaRetenido).toBeCloseTo(8.07, 2);
    expect(t!.isrRetenido).toBeCloseTo(2.52, 2);
    expect(t!.afiliado).toBe(0);
    expect(t!.statementId).toBe("7688886541820856071");
    expect(t!.liquidadoEn).toBe("2026-09-25T00:00:00.000Z");
    expect(estadoDePago(t)).toBe("liquidado");
  });

  it("una transacción sin liquidar cuenta en el pago pero deja el pedido por liquidar, y suma los afiliados", () => {
    const d = {
      statement_transactions: [
        { status: "UNSETTLED", settlement_amount: "60.10", customer_payment_amount: "100", affiliate_commission_amount: "-7", affiliate_partner_commission_amount: "-1.5" },
        { status: "UNSETTLED", settlement_amount: "-3.00", customer_payment_amount: "0", customer_refund_amount: "-3" },
      ],
    };
    const t = interpretarTransacciones(d);
    expect(t!.pago).toBeCloseTo(57.1, 2);
    expect(t!.liquidado).toBe(false);
    expect(t!.estados).toEqual(["UNSETTLED"]);
    expect(t!.afiliado).toBeCloseTo(8.5, 2);
    expect(t!.reembolsos).toBe(3);
    expect(t!.liquidadoEn).toBeNull();
    expect(estadoDePago(t)).toBe("por_liquidar");
  });

  it("mezcla de liquidadas y no liquidadas: todavía no está liquidado completo", () => {
    const d = {
      statement_transactions: [
        { status: "SETTLED", statement_id: "1", settlement_amount: "50" },
        { status: "UNSETTLED", settlement_amount: "-5" },
      ],
    };
    const t = interpretarTransacciones(d);
    expect(t!.pago).toBe(45);
    expect(t!.liquidado).toBe(false);
  });

  it("sin estado (forma 202309) se toma como liquidada si trae statement_id", () => {
    const t = interpretarTransacciones({ statement_transactions: [{ statement_id: "9", settlement_amount: "10" }] });
    expect(t!.liquidado).toBe(true);
    const sin = interpretarTransacciones({ statement_transactions: [{ settlement_amount: "10" }] });
    expect(sin!.liquidado).toBe(false);
  });

  it("sin transacciones es sin dato, nunca cero", () => {
    expect(interpretarTransacciones({ order_id: "x", statement_transactions: [] })).toBeNull();
    expect(interpretarTransacciones(null)).toBeNull();
    expect(estadoDePago(null)).toBe("sin_dato");
  });

  it("acepta otra llave para la lista mientras sus renglones traigan settlement_amount", () => {
    expect(listaDeTransacciones({ transactions: [{ settlement_amount: "1" }] })).toHaveLength(1);
    expect(listaDeTransacciones({ lo_que_sea: [{ settlement_amount: "1" }] })).toHaveLength(1);
    expect(listaDeTransacciones({ lo_que_sea: [{ otra: 1 }] })).toHaveLength(0);
  });

  it("la lista de toda la tienda se agrupa por pedido y cada grupo se interpreta sin liquidar", () => {
    const lista = [
      { order_id: "A", settlement_amount: "61.20", revenue_amount: "100", fee_tax_breakdown: { fee: { sfp_service_fee_amount: "-8", affiliate_commission_amount: "-7" } } },
      { order_id: "B", settlement_amount: "30" },
      { order: { order_id: "A" }, settlement_amount: "-3", revenue_amount: "-5" },
      { settlement_amount: "99" }, // sin pedido: se descarta
    ];
    const grupos = agruparPorPedido(lista);
    expect([...grupos.keys()]).toEqual(["A", "B"]);
    const a = interpretarTransacciones({ sku_transactions: grupos.get("A") });
    expect(a!.pago).toBeCloseTo(58.2, 2);
    expect(a!.afiliado).toBe(7);
    expect(a!.reembolsos).toBe(5);
    expect(estadoDePago(a)).toBe("por_liquidar");
    expect(interpretarTransacciones({ sku_transactions: grupos.get("B") })!.pago).toBe(30);
    expect(idDePedido({ order_info: { order_id: " 7 " } })).toBe("7");
    expect(idDePedido({})).toBeNull();
  });

  it("forma 202507 (orders/unsettled): los montos est_* cuentan como el pago estimado por TikTok, con afiliados e IVA, y un ajuste se anota a su pedido", () => {
    const d = {
      total_count: 3,
      sum_est_settlement_amount: "150.10",
      transactions: [
        { id: "t1", order_id: "A", type: "ORDER", status: "UNSETTLED", unsettled_reason: "IN_TRANSIT", currency: "MXN", order_create_time: 1790000000,
          est_revenue_amount: "199.16", est_fee_tax_amount: "-40.00", est_settlement_amount: "140.16", est_shipping_cost_amount: "-19",
          fee_tax_breakdown: { fee: { sfp_service_fee_amount: "-15.93", platform_commission_amount: "-6", affiliate_commission_amount: "-13.94" }, tax: { vat_amount: "-13.73", isr_amount: "-4.29" } } },
        { id: "t2", adjustment_id: "j1", adjustment_order_id: "A", type: "SHIPPING_FEE_COMPENSATION", status: "UNSETTLED", est_adjustment_amount: "5", est_settlement_amount: "5" },
        { id: "t3", order_id: "B", type: "ORDER", status: "UNSETTLED", est_settlement_amount: "4.94" },
      ],
    };
    expect(listaDeTransacciones(d)).toHaveLength(3);
    expect(normalizarSinLiquidar({ est_settlement_amount: "1" }).settlement_amount).toBe("1");
    const grupos = agruparPorPedido(listaDeTransacciones(d));
    expect([...grupos.keys()]).toEqual(["A", "B"]);
    const a = interpretarTransacciones({ sku_transactions: grupos.get("A") });
    expect(a!.pago).toBeCloseTo(145.16, 2);
    expect(a!.liquidado).toBe(false);
    expect(a!.estados).toEqual(["UNSETTLED"]);
    expect(a!.ingreso).toBeCloseTo(199.16, 2);
    expect(a!.afiliado).toBeCloseTo(13.94, 2);
    expect(a!.comision).toBeCloseTo(21.93, 2);
    expect(a!.ivaRetenido).toBeCloseTo(13.73, 2);
    expect(a!.isrRetenido).toBeCloseTo(4.29, 2);
    expect(a!.envio).toBe(19);
    expect(a!.cargos).toBeCloseTo(40, 2);
    expect(estadoDePago(a)).toBe("por_liquidar");
    expect(interpretarTransacciones({ sku_transactions: grupos.get("B") })!.pago).toBeCloseTo(4.94, 2);
  });
});

describe("desglose fino de los cargos (202501)", () => {
  // Pedido real 586173086672716913 (20-sep-2026), recortado: cargo de
  // servicio del 8 %, $6 por par, anuncios GMV Max, afiliado e impuestos.
  const pedido = {
    order_id: "586173086672716913",
    revenue_amount: "171.99",
    settlement_amount: "118.76",
    fee_and_tax_amount: "-53.23",
    sku_transactions: [
      {
        statement_id: "7691855658521528085",
        revenue_amount: "171.99",
        settlement_amount: "118.76",
        fee_tax_amount: "-53.23",
        shipping_cost_amount: "0",
        fee_tax_breakdown: {
          fee: {
            sfp_service_fee_amount: "-13.76",
            fee_per_item_sold_amount: "-6",
            gmv_max_ad_fee_amount: "-6.04",
            platform_commission_amount: "0",
            affiliate_ads_commission_amount: "-11.86",
          },
          tax: { iva_amount: "-11.86", isr_amount: "-3.71" },
        },
      },
    ],
  };
  it("separa servicio, cargo por par, comisión y anuncios", () => {
    const t = interpretarTransacciones(pedido)!;
    expect(t.ingreso).toBeCloseTo(171.99, 2);
    expect(t.servicio).toBeCloseTo(13.76, 2);
    expect(t.porPar).toBeCloseTo(6, 2);
    expect(t.comisionTikTok).toBe(0);
    expect(t.anuncios).toBeCloseTo(6.04, 2);
    expect(t.comision).toBeCloseTo(19.76, 2);
    expect(t.afiliado).toBeCloseTo(11.86, 2);
    expect(t.ivaRetenido).toBeCloseTo(11.86, 2);
    expect(t.isrRetenido).toBeCloseTo(3.71, 2);
    expect(t.cargos).toBeCloseTo(53.23, 2);
  });
});
