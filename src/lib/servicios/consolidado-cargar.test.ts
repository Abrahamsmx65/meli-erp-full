import { describe, expect, it } from "vitest";
import { armarConsolidado, type BloqueCanal } from "./consolidado";
import { canalesPerdidos, leerConsolidadoCache, normalizarConsolidadoCache, periodosDesde } from "./consolidado-cargar";
import { marcarTipos } from "./plan-fba-cache";

describe("esquema de consolidado_cache", () => {
  it("rechaza una caché viva sin desglose por canal y acepta la estructura actual", () => {
    const actual = armarConsolidado({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      bloques: [{
        canal: "amazon",
        unidades: 1,
        ordenes: 1,
        ventaBruta: 100,
        neto: 80,
        fuenteNeto: "SKU Economics",
        coberturaNeto: 1,
        descuentos: [{ concepto: "Tarifas", monto: 20 }],
        devoluciones: 0,
        costoRecuperado: 0,
        costoProducto: 30,
        unidadesConCosto: 1,
        adsPorModelo: 0,
        adsGenerales: 0,
        gastos: [],
        porModelo: [{ modelo: "A1", categoria: "Fundas", unidades: 1, importe: 100, neto: 80, costo: 30, ads: 0 }],
        avisos: [],
        exacto: true,
      }],
      avisos: [],
    });
    const anterior = structuredClone(actual) as Record<string, any>;
    delete anterior.canales[0].desglosePlataforma;

    expect(leerConsolidadoCache(anterior)).toBeNull();
    expect(leerConsolidadoCache(marcarTipos(actual))).toEqual(actual);
  });
});

describe("normalizarConsolidadoCache", () => {
  it("completa el esquema anterior sin arreglos ausentes ni valores NaN", () => {
    const consolidado = normalizarConsolidadoCache({
      periodo: "2026-08",
      canales: [{ canal: "amazon", neto: 1200, costoProducto: 300 }],
      total: { neto: 1200, costoProducto: 300 },
    });

    expect(consolidado.canales[0]).toMatchObject({
      descuentos: [],
      descuentosPlataforma: 0,
      costoProducto: 300,
      utilidadBruta: 900,
      coberturaNeto: null,
      desgloseDisponible: false,
      desglosePlataforma: { comision: 0, envio: 0, isr: 0, iva: 0, otros: 0, ajusteLiquidacion: 0 },
    });
    expect(consolidado.total).toMatchObject({
      descuentosPlataforma: 0,
      costoProducto: 300,
      coberturaNeto: null,
      desgloseDisponible: false,
    });
    expect(Object.values(consolidado.canales[0]).some((valor) => Number.isNaN(valor))).toBe(false);
    expect(Object.values(consolidado.total).some((valor) => Number.isNaN(valor))).toBe(false);
  });
});

describe("un recálculo no puede perder un canal", () => {
  const conCanales = (canales: BloqueCanal["canal"][]) =>
    armarConsolidado({
      periodo: "2026-07",
      desde: "2026-07-01",
      hasta: "2026-07-31",
      bloques: canales.map((canal) => ({
        canal,
        unidades: 1,
        ordenes: 1,
        ventaBruta: 100,
        neto: 80,
        fuenteNeto: "Finances API",
        coberturaNeto: 1,
        descuentos: [],
        devoluciones: 0,
        costoRecuperado: 0,
        costoProducto: 30,
        unidadesConCosto: 1,
        adsPorModelo: 0,
        adsGenerales: 0,
        gastos: [],
        porModelo: [],
        avisos: [],
        exacto: true,
      })),
      avisos: [],
    });

  it("delata el canal que el guardado traía y el nuevo no (así desapareció Amazon de julio)", () => {
    const guardado = conCanales(["meli_calzado", "meli_fundas", "amazon"]);
    const nuevo = conCanales(["meli_calzado", "meli_fundas"]);
    expect(canalesPerdidos(guardado, nuevo)).toEqual(["amazon"]);
  });

  it("un recálculo completo, o uno que AGREGA un canal, no pierde nada", () => {
    const tres = conCanales(["meli_calzado", "meli_fundas", "amazon"]);
    expect(canalesPerdidos(tres, tres)).toEqual([]);
    expect(canalesPerdidos(conCanales(["meli_calzado"]), tres)).toEqual([]);
  });

  it("sin renglón guardado no hay nada que conservar", () => {
    expect(canalesPerdidos(null, conCanales(["amazon"]))).toEqual([]);
  });
});

describe("periodosDesde", () => {
  it("todos los meses del inicio del año al corriente, en orden", () => {
    expect(periodosDesde("2026-01", "2026-04")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(periodosDesde("2026-01", "2026-01")).toEqual(["2026-01"]);
  });
});
