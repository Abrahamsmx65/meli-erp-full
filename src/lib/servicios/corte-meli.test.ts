import { describe, expect, it } from "vitest";
import {
  armarEstadoResultados,
  nombreDelPeriodo,
  periodoAnterior,
  periodoSiguiente,
  rangoDelPeriodo,
  validarPeriodo,
  type EntradaCorte,
} from "./corte-meli";

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
          { orderId: 1, fecha: "2026-08-03", total: 400.1, neto: 250.33, netoActual: null, reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2 },
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

  it("estima importe − comisión donde no hay depósito real y lo declara", () => {
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
    expect(e.netoDepositado).toBe(205); // 120 real + (100 − 15) estimado
    expect(e.netoEstimado).toBe(85);
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
          { orderId: 1, fecha: "2026-08-03", total: 200, neto: 120, netoActual: 120, reembolsado: 200, estado: "paid", estadoPago: "refunded", revisiones: 2 },
          // devuelta: MP ya dejó el neto en 0 → solo se resta lo que falte (80)
          { orderId: 2, fecha: "2026-08-03", total: 200, neto: 120, netoActual: 0, reembolsado: 200, estado: "paid", estadoPago: "refunded", revisiones: 2 },
          // cancelada: ni venta ni neto (su renglón de venta ya lo quitó el barrido)
          { orderId: 3, fecha: "2026-08-05", total: 500, neto: 300, netoActual: null, reembolsado: 500, estado: "cancelled", estadoPago: "refunded", revisiones: 1 },
        ],
      }),
    );
    expect(e.cancelaciones).toEqual({ ordenes: 1, importe: 500 });
    expect(e.ventaBruta).toBe(400);
    // El día 03 cuadra: órdenes 120 + 0 = 120 vs renglones 240 → descuadre de
    // más del 2%: se usa el reparto por SKU y se avisa.
    expect(e.avisos.some((a) => a.includes("no cuadran"))).toBe(true);
    expect(e.devoluciones.ordenes).toBe(2);
    expect(e.devoluciones.monto).toBe(280);
    // Sin renglones en las órdenes, el costo recuperado se estima:
    // 280 × (costo 121 ÷ venta 400) = 84.70
    expect(e.devoluciones.costoEstimado).toBe(84.7);
    expect(e.devoluciones.costoRecuperado).toBe(84.7);
    expect(e.avisos.some((a) => a.includes("costo recuperado se estimó"))).toBe(true);
    expect(e.revision.pendientes).toBe(1);
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

describe("estimación con porcentaje observado", () => {
  it("estima lo que no tiene depósito con el ratio y no con importe − comisión", () => {
    const e = armarEstadoResultados(
      base({
        ventas: [
          { sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 200, comision: 30, neto: 0 },
        ],
        ratioEstimacion: 0.54,
        avisosExtra: ["aviso propio"],
      }),
    );
    expect(e.netoDepositado).toBe(108);
    expect(e.netoEstimado).toBe(108);
    expect(e.porModelo[0].neto).toBe(108);
    expect(e.avisos[0]).toBe("aviso propio");
    expect(e.avisos.some((a) => a.includes("54.0% observado"))).toBe(true);
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
    expect(e.reventa).toEqual({ ordenes: 1, importe: 200 });
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
    expect(e.devoluciones).toEqual({ ordenes: 1, monto: 200, unidades: 1, costoRecuperado: 60.5, costoEstimado: 0, unidadesSinCosto: 0 });
    // 480 − 200 + 60.50 − 4 × 60.50
    expect(e.utilidadBruta).toBe(480 - 200 + 60.5 - 242);
  });
});
