/**
 * La cascada de dinero con la forma REAL del pago de Mercado Pago
 * (`/v1/payments/{id}`: charges_details con nombre, lado y reembolso) y las
 * reglas del sistema de referencia del dueño, auditado contra "Ventas MX".
 */
import { describe, expect, it } from "vitest";
import { claseDeEntrada, leerPagoMercadoPago, reconstruirReventa, resumirPagosMeli } from "./pagos";
import { contextoDeOrden, recortarOrden, type OrdenMeliCruda } from "./orden";

/** Un cargo de charges_details tal como lo publica Mercado Pago. */
const cargo = (name: string, type: string, original: number, extra?: Record<string, unknown>) => ({
  id: `${name}-1`,
  name,
  type,
  accounts: { from: "collector", to: "mp" },
  amounts: { original, refunded: 0 },
  ...extra,
});

/** Ejemplo de control del PROMPT: precio público 314.71, comisión 15 %, envío 67.60. */
const PAGO_CONTROL = {
  id: 1,
  status: "approved",
  transaction_amount: 314.71,
  transaction_amount_refunded: 0,
  money_release_date: "2026-09-20T10:00:00.000-04:00",
  transaction_details: { net_received_amount: 171.41, total_paid_amount: 314.71 },
  charges_details: [
    cargo("meli_fee", "fee", 47.21),
    cargo("tax_withholding-iva", "tax", 21.71),
    cargo("tax_withholding-isr", "tax", 6.78),
    cargo("shipping-fee", "shipping", 67.6),
    // Cupón que MELI le regala al comprador: no es un cargo al vendedor.
    { name: "coupon", type: "discount", accounts: { from: "ml", to: "payer" }, amounts: { original: 30, refunded: 0 } },
  ],
};

const ORDEN_CONTROL: OrdenMeliCruda = {
  id: 2000018341066916,
  status: "paid",
  date_created: "2026-09-01T10:00:00.000-04:00",
  total_amount: 314.71,
  paid_amount: 314.71,
  static_tags: [],
  shipping: { id: 44556677 },
  payments: [{ id: 1, status: "approved", transaction_amount: 314.71, shipping_cost: 0 }],
  order_items: [
    { quantity: 1, unit_price: 314.71, sale_fee: 47.21, listing_type_id: "gold_special", item: { id: "MLM1", category_id: "MLM1234", seller_sku: "GT135-DK-25" } },
  ],
};

describe("clasificación de charges_details", () => {
  it("reconoce cada cargo por su nombre y descarta lo que MELI paga por el comprador", () => {
    expect(claseDeEntrada(cargo("tax_withholding-iva", "tax", 1))).toBe("iva");
    expect(claseDeEntrada(cargo("tax_withholding-isr", "tax", 1))).toBe("isr");
    expect(claseDeEntrada(cargo("meli_fee", "fee", 1))).toBe("comision");
    expect(claseDeEntrada(cargo("shipping-fee", "shipping", 1))).toBe("envio");
    // Financiamiento o cupón cofinanciado: cargo al vendedor → comisión.
    expect(claseDeEntrada(cargo("financing_fee", "fee", 1))).toBe("comision");
    expect(claseDeEntrada(cargo("coupon_fee", "coupon", 1))).toBe("comision");
    // ml → payer: no cuenta.
    expect(claseDeEntrada({ name: "coupon", type: "discount", accounts: { from: "ml", to: "payer" } })).toBeNull();
    expect(claseDeEntrada({ type: "mercadopago_fee", fee_payer: "payer", amount: 1 })).toBeNull();
  });
});

describe("ejemplo de control: 314.71 → 171.41", () => {
  it("lee el pago real: comisión 47.21, retenciones 28.49, envío 67.60, libera el 20", () => {
    const pago = leerPagoMercadoPago(PAGO_CONTROL, "v1/payments");
    expect(pago.cargos).toEqual({ comision: 47.21, envio: 67.6, isr: 6.78, iva: 21.71, otros: 0 });
    expect(pago.neto).toBe(171.41);
    expect(pago.liberaEn).toBe("2026-09-20T10:00:00.000-04:00");
    expect(pago.fuente).toBe("v1/payments");
    // El crudo se guarda recortado: cargos y dinero sí, sin comprador.
    expect(pago.crudo.charges_details).toHaveLength(5);
    expect(pago.crudo).not.toHaveProperty("payer");
  });

  it("la cascada de la orden cierra al centavo y queda completa", () => {
    const pago = leerPagoMercadoPago(PAGO_CONTROL, "v1/payments");
    const contexto = contextoDeOrden(ORDEN_CONTROL, Date.parse("2026-09-03T00:00:00Z"));
    const r = resumirPagosMeli([pago], 314.71, 47.21, undefined, undefined, undefined, contexto);
    expect(r.tipoVenta).toBe("directa");
    expect(r.comision).toBe(47.21);
    expect(r.envio).toBe(67.6);
    expect(r.isr + r.iva).toBeCloseTo(28.49, 2);
    expect(r.facturado).toBe(314.71);
    expect(r.netoCalculado).toBe(171.41);
    expect(r.neto).toBe(171.41);
    expect(r.cargosSinDesglosar).toBe(0);
    expect(r.cargosCompletos).toBe(true);
    expect(r.fuente).toBe("v1/payments");
    expect(r.liberaEn).toBe("2026-09-20T10:00:00.000-04:00");
  });
});

describe("comisión = máx(cargos del pago, Σ sale_fee × cantidad)", () => {
  const pagoIncompleto = leerPagoMercadoPago(
    { ...PAGO_CONTROL, charges_details: [cargo("meli_fee", "fee", 69.95)] },
    "v1/payments",
  );

  it("orden de menos de 24 h con la comisión a medias: manda el sale_fee y NO queda completa", () => {
    const contexto = contextoDeOrden(ORDEN_CONTROL, Date.parse("2026-09-01T16:00:00.000Z"));
    const r = resumirPagosMeli([pagoIncompleto], 314.71, 199.36, undefined, undefined, undefined, contexto);
    expect(r.comision).toBe(199.36);
    expect(r.cargosCompletos).toBe(false);
  });

  it("orden vieja con la comisión abajo del sale_fee: manda el sale_fee (MELI la factura aparte) y sí queda completa", () => {
    const contexto = contextoDeOrden(ORDEN_CONTROL, Date.parse("2026-09-10T00:00:00Z"));
    const r = resumirPagosMeli([pagoIncompleto], 314.71, 199.36, undefined, undefined, undefined, contexto);
    expect(r.comision).toBe(199.36);
    expect(r.cargosCompletos).toBe(true);
  });

  it("los cargos pueden exceder el sale_fee (cupón cofinanciado): mandan los cargos", () => {
    const pago = leerPagoMercadoPago(
      { ...PAGO_CONTROL, charges_details: [cargo("meli_fee", "fee", 47.21), cargo("coupon_fee", "coupon", 10)] },
      "v1/payments",
    );
    const contexto = contextoDeOrden(ORDEN_CONTROL, Date.parse("2026-09-10T00:00:00Z"));
    const r = resumirPagosMeli([pago], 314.71, 47.21, undefined, undefined, undefined, contexto);
    expect(r.comision).toBe(57.21);
  });
});

describe("envío del vendedor", () => {
  it("el cargo shipping del pago mezcla vendedor y comprador: manda /costs y, si no, la resta", () => {
    const pago = leerPagoMercadoPago(
      { ...PAGO_CONTROL, charges_details: [cargo("meli_fee", "fee", 47.21), cargo("shipping-fee", "shipping", 188)] },
      "v1/payments",
    );
    const orden: OrdenMeliCruda = {
      ...ORDEN_CONTROL,
      payments: [{ id: 1, status: "approved", transaction_amount: 422.71, shipping_cost: 108 }],
    };
    const base = contextoDeOrden(orden, Date.parse("2026-09-10T00:00:00Z"));
    expect(base.envioComprador).toBe(108);
    // Sin /costs: 188 − 108 = 80.
    expect(resumirPagosMeli([pago], 314.71, 47.21, undefined, undefined, undefined, base).envio).toBe(80);
    // Con /costs: lo que MELI dice que paga el vendedor.
    expect(resumirPagosMeli([pago], 314.71, 47.21, undefined, undefined, undefined, { ...base, envioVendedor: 79.5 }).envio).toBe(79.5);
  });
});

describe("reventa (A cargo de Mercado Libre)", () => {
  const pagoSinCargos = leerPagoMercadoPago(
    {
      id: 2,
      status: "approved",
      transaction_amount: 199.9,
      transaction_details: { net_received_amount: 199.9 },
      charges_details: [],
    },
    "v1/payments",
  );
  const ordenReventa: OrdenMeliCruda = {
    ...ORDEN_CONTROL,
    static_tags: ["meli_resale"],
    total_amount: 199.9,
    paid_amount: 199.9,
    payments: [{ id: 2, status: "approved", transaction_amount: 199.9, shipping_cost: 0 }],
    order_items: [{ quantity: 1, unit_price: 199.9, sale_fee: null, listing_type_id: "gold_special", item: { id: "MLM1", category_id: "MLM1234" } }],
  };

  it("se marca por static_tags aunque tenga minutos de creada, y sin reconstruir queda sin comisión ni envío", () => {
    const contexto = contextoDeOrden(ordenReventa, Date.parse("2026-09-01T14:05:00.000Z"));
    const r = resumirPagosMeli([pagoSinCargos], 199.9, 0, undefined, undefined, undefined, contexto);
    expect(r.tipoVenta).toBe("reventa");
    expect(r.comision).toBe(0);
    expect(r.envio).toBe(0);
    expect(r.totalComprador).toBeNull();
    expect(r.cargosSinDesglosar).toBe(0);
  });

  it("reconstruye el precio público: 199.90 + 67.60 de envío + 15 % → 314.71, y el neto no cambia", () => {
    const contexto = contextoDeOrden(ordenReventa, Date.parse("2026-09-10T00:00:00Z"));
    const r = resumirPagosMeli([pagoSinCargos], 199.9, 0, undefined, undefined, undefined, {
      ...contexto,
      envioVendedor: 67.6,
      renglones: [{ unidades: 1, importe: 199.9, categoria: "MLM1234", listing: "gold_special", tarifa: { porcentaje: 15, fijo: 0 } }],
    });
    expect(r.tipoVenta).toBe("reventa");
    expect(r.totalComprador).toBe(314.71);
    expect(r.comision).toBe(47.21);
    expect(r.envio).toBe(67.6);
    expect(r.isr + r.iva).toBe(0);
    expect(r.neto).toBe(199.9);
    expect(r.netoCalculado).toBe(199.9);
    expect(r.cargosSinDesglosar).toBe(0);
    // facturado − comisión − envío = exactamente lo depositado.
    expect(Math.round((r.totalComprador! - r.comision - r.envio) * 100) / 100).toBe(199.9);
  });

  it("respaldo: todos los sale_fee en null solo cuenta pasadas 24 h", () => {
    const orden: OrdenMeliCruda = { ...ordenReventa, static_tags: [] };
    const reciente = contextoDeOrden(orden, Date.parse("2026-09-01T16:00:00.000Z"));
    expect(resumirPagosMeli([pagoSinCargos], 199.9, 0, undefined, undefined, undefined, reciente).tipoVenta).toBe("directa");
    const vieja = contextoDeOrden(orden, Date.parse("2026-09-05T00:00:00Z"));
    expect(resumirPagosMeli([pagoSinCargos], 199.9, 0, undefined, undefined, undefined, vieja).tipoVenta).toBe("reventa");
  });

  it("GUARD: si el pago sí trae cargos, mandan los cargos aunque venga la etiqueta", () => {
    const conCargos = leerPagoMercadoPago(PAGO_CONTROL, "v1/payments");
    const contexto = contextoDeOrden(ordenReventa, Date.parse("2026-09-10T00:00:00Z"));
    expect(resumirPagosMeli([conCargos], 314.71, 47.21, undefined, undefined, undefined, contexto).tipoVenta).toBe("directa");
  });

  it("reconstruirReventa: sin tarifa en un renglón no se estima nada", () => {
    expect(reconstruirReventa([{ unidades: 1, importe: 100, tarifa: null }], 0)).toBeNull();
    expect(reconstruirReventa([{ unidades: 2, importe: 200, tarifa: { porcentaje: 10, fijo: 5 } }], 20)).toEqual({
      // unitBase 100, unitShip 10, unitPublic (100+10+5)/0.9 = 127.78 → comisión 2 × 17.78
      comision: 35.56,
      envio: 20,
      facturado: 255.56,
    });
  });
});

describe("retenciones sumadas y reembolsos por cargo", () => {
  it("taxes_amount sin desglose va a «retención sin separar», nunca a otros", () => {
    const pago = leerPagoMercadoPago({ status: "approved", net_received_amount: 118.98, transaction_amount: 208, marketplace_fee: 31.2, taxes_amount: 20.82, shipping_cost: 37 });
    expect(pago.cargos).toMatchObject({ comision: 31.2, envio: 37, isr: 0, iva: 0, otros: 0 });
    expect(pago.retencionSinSeparar).toBe(20.82);
    const r = resumirPagosMeli([pago], 208, 31.2);
    expect(r.retencionSinSeparar).toBe(20.82);
    expect(r.cargosSinDesglosar).toBe(0);
    expect(r.fuente).toBe("collections");
  });

  it("amounts.refunded dice qué le regresó MELI al vendedor de cada cargo", () => {
    const pago = leerPagoMercadoPago(
      {
        ...PAGO_CONTROL,
        status: "refunded",
        transaction_amount_refunded: 314.71,
        charges_details: [
          cargo("meli_fee", "fee", 47.21, { amounts: { original: 47.21, refunded: 47.21 } }),
          cargo("tax_withholding-iva", "tax", 21.71, { amounts: { original: 21.71, refunded: 21.71 } }),
          cargo("tax_withholding-isr", "tax", 6.78, { amounts: { original: 6.78, refunded: 6.78 } }),
          cargo("shipping-fee", "shipping", 67.6),
        ],
      },
      "v1/payments",
    );
    expect(pago.cargosReembolsados).toEqual({ comision: 47.21, envio: 0, retenciones: 28.49 });
    const r = resumirPagosMeli([pago], 314.71, 47.21);
    expect(r.comisionReembolsada).toBe(47.21);
    expect(r.retencionReembolsada).toBe(28.49);
    expect(r.envioReembolsado).toBe(0);
  });
});

describe("la orden recortada", () => {
  it("guarda dinero, etiquetas, envío y renglones; no guarda al comprador", () => {
    const cruda = recortarOrden({ ...ORDEN_CONTROL, buyer: { id: 1, nickname: "X" } } as OrdenMeliCruda);
    expect(cruda).toMatchObject({ id: ORDEN_CONTROL.id, shipping_id: 44556677, paid_amount: 314.71 });
    expect(cruda).not.toHaveProperty("buyer");
    expect((cruda.order_items as unknown[]).length).toBe(1);
  });
});

describe("bonificación de envío de Full (hallazgo de agosto: venta 2000018009489512)", () => {
  // El pago trae shp_fulfillment 95 (costo de lista) y deposita 0.68;
  // /shipments/{id}/costs dice 38 y el reporte de Ventas de MELI: Costos de
  // envío −38, Total 57.68.
  const pagoFull = leerPagoMercadoPago(
    {
      id: 173618624927,
      status: "approved",
      transaction_amount: 125.99,
      transaction_details: { net_received_amount: 0.68 },
      charges_details: [
        cargo("tax_withholding-isr", "tax", 2.72),
        cargo("tax_withholding-iva", "tax", 8.69),
        cargo("meli_fee", "fee", 18.9),
        cargo("shp_fulfillment", "shipping", 95),
      ],
    },
    "v1/payments",
  );
  const ordenFull: OrdenMeliCruda = {
    ...ORDEN_CONTROL,
    id: 2000018009489512,
    total_amount: 125.99,
    paid_amount: 125.99,
    pack_id: 2000014603146561,
    shipping: { id: 47804778972 },
    payments: [{ id: 173618624927, status: "approved", transaction_amount: 125.99, shipping_cost: 0 }],
    order_items: [{ quantity: 1, unit_price: 125.99, sale_fee: 18.9, listing_type_id: "gold_special", item: { id: "MLM2", category_id: "MLM192717", seller_sku: "MY2307-BLK-24-MX" } }],
  };
  const contexto = contextoDeOrden(ordenFull, Date.parse("2026-09-09T00:00:00Z"));

  it("sin /costs el neto es el depósito crudo y el envío el cargo de lista", () => {
    const r = resumirPagosMeli([pagoFull], 125.99, 18.9, undefined, undefined, undefined, contexto);
    expect(r.envio).toBe(95);
    expect(r.neto).toBe(0.68);
    expect(r.netoPago).toBe(0.68);
    expect(r.ajusteEnvio).toBe(0);
    expect(r.envioLeido).toBe(false);
  });

  it("con /costs = 38 el envío es 38, la bonificación 57 y el neto 57.68 (lo que MELI dice que te deja), sin nada sin desglosar", () => {
    const r = resumirPagosMeli([pagoFull], 125.99, 18.9, undefined, undefined, undefined, { ...contexto, envioVendedor: 38 });
    expect(r.envio).toBe(38);
    expect(r.envioCargos).toBe(95);
    expect(r.ajusteEnvio).toBe(57);
    expect(r.netoPago).toBe(0.68);
    expect(r.neto).toBe(57.68);
    expect(r.netoBase).toBe(57.68);
    expect(r.netoCalculado).toBe(57.68);
    expect(r.cargosSinDesglosar).toBe(0);
    expect(r.envioLeido).toBe(true);
  });

  it("con un control crudo guardado (0.68 de la primera liquidación) el neto base también lleva el ajuste", () => {
    const r = resumirPagosMeli([pagoFull], 125.99, 18.9, 0.68, undefined, undefined, { ...contexto, envioVendedor: 38 });
    expect(r.netoBase).toBe(57.68);
    expect(r.cargosSinDesglosar).toBe(0);
  });

  it("la hermana de un paquete cuyo pago no trae el cargo de envío no paga envío aunque /costs diga 76", () => {
    const pagoHermana = leerPagoMercadoPago(
      { id: 9, status: "approved", transaction_amount: 119.69, transaction_details: { net_received_amount: 90.91 }, charges_details: [cargo("meli_fee", "fee", 17.95), cargo("tax_withholding-isr", "tax", 2.58), cargo("tax_withholding-iva", "tax", 8.25)] },
      "v1/payments",
    );
    const r = resumirPagosMeli([pagoHermana], 119.69, 17.95, undefined, undefined, undefined, { ...contexto, envioVendedor: 76 });
    expect(r.envio).toBe(0);
    expect(r.ajusteEnvio).toBe(0);
    expect(r.neto).toBe(90.91);
    expect(r.cargosSinDesglosar).toBe(0);
  });
});
