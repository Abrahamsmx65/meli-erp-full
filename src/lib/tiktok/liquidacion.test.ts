import { describe, expect, it } from "vitest";
import { estadoDePago, interpretarTransacciones, listaDeTransacciones } from "./liquidacion";

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

describe("interpretarTransacciones", () => {
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
});
