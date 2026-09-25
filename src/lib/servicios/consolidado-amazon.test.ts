import { describe, expect, it } from "vitest";
import { bloqueAmazon } from "./consolidado-amazon";
import type { MonitorAmazon } from "./amazon-monitor";

function monitor(extra?: Partial<MonitorAmazon>): MonitorAmazon {
  return {
    hoy: { unidades: 0, importe: 0, ordenes: 0 },
    ayer: { unidades: 0, importe: 0, ordenes: 0 },
    periodo: { unidades: 10, importe: 5000, ordenes: 9 },
    porModelo: [
      { modelo: "GT114", unidades: 6, unidadesPrev: 0, importe: 3000, unidadesHoy: 0, ganancia: null, netoReal: 1200, gananciaReal: null, gananciaNeta: null, gananciaFuente: null, publicidad: 200, publicidadPorUnidad: null, acosPct: null, economia: { unidades: 6, ventas: 3000, tarifas: 900, publicidad: 200, neto: 1900 } },
      { modelo: "GT135", unidades: 4, unidadesPrev: 0, importe: 2000, unidadesHoy: 0, ganancia: null, netoReal: 500, gananciaReal: null, gananciaNeta: null, gananciaFuente: null, publicidad: 0, publicidadPorUnidad: null, acosPct: null, economia: { unidades: 4, ventas: 2000, tarifas: 600, publicidad: 0, neto: 1400 } },
    ],
    porCategoria: [],
    ganancia: 0,
    coberturaCosto: 1,
    netoReal: 1700,
    gananciaReal: null,
    unidadesLiquidadas: 7,
    publicidad: -250,
    otrosCargos: -400,
    otrosCargosDetalle: [{ concepto: "Storage Fee", monto: -300 }, { concepto: "FBA Inventory Reimbursement", monto: 100 }, { concepto: "Subscription", monto: -200 }],
    reservas: -5000,
    gananciaFinal: null,
    pagosHasta: "2026-08-20",
    economia: { unidades: 10, ventas: 5000, tarifas: 1500, publicidad: 200, neto: 3300, gananciaFinal: null, costoProducto: 0, coberturaCosto: 1, hasta: "2026-08-31", cobertura: { importe: 1, unidades: 1, dias: 1, diasVenta: 31, diasCubiertos: 31, completa: true } },
    publicidadPorModelo: new Map([["GT114", 200]]),
    real: null,
    ...extra,
  };
}

describe("bloqueAmazon", () => {
  it("el neto es lo que Amazon va a pagar por lo vendido (ventas − tarifas del SKU Economics), no solo lo liquidado", () => {
    const b = bloqueAmazon(monitor(), new Map([["GT114", { categoria: "Corcho", costo: 60 }], ["GT135", { categoria: "Corcho", costo: 60 }]]), { desde: "2026-08-01", hasta: "2026-08-31" });
    expect(b.neto).toBe(3500);
    expect(b.porModelo.find((m) => m.modelo === "GT114")!.neto).toBe(2100);
    expect(b.porModelo.find((m) => m.modelo === "GT114")!.ads).toBe(200);
    expect(b.adsPorModelo).toBe(200);
    expect(b.adsGenerales).toBe(0);
    expect(b.descuentos).toEqual([
      { concepto: "Tarifas Amazon: comisión, FBA y otros", monto: 1500 },
    ]);
    expect(b.gastos).toEqual([
      { concepto: "Amazon · Storage Fee", monto: 300 },
      { concepto: "Amazon · FBA Inventory Reimbursement", monto: -100 },
      { concepto: "Amazon · Subscription", monto: 200 },
    ]);
    expect(b.avisos.some((a) => a.includes("reservas"))).toBe(true);
    expect(b.avisos.some((a) => a.includes("liquidados"))).toBe(true);
    expect(b.costoProducto).toBe(600);
    expect(b.exacto).toBe(true);
  });

  it("sin economía cae a lo liquidado y lo declara", () => {
    const b = bloqueAmazon(monitor({ economia: null, publicidadPorModelo: new Map() }), new Map(), { desde: "2026-08-01", hasta: "2026-08-31" });
    expect(b.neto).toBe(1700);
    expect(b.adsGenerales).toBe(250);
    expect(b.avisos.some((a) => a.includes("LIQUIDADO"))).toBe(true);
    expect(b.exacto).toBe(false);
  });

  it("si la economía no llega al fin del periodo, no es exacto y lo avisa", () => {
    const b = bloqueAmazon(monitor({ economia: { ...monitor().economia!, hasta: "2026-08-29", cobertura: { importe: .95, unidades: .95, dias: 29 / 31, diasVenta: 31, diasCubiertos: 29, completa: false } } }), new Map([["GT114", { categoria: null, costo: 1 }], ["GT135", { categoria: null, costo: 1 }]]), { desde: "2026-08-01", hasta: "2026-08-31" });
    expect(b.exacto).toBe(false);
    expect(b.avisos.some((a) => a.includes("2026-08-29"))).toBe(true);
  });

  it("no llama exacta a una economía que llega al último día pero cubre poca venta", () => {
    const b = bloqueAmazon(
      monitor({
        economia: {
          ...monitor().economia!,
          ventas: 800,
          neto: 400,
          publicidad: 80,
          hasta: "2026-08-31",
          cobertura: { importe: 0.16, unidades: 1, dias: 1, diasVenta: 31, diasCubiertos: 31, completa: false },
        },
      }),
      new Map([["GT114", { categoria: null, costo: 1 }], ["GT135", { categoria: null, costo: 1 }]]),
      { desde: "2026-08-01", hasta: "2026-08-31" },
    );

    expect(b.coberturaNeto).toBeCloseTo(0.16);
    expect(b.fuenteNeto).toContain("parcial");
    expect(b.exacto).toBe(false);
    expect(b.avisos.some((a) => a.includes("16%"))).toBe(true);
  });

  it("exige cobertura de importe, unidades y días aunque la fecha final exista", () => {
    const economia = {
      ...monitor().economia!,
      cobertura: { importe: 1, unidades: 0.9, dias: 30 / 31, diasVenta: 31, diasCubiertos: 30, completa: false },
    };
    const b = bloqueAmazon(
      monitor({ economia }),
      new Map([["GT114", { categoria: null, costo: 1 }], ["GT135", { categoria: null, costo: 1 }]]),
      { desde: "2026-08-01", hasta: "2026-08-31" },
    );
    expect(b.exacto).toBe(false);
    expect(b.fuenteNeto).toContain("parcial");
    expect(b.avisos.some((a) => a.includes("90% de las unidades") && a.includes("30 de 31 días"))).toBe(true);
  });
});

describe("bloqueAmazon con el dinero real (Finances API)", () => {
  it("con eventos reales en el rango, el bloque sale exacto de la cascada y la publicidad real con IVA cubre lo no amarrado", () => {
    const cascada = { eventos: 1, unidades: 1, bruto: 239, principal: 206.03, impuestoCobrado: 32.97, otrosCargos: 0, comision: -35.86, fba: -36, otrasTarifas: 0, retenido: -16.49, promociones: 0, neto: 150.65 };
    const real = {
      rango: { desde: "2026-08-01", hasta: "2026-08-31" },
      ventas: cascada,
      reembolsos: { ...cascada, eventos: 0, unidades: 0, bruto: 0, principal: 0, impuestoCobrado: 0, comision: 0, fba: 0, retenido: 0, neto: 0 },
      publicidad: { eventos: 1, monto: -348, base: -300, impuesto: -48 },
      otros: [{ lista: "ServiceFeeEventList", eventos: 1, monto: -30, base: null, impuesto: null, sinClasificar: 0 }],
      otrosTotal: -30,
      netoProductos: 150.65,
      netoDepositado: -227.35,
      porModelo: [{ ...cascada, modelo: "GT114", categoria: "Corcho", reembolsos: 0, unidadesReembolsadas: 0, costo: 60, ganancia: 90.65 }],
      costoProducto: 60,
      unidadesConCosto: 1,
      coberturaCosto: 1,
      ganancia: -287.35,
      cobertura: { grupos: [], cerrados: 1, abiertos: 0, incompletos: 0, descuadrados: 0, completa: true, hasta: "2026-08-26T14:16:37Z" },
      avisos: [],
      exacto: true,
      generadoEn: "2026-09-09T18:00:00Z",
    };
    const b = bloqueAmazon(monitor({ real }), new Map([["GT114", { categoria: "Corcho", costo: 60 }]]), { desde: "2026-08-01", hasta: "2026-08-31" });
    expect(b).toMatchObject({ ventaBruta: 239, neto: 150.65, unidades: 1, devoluciones: 0, costoProducto: 60, adsPorModelo: 200, adsGenerales: 148, exacto: true });
    expect(b.fuenteNeto).toMatch(/Finances API/);
    expect(b.descuentos.map((d) => [d.concepto, d.monto])).toEqual([["Comisión de Amazon (referral)", 35.86], ["Tarifa de FBA", 36], ["IVA retenido por Amazon", 16.49]]);
    expect(b.gastos).toEqual([
      { concepto: "Amazon · cargos de servicio (almacenaje, suscripción…)", monto: 30 },
      { concepto: "Publicidad de Amazon no amarrada a modelo (incluye IVA)", monto: 148 },
    ]);
    expect(b.porModelo[0]).toMatchObject({ modelo: "GT114", importe: 239, comision: 35.86, envio: 36, iva: 16.49, neto: 150.65, costo: 60, ads: 200 });
    expect(b.avisos.join(" ")).toMatch(/IVA/);
  });

  it("la liquidación en curso cuenta como dinero por cobrar y un descuadre no tumba la cobertura (dueño, 24-sep-2026)", () => {
    const cascada = { eventos: 1, unidades: 1, bruto: 239, principal: 206.03, impuestoCobrado: 32.97, otrosCargos: 0, comision: -35.86, fba: -36, otrasTarifas: 0, retenido: -16.49, promociones: 0, neto: 150.65 };
    const grupo = (estado: string, cuadra: boolean | null, total: number, suma: number) => ({ grupoId: estado, inicio: "2026-09-17T14:13:15Z", fin: estado === "Closed" ? "2026-09-20T00:00:00Z" : null, estado, totalOriginal: total, sumaEventos: suma, eventos: 1, sinClasificar: 0, completo: true, cuadra });
    const real = {
      rango: { desde: "2026-09-01", hasta: "2026-09-30" },
      ventas: cascada,
      reembolsos: { ...cascada, eventos: 0, unidades: 0, bruto: 0, principal: 0, impuestoCobrado: 0, comision: 0, fba: 0, retenido: 0, neto: 0 },
      publicidad: { eventos: 0, monto: 0, base: 0, impuesto: 0 },
      otros: [],
      otrosTotal: 0,
      netoProductos: 150.65,
      netoDepositado: 150.65,
      porModelo: [{ ...cascada, modelo: "GT114", categoria: "Corcho", reembolsos: 0, unidadesReembolsadas: 0, costo: 60, ganancia: 90.65 }],
      costoProducto: 60,
      unidadesConCosto: 1,
      coberturaCosto: 1,
      ganancia: 90.65,
      cobertura: { grupos: [grupo("Closed", false, 100, 90), grupo("Open", null, 348360.88, 348360.88)], cerrados: 1, abiertos: 1, incompletos: 0, descuadrados: 1, completa: false, hasta: null },
      avisos: [],
      exacto: false,
      generadoEn: "2026-09-24T18:00:00Z",
    };
    const b = bloqueAmazon(monitor({ real }), new Map([["GT114", { categoria: "Corcho", costo: 60 }]]), { desde: "2026-09-01", hasta: "2026-09-30" });
    expect(b.coberturaNeto).toBe(1);
    expect(b.neto).toBe(150.65);
    expect(b.exacto).toBe(false);
    expect(b.fuenteNeto).toMatch(/por depositar/);
    expect(b.fuenteNeto).toMatch(/descuadre/);
    expect(b.avisos.join(" ")).toMatch(/348,360\.88/);
  });
});
