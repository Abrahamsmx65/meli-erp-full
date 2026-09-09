import { describe, expect, it } from "vitest";
import { camposLiquidacionMeli, leerPagoMercadoPago, netoVigente, pagosCobrablesCompletos, resumirPagosMeli } from "./pagos";

describe("pagos de Mercado Pago", () => {
  it("usa el saldo actual para ventas sin perder el original de control", () => {
    expect(netoVigente(170, 150)).toBe(150);
    expect(netoVigente(170, 0)).toBe(0);
    expect(netoVigente(170, null)).toBe(170);
  });

  it("aplica un cargo diferido al saldo vigente y concilia contra el original", () => {
    const resumen = resumirPagosMeli(
      [leerPagoMercadoPago({
        status: "approved",
        transaction_amount: 200,
        net_received_amount: 150,
        fee_details: [
          { type: "marketplace_fee", amount: 30 },
          { type: "shipping_fee", amount: 20 },
        ],
      })],
      200,
      30,
      170,
    );

    expect(resumen).toMatchObject({ neto: 150, comision: 30, envio: 20, cargosSinDesglosar: -20 });
    expect(netoVigente(170, resumen.neto)).toBe(150);
    // La misma elección aplica al releer la pareja neto/neto_actual de caché.
    expect(netoVigente(170, 150)).toBe(150);
  });

  it("persiste reembolso y estado junto con el saldo y los cargos del backfill", () => {
    const resumen = resumirPagosMeli(
      [leerPagoMercadoPago({
        status: "refunded",
        transaction_amount: 200,
        net_received_amount: 120,
        transaction_amount_refunded: 50,
        fee_details: [{ type: "marketplace_fee", amount: 30 }],
      })],
      200,
      30,
    );

    expect(camposLiquidacionMeli(resumen)).toMatchObject({
      estado_pago: "refunded",
      reembolsado: 50,
      reembolso_incluido_neto_base: 50,
      reembolso_base_confiable: true,
      comision_mp: 30,
      tipo_venta: "directa",
    });
  });

  it.each([
    { nombre: "total", neto: 0, reembolso: 100, comision: 0, incluido: 100 },
    { nombre: "parcial", neto: 30, reembolso: 50, comision: 20, incluido: 50 },
  ])("separa un reembolso $nombre ya presente en la primera liquidación", ({ neto, reembolso, comision, incluido }) => {
    const resumen = resumirPagosMeli(
      [leerPagoMercadoPago({
        status: "refunded",
        transaction_amount: 100,
        net_received_amount: neto,
        transaction_amount_refunded: reembolso,
        fee_details: comision ? [{ type: "marketplace_fee", amount: comision }] : [],
      })],
      100,
      comision,
    );

    expect(resumen).toMatchObject({
      neto,
      reembolsado: reembolso,
      reembolsoIncluidoNetoBase: incluido,
      reembolsoBaseConfiable: true,
      cargosSinDesglosar: 0,
    });
  });

  it("marca parcial una primera liquidación cuyo residual no prueba el reembolso", () => {
    const resumen = resumirPagosMeli(
      [leerPagoMercadoPago({
        status: "refunded",
        transaction_amount: 100,
        net_received_amount: 50,
        transaction_amount_refunded: 50,
        fee_details: [{ type: "marketplace_fee", amount: 20 }],
      })],
      100,
      20,
    );

    expect(resumen).toMatchObject({
      reembolsoIncluidoNetoBase: 30,
      reembolsoBaseConfiable: false,
      cargosSinDesglosar: 0,
    });
  });

  it("ignora una procedencia heredada si la orden aún no tenía neto confirmado", () => {
    const resumen = resumirPagosMeli(
      [leerPagoMercadoPago({
        status: "refunded",
        transaction_amount: 100,
        net_received_amount: -10,
        transaction_amount_refunded: 100,
        fee_details: [{ type: "marketplace_fee", amount: 10 }],
      })],
      100,
      10,
      undefined,
      0,
      true,
    );

    expect(resumen).toMatchObject({
      neto: -10,
      reembolsado: 100,
      reembolsoIncluidoNetoBase: 100,
      reembolsoBaseConfiable: true,
      comision: 10,
      cargosSinDesglosar: 0,
    });
  });

  it("separa comisión, envío, ISR, IVA y otros sin alterar el neto", () => {
    const pago = leerPagoMercadoPago({
      status: "approved",
      transaction_amount: 200,
      net_received_amount: 122,
      fee_details: [
        { type: "marketplace_fee", amount: 30 },
        { type: "shipping_fee", amount: 20 },
      ],
      tax_details: [
        { type: "retención ISR", amount: 5 },
        { type: "retención IVA", amount: 8 },
        { type: "cargo local", amount: 2 },
      ],
    });

    expect(pago.neto).toBe(122);
    expect(pago.cargos).toEqual({ comision: 30, envio: 20, isr: 5, iva: 8, otros: 2 });
    expect(resumirPagosMeli([pago], 200)).toMatchObject({
      neto: 122,
      comision: 30,
      envio: 20,
      isr: 5,
      iva: 8,
      otros: 2,
      cargosSinDesglosar: 13,
      tipoVenta: "directa",
    });
  });

  it("suma multipagos e ignora intentos rechazados", () => {
    const aprobado = leerPagoMercadoPago({
      status: "approved",
      net_received_amount: 60,
      fee_details: [
        { type: "marketplace_fee", amount: 15 },
        { type: "shipping", amount: 10 },
        { type: "ISR", amount: 5 },
        { type: "IVA", amount: 5 },
        { type: "ajuste", amount: 5 },
      ],
    });
    const rechazado = leerPagoMercadoPago({
      status: "rejected",
      net_received_amount: 999,
      fee_details: [{ type: "marketplace_fee", amount: 999 }],
    });
    expect(resumirPagosMeli([rechazado, aprobado], 100)).toMatchObject({
      estadoPago: "approved",
      neto: 60,
      comision: 15,
      envio: 10,
      isr: 5,
      iva: 5,
      otros: 5,
      cargosSinDesglosar: 0,
      tipoVenta: "directa",
    });
  });

  it("distingue reventa y conserva el residual cuando falta desglose", () => {
    const reventa = resumirPagosMeli(
      [leerPagoMercadoPago({ status: "approved", net_received_amount: 200 })],
      200,
      0,
    );
    expect(reventa).toMatchObject({ tipoVenta: "reventa", neto: 200, cargosSinDesglosar: 0 });

    const directa = resumirPagosMeli(
      [leerPagoMercadoPago({ status: "approved", net_received_amount: 120 })],
      200,
      30,
    );
    expect(directa).toMatchObject({
      tipoVenta: "directa",
      neto: 120,
      comision: 30,
      cargosSinDesglosar: 50,
    });
  });

  it("concilia contra el neto original aunque una revisión ya vea un reembolso", () => {
    const revisado = resumirPagosMeli(
      [leerPagoMercadoPago({
        status: "refunded",
        net_received_amount: 20,
        transaction_amount_refunded: 100,
        fee_details: [{ type: "marketplace_fee", amount: 30 }],
      })],
      200,
      30,
      120,
      0,
      true,
    );
    expect(revisado).toMatchObject({
      neto: 20,
      reembolsado: 100,
      comision: 30,
      cargosSinDesglosar: 50,
      tipoVenta: "directa",
    });
  });

  it("conserva con signo un descuadre y no duplica arreglos alias", () => {
    const pago = leerPagoMercadoPago({
      status: "approved",
      net_received_amount: 150,
      fee_details: [
        { type: "marketplace_fee", amount: 30 },
        { type: "shipping_fee", amount: 30 },
      ],
      // Mercado Pago puede repetir el mismo bloque bajo otro nombre.
      charges_details: [
        { type: "marketplace_fee", amount: 30 },
        { type: "shipping_fee", amount: 30 },
      ],
    });
    expect(pago.cargos).toEqual({ comision: 30, envio: 30, isr: 0, iva: 0, otros: 0 });
    expect(resumirPagosMeli([pago], 200).cargosSinDesglosar).toBe(-10);
  });

  it("lee cargos de un alias posterior cuando el primero viene vacío", () => {
    const pago = leerPagoMercadoPago({
      status: "approved",
      net_received_amount: 70,
      fee_details: [],
      charges_details: [
        { type: "shipping_fee", amount: 20 },
        { type: "IVA", amount: 10 },
      ],
    });

    expect(pago.cargos).toEqual({ comision: 0, envio: 20, isr: 0, iva: 10, otros: 0 });
    expect(pago.detalleCargos.map((d) => [d.clase, d.monto])).toEqual([
      ["envio", 20],
      ["iva", 10],
    ]);
  });

  it("une aliases parcialmente repetidos sin duplicar la comisión", () => {
    const pago = leerPagoMercadoPago({
      status: "approved",
      net_received_amount: 140,
      fee_details: [{ type: "marketplace_fee", amount: 30 }],
      charges_details: [
        { amount: 30, type: "marketplace_fee" },
        { type: "shipping_fee", amount: 20 },
        { type: "IVA", amount: 10 },
      ],
    });

    expect(pago.cargos).toEqual({ comision: 30, envio: 20, isr: 0, iva: 10, otros: 0 });
    expect(pago.detalleCargos.map((d) => [d.clase, d.monto])).toEqual([
      ["comision", 30],
      ["envio", 20],
      ["iva", 10],
    ]);
  });

  it("reconoce la misma comisión aunque un alias use type y otro name", () => {
    const pago = leerPagoMercadoPago({
      status: "approved",
      net_received_amount: 70,
      fee_details: [{ type: "marketplace_fee", amount: 30 }],
      charges_details: [
        { name: "Mercado Pago fee", amount: 30 },
        { name: "shipping fee", amount: 10 },
      ],
    });

    expect(pago.cargos).toEqual({ comision: 30, envio: 10, isr: 0, iva: 0, otros: 0 });
    expect(pago.detalleCargos).toHaveLength(2);
  });

  it("no duplica un impuesto repetido entre cargos e impuestos", () => {
    const pago = leerPagoMercadoPago({
      status: "approved",
      transaction_amount: 200,
      net_received_amount: 160,
      fee_details: [{ type: "marketplace_fee", amount: 30 }],
      charges_details: [{ name: "IVA", amount: 10 }],
      tax_details: [{ type: "IVA", amount: 10 }],
    });

    expect(pago.cargos).toEqual({ comision: 30, envio: 0, isr: 0, iva: 10, otros: 0 });
    expect(resumirPagosMeli([pago], 200).cargosSinDesglosar).toBe(0);
  });

  it("no certifica una revisión si un pago cobrable llegó sin saldo", () => {
    const aprobadoIncompleto = leerPagoMercadoPago({ status: "approved", transaction_amount: 100 });
    const rechazadoSinSaldo = leerPagoMercadoPago({ status: "rejected", transaction_amount: 100 });
    const aprobadoCompleto = leerPagoMercadoPago({ status: "approved", net_received_amount: 80 });

    expect(pagosCobrablesCompletos([aprobadoIncompleto])).toBe(false);
    expect(pagosCobrablesCompletos([rechazadoSinSaldo, aprobadoCompleto])).toBe(true);
    expect(pagosCobrablesCompletos([rechazadoSinSaldo])).toBe(true);
  });

  it("no suma ni guarda parcialmente una orden con dos pagos cobrables si uno llegó incompleto", () => {
    const completo = leerPagoMercadoPago({ status: "approved", net_received_amount: 80 });
    const incompleto = leerPagoMercadoPago({ status: "approved", transaction_amount: 100 });
    const rechazado = leerPagoMercadoPago({ status: "rejected", transaction_amount: 100 });

    expect(resumirPagosMeli([completo, incompleto], 200).neto).toBeNull();
    expect(resumirPagosMeli([completo, rechazado], 100).neto).toBe(80);
  });
});