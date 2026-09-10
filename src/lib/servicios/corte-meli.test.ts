import { describe, expect, it } from "vitest";
import {
  armarEstadoResultados,
  desglosePorSkuDesdeRpc,
  nombreDelPeriodo,
  periodoAnterior,
  periodoSiguiente,
  rangoDelPeriodo,
  validarPeriodo,
  type EntradaCorte,
} from "./corte-meli";
import { puenteVentaANeto } from "./corte-meli-cascada";

/**
 * El corte del mes: exacto al centavo, con órdenes canceladas fuera,
 * devoluciones restadas una sola vez, y el neto tomado de las órdenes.
 */

function base(extra?: Partial<EntradaCorte>): EntradaCorte {
  return {
    periodo: "2026-08",
    desde: "2026-08-01",
    hasta: "2026-08-31",
    cuenta: "GETAC",
    generadoEn: "2026-09-07T12:00:00.000Z",
    ventas: [],
    ordenes: [],
    modeloDeSku: new Map([
      ["GT135-TABACO-25", "GT135"],
      ["GT135-TABACO-26", "GT135"],
      ["MY2307-BLACK-25", "MY2307"],
    ]),
    config: new Map([
      ["GT135", { categoria: "Corcho", costo: 60.5 }],
      ["MY2307", { categoria: "EVA", costo: null }],
    ]),
    adsPorModelo: new Map(),
    adsSinAmarre: 0,
    errorAds: null,
    gastos: [],
    cargos: [],
    cargosLeidos: true,
    ...extra,
  };
}

function esperarPuenteCuadrado(e: ReturnType<typeof armarEstadoResultados>) {
  const puente = puenteVentaANeto(e);
  expect(
    puente.ventaBruta
      - puente.comision
      - puente.envio
      - puente.isr
      - puente.iva
      - puente.otros
      - puente.ajusteLiquidacion
      - puente.devolucionesIncluidasEnNeto,
  ).toBe(puente.netoDepositado);
}

describe("periodo", () => {
  it("valida y arma el rango del mes sin pasarse de hoy", () => {
    expect(validarPeriodo("2026-08")).toBe("2026-08");
    expect(validarPeriodo("2026-13")).toBeNull();
    expect(validarPeriodo("agosto")).toBeNull();
    expect(rangoDelPeriodo("2026-08", "2026-09-07")).toEqual({ desde: "2026-08-01", hasta: "2026-08-31" });
    expect(rangoDelPeriodo("2026-09", "2026-09-07")).toEqual({ desde: "2026-09-01", hasta: "2026-09-07" });
    expect(rangoDelPeriodo("2026-02", "2026-09-07")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(nombreDelPeriodo("2026-08")).toBe("Agosto 2026");
    expect(periodoAnterior("2026-01")).toBe("2025-12");
    expect(periodoSiguiente("2026-12")).toBe("2027-01");
  });
});

describe("armarEstadoResultados", () => {
  it.each([
    { nombre: "total", neto: 0, reembolso: 100, comision: 0, incluido: 100 },
    { nombre: "parcial", neto: 30, reembolso: 50, comision: 20, incluido: 50 },
  ])("no descuenta dos veces un reembolso $nombre presente en la primera lectura", ({ neto, reembolso, comision, incluido }) => {
    const e = armarEstadoResultados(base({
      ventas: [{
        sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1,
        importe: 100, comision, neto,
      }],
      config: new Map([["GT135", { categoria: "Corcho", costo: 0 }]]),
      ordenes: [{
        orderId: 1,
        fecha: "2026-08-03",
        total: 100,
        neto,
        netoActual: null,
        netoLeido: true,
        reembolsado: reembolso,
        reembolsoIncluidoNetoBase: incluido,
        reembolsoBaseConfiable: true,
        estado: "paid",
        estadoPago: "refunded",
        revisiones: 2,
        comisionMp: comision,
        cargosSinDesglosar: 0,
        cargosLeidos: true,
        renglones: [{ sku: "GT135-TABACO-25", unidades: 1, importe: 100 }],
      }],
    }));

    expect(e.netoDepositado).toBe(neto);
    expect(e.devoluciones.incluidoEnNeto).toBe(reembolso);
    expect(e.devoluciones.monto).toBe(0);
    expect(e.cargosSinDesglosar).toBe(0);
    expect(e.ajusteLiquidacion).toBe(0);
    expect(e.utilidadNeta).toBe(neto);
    expect(e.revision.exacto).toBe(true);
    esperarPuenteCuadrado(e);
  });

  it("no vuelve a descontar un reembolso base ambiguo y marca el corte parcial", () => {
    const e = armarEstadoResultados(base({
      ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 50 }],
      config: new Map([["GT135", { categoria: "Corcho", costo: 0 }]]),
      ordenes: [{
        orderId: 1, fecha: "2026-08-03", total: 100, neto: 50, netoActual: null,
        netoLeido: true, reembolsado: 50, reembolsoIncluidoNetoBase: 30,
        reembolsoBaseConfiable: false, estado: "paid", estadoPago: "refunded",
        revisiones: 2, comisionMp: 20, cargosSinDesglosar: 0, cargosLeidos: true,
        renglones: [{ sku: "GT135-TABACO-25", unidades: 1, importe: 100 }],
      }],
    }));

    expect(e.netoDepositado).toBe(50);
    expect(e.devoluciones.incluidoEnNeto).toBe(30);
    expect(e.devoluciones.monto).toBe(0);
    expect(e.utilidadNeta).toBe(50);
    expect(e.revision.exacto).toBe(false);
    expect(e.avisos.some((aviso) => aviso.includes("primera vez con un reembolso"))).toBe(true);
  });

  it("NO estima los días con saldos de Mercado Pago sin leer: quedan fuera del neto y se declaran", () => {
    const ventas = [
      { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 0 },
      { sku: "MY2307-BLACK-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 0 },
    ];
    const leida = {
      orderId: 1, fecha: "2026-08-03", total: 100, neto: 80, netoActual: null,
      netoLeido: true, reembolsado: 0, estado: "paid", estadoPago: "approved",
      revisiones: 2, comisionMp: 20, cargosLeidos: true,
      renglones: [{ sku: "GT135-TABACO-25", importe: 100, unidades: 1 }],
    };
    const pendiente = {
      orderId: 2, fecha: "2026-08-03", total: 100, neto: 0, netoActual: null,
      netoLeido: false, reembolsado: 0, estado: "paid", estadoPago: null,
      revisiones: 0, cargosLeidos: false,
      renglones: [{ sku: "MY2307-BLACK-25", importe: 100, unidades: 1 }],
    };

    for (const ordenes of [[leida, pendiente], [{ ...leida, neto: 0, netoLeido: false, cargosLeidos: false }, pendiente]]) {
      const e = armarEstadoResultados(base({ ventas, ordenes }));
      expect(e.netoDepositado).toBe(0);
      expect(e.netoEstimado).toBe(0);
      expect(e.ventaSinDeposito).toBe(200);
      expect(e.coberturaNetoReal).toBe(0);
      expect(e.porModelo.reduce((a, m) => a + m.neto, 0)).toBe(0);
      expect(e.revision.exacto).toBe(false);
      expect(e.avisos.some((a) => a.includes("NO está en el neto"))).toBe(true);
    }
  });

  it("conserva un saldo cero confirmado sin sustituirlo por una estimación", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 0 }],
        config: new Map([["GT135", { categoria: "Corcho", costo: 0 }]]),
        ordenes: [{
          orderId: 1, fecha: "2026-08-03", total: 100, neto: 80, netoActual: 0, netoLeido: true,
          reembolsado: 80, reembolsoIncluidoNetoBase: 0, reembolsoBaseConfiable: true,
          estado: "paid", estadoPago: "refunded", revisiones: 2,
          comisionMp: 20, cargosSinDesglosar: 0, cargosLeidos: true,
          renglones: [{ sku: "GT135-TABACO-25", importe: 100, unidades: 1 }],
        }],
      }),
    );
    expect(e.netoDepositado).toBe(0);
    expect(e.netoEstimado).toBe(0);
    expect(e.coberturaNetoReal).toBe(1);
    expect(e.porModelo[0].neto).toBe(0);
    expect(e.revision.exacto).toBe(true);
  });

  it("preserva un saldo cero confirmado y deja fuera (sin estimar) la venta pendiente del mismo día", () => {
    const e = armarEstadoResultados(base({
      ventas: [
        {
          sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1,
          importe: 100, comision: 20, neto: 0, netoConfirmado: true,
        },
        {
          sku: "MY2307-BLACK-25", fecha: "2026-08-03", unidades: 1, ordenes: 1,
          importe: 100, comision: 20, neto: 0, netoConfirmado: false,
        },
      ],
      config: new Map([
        ["GT135", { categoria: "Corcho", costo: 0 }],
        ["MY2307", { categoria: "EVA", costo: 0 }],
      ]),
    }));

    expect(e.netoDepositado).toBe(0);
    expect(e.ventaSinDeposito).toBe(100);
    expect(e.coberturaNetoReal).toBe(0.5);
    expect(e.porModelo.find((m) => m.modelo === "GT135")?.neto).toBe(0);
    expect(e.porModelo.find((m) => m.modelo === "MY2307")?.neto).toBe(0);
    expect(e.revision.exacto).toBe(false);
  });

  it("usa el saldo actual aunque un reembolso grande lo aleje del neto original", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 0 }],
        config: new Map([["GT135", { categoria: "Corcho", costo: 0 }]]),
        ordenes: [{
          orderId: 1, fecha: "2026-08-03", total: 100, neto: 80, netoActual: 20,
          reembolsado: 60, reembolsoIncluidoNetoBase: 0, reembolsoBaseConfiable: true,
          estado: "paid", estadoPago: "refunded", revisiones: 2,
          comisionMp: 20, cargosSinDesglosar: 0, cargosLeidos: true, tipoVenta: "directa",
          renglones: [{ sku: "GT135-TABACO-25", importe: 100, unidades: 1 }],
        }],
      }),
    );

    expect(e.netoDepositado).toBe(20);
    expect(e.devoluciones).toMatchObject({ incluidoEnNeto: 60, monto: 0 });
    expect(e.porModelo[0]).toMatchObject({ modelo: "GT135", neto: 20 });
    expect(e.utilidadNeta).toBe(20);
    expect(e.revision.exacto).toBe(true);
    esperarPuenteCuadrado(e);
  });

  it("no confunde un reembolso reflejado con cargos sin desglose", () => {
    const e = armarEstadoResultados(base({
      ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 80 }],
      config: new Map([["GT135", { categoria: "Corcho", costo: 0 }]]),
      ordenes: [{
        orderId: 1, fecha: "2026-08-03", total: 100, neto: 80, netoActual: 20,
        reembolsado: 60, estado: "paid", estadoPago: "refunded", revisiones: 2,
        cargosLeidos: false,
      }],
    }));

    expect(e).toMatchObject({
      netoDepositado: 20,
      cargosSinDesglosar: 0,
      devoluciones: { incluidoEnNeto: 60, monto: 0 },
    });
    esperarPuenteCuadrado(e);
  });

  it("cuadra cargos y reembolsos cuando solo algunas órdenes tienen desglose", () => {
    const e = armarEstadoResultados(base({
      ventas: [
        { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 70 },
        { sku: "MY2307-BLACK-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 80 },
      ],
      config: new Map([
        ["GT135", { categoria: "Corcho", costo: 0 }],
        ["MY2307", { categoria: "EVA", costo: 0 }],
      ]),
      ordenes: [
        {
          orderId: 1, fecha: "2026-08-03", total: 100, neto: 70, netoActual: 70,
          reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2,
          comisionMp: 20, envio: 10, cargosSinDesglosar: 0, cargosLeidos: true,
        },
        {
          orderId: 2, fecha: "2026-08-03", total: 100, neto: 80, netoActual: 20,
          reembolsado: 60, estado: "paid", estadoPago: "refunded", revisiones: 2,
          cargosLeidos: false,
        },
      ],
    }));

    // Con desglose en alguna orden se usa el desglose por orden: la comisión
    // es la de Mercado Pago (solo la orden 1) y la orden sin desglose aporta
    // su cargo exacto, total − depósito original (100 − 80 = 20).
    expect(e).toMatchObject({
      netoDepositado: 90,
      comision: 20,
      envio: 10,
      cargosSinDesglosar: 20,
      devoluciones: { incluidoEnNeto: 60, monto: 0 },
    });
    expect(e.revision.exacto).toBe(false);
    esperarPuenteCuadrado(e);
  });

  it("explica un cargo posterior sin convertirlo en residual ni descontarlo dos veces", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 80 }],
        config: new Map([["GT135", { categoria: "Corcho", costo: 0 }]]),
        ordenes: [{
          orderId: 1, fecha: "2026-08-03", total: 100, neto: 80, netoActual: 70,
          reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2,
          comisionMp: 20, envio: 10, cargosSinDesglosar: -10, cargosLeidos: true, tipoVenta: "directa",
          renglones: [{ sku: "GT135-TABACO-25", importe: 100, unidades: 1 }],
        }],
      }),
    );

    expect(e).toMatchObject({
      ventaBruta: 100,
      comision: 20,
      envio: 10,
      cargosSinDesglosar: -10,
      ajusteLiquidacion: 10,
      netoDepositado: 70,
      utilidadNeta: 70,
    });
    expect(100 - 20 - 10 - e.otrosCargos - e.cargosSinDesglosar - e.ajusteLiquidacion).toBe(70);
    expect(e.porModelo[0]).toMatchObject({ neto: 70, comision: 20, envio: 10, otrosCargos: -10, ajusteLiquidacion: 10 });
    expect(e.revision.exacto).toBe(true);
  });

  it.each([
    ["histórica", 800],
    ["refrescada", 700],
  ])("acepta una fila diaria %s cuando el reembolso ya bajó el saldo", (_caso, netoFila) => {
    const e = armarEstadoResultados(base({
      ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 1_000, comision: 200, neto: netoFila }],
      config: new Map([["GT135", { categoria: "Corcho", costo: 0 }]]),
      ordenes: [{
        orderId: 1, fecha: "2026-08-03", total: 1_000, neto: 800, netoActual: 700,
        reembolsado: 100, reembolsoIncluidoNetoBase: 0, reembolsoBaseConfiable: true,
        estado: "paid", estadoPago: "refunded", revisiones: 2,
        comisionMp: 200, cargosSinDesglosar: 0, cargosLeidos: true,
        renglones: [{ sku: "GT135-TABACO-25", importe: 1_000, unidades: 1 }],
      }],
    }));

    expect(e.netoDepositado).toBe(700);
    expect(e.revision.exacto).toBe(true);
    expect(e.avisos.some((a) => a.includes("no cuadran"))).toBe(false);
  });

  it("acepta la fila diaria refrescada después de un cargo diferido", () => {
    const e = armarEstadoResultados(base({
      ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 1_000, comision: 200, neto: 700 }],
      config: new Map([["GT135", { categoria: "Corcho", costo: 0 }]]),
      ordenes: [{
        orderId: 1, fecha: "2026-08-03", total: 1_000, neto: 800, netoActual: 700,
        reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2,
        comisionMp: 200, envio: 100, cargosSinDesglosar: -100, cargosLeidos: true,
        renglones: [{ sku: "GT135-TABACO-25", importe: 1_000, unidades: 1 }],
      }],
    }));

    expect(e).toMatchObject({ netoDepositado: 700, ajusteLiquidacion: 100 });
    expect(e.revision.exacto).toBe(true);
    expect(e.avisos.some((a) => a.includes("no cuadran"))).toBe(false);
    esperarPuenteCuadrado(e);
  });

  it("conserva el neto diario completo si solo se guardó parte de las órdenes", () => {
    const e = armarEstadoResultados(base({
      ventas: [
        { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 80 },
        { sku: "MY2307-BLACK-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 80 },
      ],
      config: new Map([
        ["GT135", { categoria: "Corcho", costo: 0 }],
        ["MY2307", { categoria: "EVA", costo: 0 }],
      ]),
      ordenes: [{
        orderId: 1, fecha: "2026-08-03", total: 100, neto: 80, netoActual: null,
        reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2,
        comisionMp: 20, cargosSinDesglosar: 0, cargosLeidos: true,
        renglones: [{ sku: "GT135-TABACO-25", importe: 100, unidades: 1 }],
      }],
    }));

    expect(e.netoDepositado).toBe(160);
    expect(e.coberturaNetoReal).toBe(1);
    expect(e.porModelo.reduce((total, fila) => total + fila.neto, 0)).toBe(160);
    expect(e.avisos.some((a) => a.includes("no cuadran"))).toBe(true);
    expect(e.revision.exacto).toBe(false);
  });

  it("atribuye venta directa y reventa a sus propios modelos y refleja el neto actual tras un reembolso", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [
          { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 80 },
          { sku: "MY2307-BLACK-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 0, neto: 100 },
        ],
        config: new Map([
          ["GT135", { categoria: "Corcho", costo: 0 }],
          ["MY2307", { categoria: "EVA", costo: 0 }],
        ]),
        ordenes: [
          {
            orderId: 1, fecha: "2026-08-03", total: 100, neto: 80, netoActual: 70,
            reembolsado: 10, reembolsoIncluidoNetoBase: 0, reembolsoBaseConfiable: true,
            estado: "paid", estadoPago: "refunded", revisiones: 2,
            comisionMp: 20, envio: 0, isr: 0, iva: 0, otrosCargos: 0,
            cargosSinDesglosar: 0, cargosLeidos: true, tipoVenta: "directa",
            renglones: [{ sku: "GT135-TABACO-25", importe: 100, unidades: 1 }],
          },
          {
            orderId: 2, fecha: "2026-08-03", total: 100, neto: 100, netoActual: null,
            reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2,
            comisionMp: 0, envio: 0, isr: 0, iva: 0, otrosCargos: 0,
            cargosSinDesglosar: 0, cargosLeidos: true, tipoVenta: "reventa",
            renglones: [{ sku: "MY2307-BLACK-25", importe: 100, unidades: 1 }],
          },
        ],
      }),
    );

    expect(e.netoDepositado).toBe(170);
    expect(e.comision).toBe(20);
    expect(e.devoluciones).toMatchObject({ incluidoEnNeto: 10, monto: 0 });
    expect(e.porModelo.find((m) => m.modelo === "GT135")).toMatchObject({ neto: 70, comision: 20 });
    expect(e.porModelo.find((m) => m.modelo === "MY2307")).toMatchObject({ neto: 100, comision: 0 });
    expect(e.porModelo.reduce((a, m) => a + m.neto, 0)).toBe(e.netoDepositado);
    expect(e.porModelo.reduce((a, m) => a + m.comision, 0)).toBe(e.comision);
    expect(e.reventa).toEqual({ ordenes: 1, importe: 100, totalComprador: 100, reconstruidas: 0 });
    expect(e.revision.exacto).toBe(true);
  });

  it("explica el neto con cargos separados y los reparte por modelo y categoría sin descontarlos dos veces", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [
          { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 3, ordenes: 1, importe: 300, comision: 45, neto: 180 },
          { sku: "MY2307-BLACK-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 15, neto: 60 },
        ],
        ordenes: [{
          orderId: 1,
          fecha: "2026-08-03",
          total: 400,
          neto: 240,
          netoActual: null,
          reembolsado: 0,
          estado: "paid",
          estadoPago: "approved",
          revisiones: 2,
          comisionMp: 60,
          envio: 40,
          isr: 10,
          iva: 20,
          otrosCargos: 10,
          cargosSinDesglosar: 20,
          tipoVenta: "directa",
          cargosLeidos: true,
          renglones: [
            { sku: "GT135-TABACO-25", importe: 300, unidades: 3 },
            { sku: "MY2307-BLACK-25", importe: 100, unidades: 1 },
          ],
        }],
      }),
    );

    expect(e).toMatchObject({
      ventaBruta: 400,
      comision: 60,
      envio: 40,
      isr: 10,
      iva: 20,
      otrosCargos: 10,
      cargosSinDesglosar: 20,
      enviosYOtros: 100,
      netoDepositado: 240,
    });
    // Los cargos anteriores ya están incluidos en el depósito de $240.
    expect(e.utilidadBruta).toBe(58.5);
    expect(e.utilidadNeta).toBe(58.5);

    const modelos = e.porModelo;
    expect(modelos.reduce((a, m) => a + m.neto, 0)).toBe(240);
    expect(modelos.reduce((a, m) => a + m.comision, 0)).toBe(60);
    expect(modelos.reduce((a, m) => a + m.envio, 0)).toBe(40);
    expect(modelos.reduce((a, m) => a + m.isr, 0)).toBe(10);
    expect(modelos.reduce((a, m) => a + m.iva, 0)).toBe(20);
    expect(modelos.reduce((a, m) => a + m.otrosCargos, 0)).toBe(30);

    expect(e.porCategoria.reduce((a, k) => a + k.neto, 0)).toBe(240);
    expect(e.porCategoria.reduce((a, k) => a + k.comision, 0)).toBe(60);
    expect(e.porCategoria.reduce((a, k) => a + k.envio, 0)).toBe(40);
    expect(e.porCategoria.reduce((a, k) => a + k.isr, 0)).toBe(10);
    expect(e.porCategoria.reduce((a, k) => a + k.iva, 0)).toBe(20);
    expect(e.porCategoria.reduce((a, k) => a + k.otrosCargos, 0)).toBe(30);
    expect(e.reventa.ordenes).toBe(0);
  });

  it("toma el neto de las órdenes cuando el día está completo, al centavo", () => {
    const e = armarEstadoResultados(
      base({
        // Dos SKUs de una misma orden de $400.10 con neto $250.33 repartido
        // por importe: 199.99 → 125.16, 200.11 → 125.17 (redondeos).
        ventas: [
          { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 199.99, comision: 29.0, neto: 125.16 },
          { sku: "GT135-TABACO-26", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 200.11, comision: 29.02, neto: 125.17 },
        ],
        ordenes: [
          {
            orderId: 1, fecha: "2026-08-03", total: 400.1, neto: 250.33,
            netoActual: null, reembolsado: 0, estado: "paid", estadoPago: "approved",
            revisiones: 2, comisionMp: 58.02, cargosSinDesglosar: 91.75,
            cargosLeidos: true,
            renglones: [
              { sku: "GT135-TABACO-25", importe: 199.99, unidades: 1 },
              { sku: "GT135-TABACO-26", importe: 200.11, unidades: 1 },
            ],
          },
        ],
      }),
    );
    expect(e.ventaBruta).toBe(400.1);
    expect(e.comision).toBe(58.02);
    expect(e.netoDepositado).toBe(250.33);
    expect(e.enviosYOtros).toBe(400.1 - 58.02 - 250.33 === 91.75 ? 91.75 : Math.round((400.1 - 58.02 - 250.33) * 100) / 100);
    expect(e.netoEstimado).toBe(0);
    expect(e.coberturaNetoReal).toBe(1);
    expect(e.unidades).toBe(2);
    // costo 60.50 × 2 = 121.00; utilidad bruta = 250.33 − 121.00
    expect(e.costoProducto).toBe(121);
    expect(e.utilidadBruta).toBe(129.33);
    expect(e.utilidadNeta).toBe(129.33);
    expect(e.coberturaCosto).toBe(1);
    expect(e.revision.exacto).toBe(true);
    expect(e.porDia[0]).toMatchObject({ fecha: "2026-08-03", neto: 250.33, real: true });
  });

  it("donde no hay depósito real no estima nada: la venta queda fuera y se declara", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [
          { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 200, comision: 30, neto: 120 },
          { sku: "GT135-TABACO-26", fecha: "2026-08-04", unidades: 1, ordenes: 1, importe: 100, comision: 15, neto: 0 },
        ],
        ordenes: [
          { orderId: 1, fecha: "2026-08-03", total: 200, neto: 120, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2 },
        ],
      }),
    );
    expect(e.netoDepositado).toBe(120); // solo lo real; los 100 sin depósito quedan fuera
    expect(e.netoEstimado).toBe(0);
    expect(e.ventaSinDeposito).toBe(100);
    expect(e.coberturaNetoReal).toBeCloseTo(200 / 300, 6);
    expect(e.porDia[1].real).toBe(false);
    expect(e.revision.exacto).toBe(false);
    expect(e.avisos.some((a) => a.includes("no tiene el depósito real"))).toBe(true);
  });

  it("deja fuera las órdenes canceladas y resta las devoluciones una sola vez", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [
          { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 200, comision: 30, neto: 120 },
          { sku: "GT135-TABACO-26", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 200, comision: 30, neto: 120 },
        ],
        ordenes: [
          // devuelta: MP no bajó el neto → se resta todo el reembolso
          { orderId: 1, fecha: "2026-08-03", total: 200, neto: 120, netoActual: 120, reembolsado: 200, reembolsoIncluidoNetoBase: 0, reembolsoBaseConfiable: true, estado: "paid", estadoPago: "refunded", revisiones: 2 },
          // devuelta: MP ya dejó el neto en 0 → solo se resta lo que falte (80)
          { orderId: 2, fecha: "2026-08-03", total: 200, neto: 120, netoActual: 0, reembolsado: 200, reembolsoIncluidoNetoBase: 0, reembolsoBaseConfiable: true, estado: "paid", estadoPago: "refunded", revisiones: 2 },
          // cancelada: ni venta ni neto (su renglón de venta ya lo quitó el barrido)
          { orderId: 3, fecha: "2026-08-05", total: 500, neto: 300, netoActual: null, reembolsado: 500, estado: "cancelled", estadoPago: "refunded", revisiones: 1 },
        ],
      }),
    );
    expect(e.cancelaciones).toEqual({ ordenes: 1, importe: 500 });
    expect(e.ventaBruta).toBe(400);
    // La diferencia contra los renglones originales está explicada por el
    // reembolso ya reflejado en el saldo actual, así que no es un descuadre.
    expect(e.avisos.some((a) => a.includes("no cuadran"))).toBe(false);
    expect(e.devoluciones.ordenes).toBe(2);
    expect(e.devoluciones.monto).toBe(280);
    // Sin renglones NO se estima costo recuperado: se declara y queda en cero.
    expect(e.devoluciones.costoEstimado).toBe(0);
    expect(e.devoluciones.costoRecuperado).toBe(0);
    expect(e.avisos.some((a) => a.includes("costo recuperado NO se suma"))).toBe(true);
    expect(e.revision.exacto).toBe(false);
    expect(e.revision.pendientes).toBe(1);
  });

  it("mantiene el costo recuperado antes y después de que el reembolso llegue al saldo", () => {
    const entrada = (netoActual: number) => base({
      ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 200, comision: 80, neto: 120 }],
      config: new Map([["GT135", { categoria: "Corcho", costo: 60 }]]),
      ordenes: [{
        orderId: 1, fecha: "2026-08-03", total: 200, neto: 120, netoActual,
        reembolsado: 200, reembolsoIncluidoNetoBase: 0, reembolsoBaseConfiable: true,
        estado: "paid", estadoPago: "refunded", revisiones: 2,
      }],
    });
    const antes = armarEstadoResultados(entrada(120));
    const despues = armarEstadoResultados(entrada(0));

    // Sin renglones no hay cantidades devueltas verificables: el costo NO se
    // recupera por estimación (nada se estima) y el corte lo declara.
    expect(antes.devoluciones).toMatchObject({ ordenes: 1, monto: 200, incluidoEnNeto: 0, costoRecuperado: 0, costoEstimado: 0 });
    expect(despues.devoluciones).toMatchObject({ ordenes: 1, monto: 80, incluidoEnNeto: 120, costoRecuperado: 0, costoEstimado: 0 });
    expect(antes.utilidadNeta).toBe(-140);
    expect(despues.utilidadNeta).toBe(-140);
    expect(antes.avisos.some((a) => a.includes("costo recuperado NO se suma"))).toBe(true);
  });

  it("conserva una devolución parcial aprobada aunque ya esté incluida en el saldo", () => {
    const e = armarEstadoResultados(base({
      ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 200, comision: 80, neto: 120 }],
      config: new Map([["GT135", { categoria: "Corcho", costo: 60 }]]),
      ordenes: [{
        orderId: 1, fecha: "2026-08-03", total: 200, neto: 120, netoActual: 70,
        reembolsado: 50, reembolsoIncluidoNetoBase: 0, reembolsoBaseConfiable: true,
        estado: "paid", estadoPago: "approved", revisiones: 2,
      }],
    }));

    // Devolución parcial sin pares verificables: nada que recuperar, nada que estimar.
    expect(e.devoluciones).toMatchObject({ ordenes: 1, monto: 0, incluidoEnNeto: 50, costoRecuperado: 0 });
    expect(e.utilidadNeta).toBe(10);
  });

  it("descuenta publicidad, gastos de Full y otros; ignora cargos que ya van en el neto", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [
          { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 2, ordenes: 2, importe: 400, comision: 60, neto: 240 },
          { sku: "MY2307-BLACK-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 150, comision: 20, neto: 90 },
        ],
        ordenes: [
          { orderId: 1, fecha: "2026-08-03", total: 550, neto: 330, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2 },
        ],
        adsPorModelo: new Map([
          ["GT135", 10.5],
          ["GT999", 5], // anunciado sin vender: gasto igual
        ]),
        adsSinAmarre: 1.25,
        gastos: [
          { id: 1, fecha: "2026-08-10", concepto: "Almacenamiento Full", categoria: "full", monto: 100 },
          { id: 2, fecha: "2026-08-11", concepto: "Diseñador", categoria: "otro", monto: 50.5 },
          { id: 3, fecha: "2026-07-31", concepto: "Fuera del mes", categoria: "full", monto: 999 },
        ],
        cargos: [
          { detalleId: "a", periodo: "2026-08", fecha: "2026-08-15", tipo: "Almacenamiento prolongado", subtipo: null, descripcion: null, monto: 30, clase: "full" },
          { detalleId: "b", periodo: "2026-08", fecha: "2026-08-15", tipo: "Comisión por venta", subtipo: null, descripcion: null, monto: 5000, clase: "venta" },
          { detalleId: "c", periodo: "2026-08", fecha: "2026-08-15", tipo: "Servicio X", subtipo: null, descripcion: null, monto: 7, clase: "otro" },
          { detalleId: "d", periodo: "2026-08", fecha: "2026-08-15", tipo: "Pago", subtipo: null, descripcion: null, monto: -4000, clase: "pago" },
        ],
      }),
    );
    expect(e.netoDepositado).toBe(330);
    expect(e.costoProducto).toBe(121); // solo GT135 (2 × 60.50); MY2307 sin costo
    expect(e.coberturaCosto).toBeCloseTo(2 / 3, 6);
    expect(e.utilidadBruta).toBe(209);
    expect(e.publicidad).toMatchObject({ ads: 16.75, manual: 0, total: 16.75, sinAmarre: 1.25 });
    expect(e.full).toEqual({ cargosMeli: 30, manual: 100, total: 130 });
    expect(e.otros).toEqual({ cargosMeli: 7, manual: 50.5, total: 57.5 });
    expect(e.utilidadNeta).toBe(209 - 16.75 - 130 - 57.5);
    expect(e.gastosManuales.map((g) => g.id)).toEqual([1, 2]);
    expect(e.cargosPorTipo.map((k) => k.tipo)).toContain("Comisión por venta");
    const gt135 = e.porModelo.find((m) => m.modelo === "GT135")!;
    expect(gt135).toMatchObject({ unidades: 2, neto: 240, costo: 121, publicidad: 10.5, ganancia: 108.5, categoria: "Corcho" });
    const my = e.porModelo.find((m) => m.modelo === "MY2307")!;
    expect(my.costo).toBeNull();
    expect(my.ganancia).toBeNull();
    const gt999 = e.porModelo.find((m) => m.modelo === "GT999")!;
    expect(gt999).toMatchObject({ unidades: 0, publicidad: 5, ganancia: null });
    expect(e.porCategoria.map((k) => k.categoria)).toEqual(["Corcho", "EVA", "Sin categoría"]);
    expect(e.gananciaPorPar).toBe(Math.round(((209 - 16.75 - 130 - 57.5) / 3) * 100) / 100);
    expect(e.revision.exacto).toBe(false); // MY2307 sin costo
  });

  it("no pierde centavos al sumar muchos renglones", () => {
    const ventas = Array.from({ length: 1000 }, (_, i) => ({
      sku: "GT135-TABACO-25",
      fecha: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
      unidades: 1,
      ordenes: 1,
      importe: 0.1,
      comision: 0.01,
      neto: 0.07,
    }));
    const e = armarEstadoResultados(base({ ventas }));
    expect(e.ventaBruta).toBe(100);
    expect(e.comision).toBe(10);
    expect(e.netoDepositado).toBe(70);
    expect(e.enviosYOtros).toBe(20);
  });
});

describe("desglosePorSkuDesdeRpc", () => {
  it("pagina el RPC y no corta el desglose en 1,000 SKUs", async () => {
    const filas = Array.from({ length: 1001 }, (_, i) => ({
      sku: `SKU-${String(i).padStart(4, "0")}`,
      neto: 1,
      comision_mp: 0,
      envio_mp: 0,
      isr_mp: 0,
      iva_mp: 0,
      otros_mp: 0,
      cargos_sin_desglosar: 0,
      ajuste_liquidacion: 0,
    }));
    const db = {
      rpc: () => ({
        range: async (desde: number, hasta: number) => ({ data: filas.slice(desde, hasta + 1), error: null }),
      }),
    };

    const resultado = await desglosePorSkuDesdeRpc(db as any, "cortes_desglose_por_sku", "cuenta", "2026-08-01", "2026-08-31");
    expect(resultado).toHaveLength(1001);
    expect(resultado.at(-1)?.sku).toBe("SKU-1000");
  });
});

describe("nada se estima", () => {
  it("una venta sin depósito leído aporta cero al neto, se declara, y los avisos propios van primero", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [
          { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 200, comision: 30, neto: 0 },
        ],
        avisosExtra: ["aviso propio"],
      }),
    );
    expect(e.netoDepositado).toBe(0);
    expect(e.netoEstimado).toBe(0);
    expect(e.ventaSinDeposito).toBe(200);
    expect(e.porModelo[0].neto).toBe(0);
    expect(e.avisos[0]).toBe("aviso propio");
    expect(e.avisos.some((a) => a.includes("nada se estima"))).toBe(true);
    expect(e.revision.exacto).toBe(false);
  });
});

describe("ventas en reventa", () => {
  it("las órdenes depositadas completas son reventa: importe ya neto, sin descuento adicional", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [
          { sku: "GT135-TABACO-25", fecha: "2026-09-03", unidades: 1, ordenes: 1, importe: 200, comision: 0, neto: 200 },
          { sku: "GT135-TABACO-26", fecha: "2026-09-03", unidades: 1, ordenes: 1, importe: 200, comision: 30, neto: 106 },
        ],
        desde: "2026-09-01",
        hasta: "2026-09-07",
        periodo: "2026-09",
        ordenes: [
          { orderId: 1, fecha: "2026-09-03", total: 200, neto: 200, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2 },
          { orderId: 2, fecha: "2026-09-03", total: 200, neto: 106, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2 },
        ],
      }),
    );
    expect(e.netoDepositado).toBe(306);
    expect(e.reventa).toEqual({ ordenes: 1, importe: 200, totalComprador: 200, reconstruidas: 0 });
    // utilidad bruta = 306 − costo (2 × 60.50): la reventa no cuesta nada más
    expect(e.utilidadBruta).toBe(306 - 121);
    expect(e.avisos.some((a) => a.includes("REVENTA"))).toBe(true);
  });
});

describe("costo recuperado de devoluciones", () => {
  it("con órdenes sumadas por día (RPC) el costo de los pares devueltos es exacto y se suma de vuelta", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 4, ordenes: 4, importe: 800, comision: 120, neto: 480 }],
        ordenesPorDia: [
          { fecha: "2026-08-03", ordenes: 4, neto: 480, cancelOrdenes: 0, cancelImporte: 0, devOrdenes: 1, devMonto: 200, total: 4, revisadas: 4, pendientes: 0, devCosto: 60.5, devUnidades: 1, devSinCostoUnidades: 0, devSinRenglonesMonto: 0 },
        ],
      }),
    );
    expect(e.devoluciones).toEqual({ ordenes: 1, incluidoEnNeto: 0, monto: 200, unidades: 1, costoRecuperado: 60.5, costoEstimado: 0, unidadesSinCosto: 0 });
    // 480 − 200 + 60.50 − 4 × 60.50
    expect(e.utilidadBruta).toBe(480 - 200 + 60.5 - 242);
  });
});
