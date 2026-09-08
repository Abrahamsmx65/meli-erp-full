import { describe, expect, it } from "vitest";
import { armarConsolidado, bloqueDesdeEstado, type BloqueCanal } from "./consolidado";
import { armarEstadoResultados } from "./corte-meli";

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
    const cns = armarConsolidado({ periodo: "2026-08", desde: "2026-08-01", hasta: "2026-08-31", bloques: [calzado, amazon] });

    const calz = cns.canales[0];
    expect(calz.gastosGenerales).toBe(260);
    expect(calz.cargoPorUnidad).toBe(26);
    // neto 1100 − costo 600 − ads por modelo 100 − generales 260
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
    expect(b.adsPorModelo).toBe(30);
    expect(b.adsGenerales).toBe(5);
    expect(b.gastos.map((g) => g.monto)).toEqual([100, 140, 5]);
    const cns = armarConsolidado({ periodo: "2026-08", desde: "2026-08-01", hasta: "2026-08-31", bloques: [b] });
    // El consolidado cuadra con el corte del canal.
    expect(cns.canales[0].utilidadNeta).toBe(e.utilidadNeta);
  });
});
