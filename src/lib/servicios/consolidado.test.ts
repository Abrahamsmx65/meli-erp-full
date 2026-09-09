import { describe, expect, it } from "vitest";
import { aplicarGastosEmpresariales, armarConsolidado, bloqueDesdeEstado, type BloqueCanal } from "./consolidado";
import { compatibilidadGastosEmpresariales } from "./consolidado-cargar";
import { armarEstadoResultados } from "./corte-meli";

function bloqueSimple(): BloqueCanal {
  return {
    canal: "amazon",
    unidades: 2,
    ordenes: 2,
    ventaBruta: 500,
    neto: 400,
    fuenteNeto: "Amazon",
    coberturaNeto: 1,
    descuentos: [],
    devoluciones: 0,
    costoRecuperado: 0,
    costoProducto: 100,
    unidadesConCosto: 2,
    adsPorModelo: 20,
    adsGenerales: 0,
    gastos: [],
    porModelo: [{ modelo: "A1", categoria: "Fundas", unidades: 2, importe: 500, neto: 400, costo: 100, ads: 20 }],
    avisos: [],
    exacto: true,
  };
}

describe("armarConsolidado", () => {
  it("reparte los gastos generales de cada plataforma entre sus unidades y suma por categoría a través de canales", () => {
    const calzado: BloqueCanal = {
      canal: "meli_calzado",
      unidades: 10,
      ordenes: 10,
      ventaBruta: 2000,
      neto: 1100,
      fuenteNeto: "Mercado Pago por orden",
      coberturaNeto: 1,
      descuentos: [{ concepto: "Comisión", monto: 200 }],
      devoluciones: 100,
      costoRecuperado: 60,
      costoProducto: 600,
      unidadesConCosto: 10,
      adsPorModelo: 100,
      adsGenerales: 20,
      gastos: [
        { concepto: "Full", monto: 200 },
        { concepto: "Devoluciones netas", monto: 40 },
        { concepto: "Ads generales", monto: 20 },
      ],
      porModelo: [
        { modelo: "GT114", categoria: "Corcho", unidades: 6, importe: 1200, neto: 660, costo: 360, ads: 100 },
        { modelo: "GT135", categoria: "Corcho", unidades: 4, importe: 800, neto: 440, costo: 240, ads: 0 },
      ],
      avisos: [],
      exacto: true,
    };
    const amazon: BloqueCanal = {
      canal: "amazon",
      unidades: 5,
      ordenes: 5,
      ventaBruta: 1500,
      neto: 900,
      fuenteNeto: "SKU Economics · fecha de venta",
      coberturaNeto: 1,
      descuentos: [{ concepto: "Tarifas Amazon", monto: 300 }],
      devoluciones: 0,
      costoRecuperado: 0,
      costoProducto: 300,
      unidadesConCosto: 5,
      adsPorModelo: 50,
      adsGenerales: 0,
      gastos: [{ concepto: "FBA", monto: 100 }],
      porModelo: [{ modelo: "GT114", categoria: "Corcho", unidades: 5, importe: 1500, neto: 900, costo: 300, ads: 50 }],
      avisos: ["sin liquidaciones"],
      exacto: false,
    };
    const cns = armarConsolidado({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      bloques: [calzado, amazon],
    });

    const calz = cns.canales[0];
    expect(calz.gastosGenerales).toBe(260);
    expect(calz.cargoPorUnidad).toBe(26);
    expect(calz.utilidadNeta).toBe(140);
    const gt114 = calz.porModelo.find((m) => m.modelo === "GT114")!;
    expect(gt114.cargoGeneral).toBe(156);
    expect(gt114.ganancia).toBe(660 - 360 - 100 - 156);

    const amz = cns.canales[1];
    expect(amz.cargoPorUnidad).toBe(20);
    expect(amz.utilidadNeta).toBe(900 - 300 - 50 - 100);

    expect(cns.total.utilidadNeta).toBe(140 + 450);
    expect(cns.total.unidades).toBe(15);
    expect(cns.total.coberturaNeto).toBe(1);
    expect(cns.total.descuentosPlataforma).toBe(500);
    expect(cns.total.gananciaPorUnidad).toBe(Math.round(((140 + 450) / 15) * 100) / 100);

    const corcho = cns.porCategoria.find((k) => k.categoria === "Corcho")!;
    expect(corcho.unidades).toBe(15);
    expect(corcho.ganancia).toBe(140 + 450);
    expect(corcho.porCanal.amazon?.unidades).toBe(5);

    const modeloGt114 = cns.porModelo.find((m) => m.modelo === "GT114")!;
    expect(modeloGt114.canales).toEqual(["meli_calzado", "amazon"]);
    expect(modeloGt114.unidades).toBe(11);
    expect(cns.exacto).toBe(false);
    expect(cns.avisos).toContain("Amazon: sin liquidaciones");
  });

  it("bloqueDesdeEstado toma del corte de MELI los gastos generales: Full, otros, devoluciones netas y ads sin amarre", () => {
    const e = armarEstadoResultados({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 2, ordenes: 2, importe: 400, comision: 60, neto: 240 }],
      ordenesPorDia: [{ fecha: "2026-08-03", ordenes: 2, neto: 240, cancelOrdenes: 0, cancelImporte: 0, devOrdenes: 1, devMonto: 200, total: 2, revisadas: 2, pendientes: 0, devCosto: 60, devUnidades: 1 }],
      modeloDeSku: new Map([["GT135-TABACO-25", "GT135"]]),
      config: new Map([["GT135", { categoria: "Corcho", costo: 60 }]]),
      adsPorModelo: new Map([["GT135", 30]]),
      adsSinAmarre: 5,
      errorAds: null,
      gastos: [{ id: 1, fecha: "2026-08-10", concepto: "Almacenamiento", categoria: "full", monto: 100 }],
      cargos: [],
      cargosLeidos: true,
    });
    const b = bloqueDesdeEstado("meli_calzado", e);
    expect(b.fuenteNeto).toBe("Mercado Pago por orden");
    expect(b.coberturaNeto).toBe(1);
    expect(b.descuentos.map((d) => d.monto)).toEqual([60, 100]);
    expect(b.descuentos.map((d) => d.concepto)).toEqual([
      "Comisión de venta de Mercado Libre",
      "Otros cargos incluidos en el neto",
    ]);
    expect(b.desglosePlataforma).toEqual({ comision: 60, envio: 0, isr: 0, iva: 0, otros: 100, ajusteLiquidacion: 0 });
    expect(b.adsPorModelo).toBe(30);
    expect(b.adsGenerales).toBe(5);
    expect(b.gastos.map((g) => g.monto)).toEqual([100, 140, 5]);
    const cns = armarConsolidado({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      bloques: [b],
    });
    expect(cns.canales[0].utilidadNeta).toBe(e.utilidadNeta);
    expect(cns.porModelo[0]).toMatchObject({ comision: 60, envio: 0, isr: 0, iva: 0, otros: 100 });
    expect(cns.porCategoria[0]).toMatchObject({ comision: 60, envio: 0, isr: 0, iva: 0, otros: 100 });
  });

  it("conserva en canal, total y modelo los puentes de liquidación y reembolso", () => {
    const e = armarEstadoResultados({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      ventas: [{ sku: "GT135-TABACO-25", fecha: "2026-08-03", unidades: 1, ordenes: 1, importe: 100, comision: 20, neto: 80 }],
      ordenes: [{
        orderId: 1, fecha: "2026-08-03", total: 100, neto: 80, netoActual: 70,
        reembolsado: 0, estado: "paid", estadoPago: "approved", revisiones: 2,
        comisionMp: 20, envio: 10, cargosSinDesglosar: -10, cargosLeidos: true,
        renglones: [{ sku: "GT135-TABACO-25", importe: 100, unidades: 1 }],
      }],
      modeloDeSku: new Map([["GT135-TABACO-25", "GT135"]]),
      config: new Map([["GT135", { categoria: "Corcho", costo: 0 }]]),
      adsPorModelo: new Map(),
      adsSinAmarre: 0,
      errorAds: null,
      gastos: [],
      cargos: [],
      cargosLeidos: true,
    });
    const b = bloqueDesdeEstado("meli_calzado", e);
    const cns = armarConsolidado({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      bloques: [b],
    });

    expect(b.desglosePlataforma).toMatchObject({ comision: 20, envio: 10, otros: -10, ajusteLiquidacion: 10 });
    expect(b.descuentos.reduce((a, d) => a + d.monto, 0)).toBe(30);
    expect(cns.canales[0].descuentosPlataforma).toBe(30);
    expect(cns.total).toMatchObject({ neto: 70, otros: -10, ajusteLiquidacion: 10, devolucionesIncluidasEnNeto: 0 });
    expect(cns.porModelo[0]).toMatchObject({ neto: 70, otros: -10, ajusteLiquidacion: 10 });
    expect(cns.canales[0].utilidadNeta).toBe(e.utilidadNeta);
  });

  it("descuenta gastos empresariales una sola vez sin alterar canales, categorías ni modelos", () => {
    const cns = armarConsolidado({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      bloques: [bloqueSimple()],
      gastosEmpresariales: [
        { id: 1, fecha: "2026-08-15", categoria: "Nómina", concepto: "Quincena", monto: 50 },
        { id: 2, fecha: "2026-08-20", categoria: "Bodega", concepto: "Renta", monto: 30 },
      ],
    });

    expect(cns.canales[0].utilidadNeta).toBe(280);
    expect(cns.porModelo[0].ganancia).toBe(280);
    expect(cns.porCategoria[0].ganancia).toBe(280);
    expect(cns.total.utilidadAntesGastosEmpresariales).toBe(280);
    expect(cns.total.gastosEmpresariales).toBe(80);
    expect(cns.total.utilidadNeta).toBe(200);
  });

  it("reemplaza la capa de gastos de una caché sin acumular importes anteriores", () => {
    const base = armarConsolidado({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      bloques: [bloqueSimple()],
      gastosEmpresariales: [{ id: 1, fecha: "2026-08-01", categoria: "Nómina", concepto: "Viejo", monto: 100 }],
    });
    const actualizado = aplicarGastosEmpresariales(base, [
      { id: 2, fecha: "2026-08-02", categoria: "Bodega", concepto: "Actual", monto: 40 },
    ]);

    expect(actualizado.total.utilidadAntesGastosEmpresariales).toBe(280);
    expect(actualizado.total.gastosEmpresariales).toBe(40);
    expect(actualizado.total.utilidadNeta).toBe(240);
    expect(actualizado.gastosEmpresariales.map((g) => g.id)).toEqual([2]);
  });

  it("abre cortes históricos que todavía no guardaban la capa empresarial", () => {
    const viejo = armarConsolidado({ periodo: "2026-07", desde: "2026-07-01", hasta: "2026-07-31", bloques: [] }) as any;
    delete viejo.gastosEmpresariales;
    delete viejo.total.utilidadAntesGastosEmpresariales;
    delete viejo.total.gastosEmpresariales;
    delete viejo.total.coberturaNeto;
    delete viejo.total.descuentosPlataforma;

    const compatible = compatibilidadGastosEmpresariales(viejo);
    expect(compatible.gastosEmpresariales).toEqual([]);
    expect(compatible.total.utilidadAntesGastosEmpresariales).toBe(compatible.total.utilidadNeta);
    expect(compatible.total.gastosEmpresariales).toBe(0);
    expect(compatible.total.coberturaNeto).toBeNull();
    expect(compatible.total.descuentosPlataforma).toBe(0);
  });
});
