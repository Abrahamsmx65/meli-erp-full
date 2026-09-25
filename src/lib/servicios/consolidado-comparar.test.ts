import { describe, expect, it } from "vitest";
import { comparar, compararMeses, diasTranscurridos } from "./consolidado-comparar";
import type { Consolidado } from "./consolidado";

function consolidado(periodo: string, canales: { canal: string; unidades: number; utilidad: number; venta: number }[], utilidadNeta: number, hasta = `${periodo}-28`): Consolidado {
  const unidades = canales.reduce((a, k) => a + k.unidades, 0);
  const antes = canales.reduce((a, k) => a + k.utilidad, 0);
  return {
    periodo,
    hasta,
    canales: canales.map((k) => ({ canal: k.canal, nombre: k.canal, unidades: k.unidades, utilidadNeta: k.utilidad, ventaBruta: k.venta })),
    total: { unidades, utilidadAntesGastosEmpresariales: antes, utilidadNeta, ventaBruta: canales.reduce((a, k) => a + k.venta, 0) },
  } as unknown as Consolidado;
}

describe("comparar", () => {
  it("da el cambio sobre el valor absoluto del anterior, y null contra cero", () => {
    expect(comparar(120, 100)).toMatchObject({ diferencia: 20, cambio: 0.2 });
    expect(comparar(80, 100).cambio).toBeCloseTo(-0.2);
    // Una pérdida que se achica es mejora: de −100 a −50 es +50 %.
    expect(comparar(-50, -100).cambio).toBeCloseTo(0.5);
    expect(comparar(10, 0).cambio).toBeNull();
  });
});

describe("diasTranscurridos", () => {
  it("un mes cerrado cuenta completo; el en curso hasta ayer, mínimo 1", () => {
    expect(diasTranscurridos("2026-08", "2026-09-25")).toBe(31);
    expect(diasTranscurridos("2026-09", "2026-09-25")).toBe(24);
    expect(diasTranscurridos("2026-09", "2026-09-01")).toBe(1);
  });
});

describe("compararMeses", () => {
  const agosto = consolidado("2026-08", [
    { canal: "meli_calzado", unidades: 31_000, utilidad: 310_000, venta: 6_000_000 },
    { canal: "amazon", unidades: 6_200, utilidad: 62_000, venta: 3_000_000 },
  ], 350_000);

  it("mes cerrado contra mes cerrado: por canal y total, sin ritmo", () => {
    const julio = consolidado("2026-07", [
      { canal: "meli_calzado", unidades: 25_000, utilidad: 250_000, venta: 5_000_000 },
      { canal: "amazon", unidades: 6_200, utilidad: 70_000, venta: 3_000_000 },
    ], 300_000);
    const c = compararMeses(agosto, julio, "2026-09-25");
    expect(c.enCurso).toBe(false);
    expect(c.ritmo).toBeNull();
    const calzado = c.renglones.find((r) => r.canal === "meli_calzado")!;
    expect(calzado.unidades.cambio).toBeCloseTo(0.24);
    expect(c.renglones.find((r) => r.canal === "amazon")!.utilidad.cambio).toBeCloseTo(-8_000 / 70_000);
    const total = c.renglones.find((r) => r.canal === "total")!;
    expect(total.unidades).toMatchObject({ actual: 37_200, anterior: 31_200, diferencia: 6_000 });
    expect(c.utilidadNeta.cambio).toBeCloseTo(50_000 / 300_000);
  });

  it("mes en curso: además del total, el ritmo por día contra el mes completo anterior", () => {
    // 24 días de septiembre con 24,000 unidades = 1,000/día; agosto 37,200/31 = 1,200/día.
    const septiembre = consolidado("2026-09", [
      { canal: "meli_calzado", unidades: 20_000, utilidad: 200_000, venta: 4_000_000 },
      { canal: "amazon", unidades: 4_000, utilidad: 40_000, venta: 2_000_000 },
    ], 240_000);
    const c = compararMeses(septiembre, agosto, "2026-09-25");
    expect(c.enCurso).toBe(true);
    expect(c.diasActual).toBe(24);
    expect(c.ritmo!.unidades.actual).toBe(1_000);
    expect(c.ritmo!.unidades.anterior).toBe(1_200);
    expect(c.ritmo!.unidades.cambio).toBeCloseTo(-1 / 6);
  });

  it("mes en curso con los mismos días del anterior: compara contra esos, no contra el mes completo ni por ritmo", () => {
    const septiembre = consolidado("2026-09", [
      { canal: "meli_calzado", unidades: 20_000, utilidad: 200_000, venta: 4_000_000 },
      { canal: "amazon", unidades: 4_000, utilidad: 40_000, venta: 2_000_000 },
    ], 240_000);
    const agostoAl25 = consolidado("2026-08", [
      { canal: "meli_calzado", unidades: 25_000, utilidad: 250_000, venta: 5_000_000 },
      { canal: "amazon", unidades: 5_000, utilidad: 50_000, venta: 2_500_000 },
    ], 300_000, "2026-08-25");
    const c = compararMeses(septiembre, agosto, "2026-09-25", agostoAl25);
    expect(c.base).toBe("mismos-dias");
    expect(c.hastaAnterior).toBe(25);
    expect(c.ritmo).toBeNull();
    expect(c.renglones.find((r) => r.canal === "total")!.unidades).toMatchObject({ actual: 24_000, anterior: 30_000, cambio: -0.2 });
    expect(c.utilidadNeta.cambio).toBeCloseTo(-0.2);
  });

  it("un mes cerrado ignora los mismos días y compara contra el anterior completo", () => {
    const julio = consolidado("2026-07", [{ canal: "meli_calzado", unidades: 1, utilidad: 1, venta: 1 }], 1);
    const c = compararMeses(agosto, julio, "2026-09-25", consolidado("2026-07", [], 0, "2026-07-10"));
    expect(c.base).toBe("mes-completo");
    expect(c.hastaAnterior).toBe(31);
  });

  it("un canal que el mes pasado vendía y este no, sale cayendo a cero", () => {
    const soloCalzado = consolidado("2026-09", [{ canal: "meli_calzado", unidades: 1, utilidad: 1, venta: 1 }], 1);
    const c = compararMeses(soloCalzado, agosto, "2026-10-02");
    expect(c.renglones.find((r) => r.canal === "amazon")!.unidades).toMatchObject({ actual: 0, anterior: 6_200, cambio: -1 });
  });
});
