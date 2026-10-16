import { describe, expect, it } from "vitest";
import { periodosDelEjercicio, sumarAnio } from "./consolidado-anio";
import type { Consolidado } from "./consolidado";

function mes(periodo: string, utilidad: number, venta: number, extra: Partial<Consolidado> = {}): Consolidado {
  return {
    versionContable: 10,
    periodo,
    desde: `${periodo}-01`,
    hasta: `${periodo}-28`,
    generadoEn: `${periodo}-28T00:00:00Z`,
    canales: [
      {
        canal: "meli_calzado",
        nombre: "Calzado en MELI",
        calculable: true,
        unidades: 10,
        ventaBruta: venta,
        ventaCubierta: venta,
        neto: venta * 0.7,
        costoProducto: venta * 0.3,
        publicidad: 5,
        gastosGenerales: 5,
        utilidadNeta: utilidad + 100,
      } as any,
    ],
    gastosEmpresariales: [],
    total: {
      unidades: 10,
      ventaBruta: venta,
      ventaCubierta: venta,
      neto: venta * 0.7,
      costoProducto: venta * 0.3,
      publicidad: 5,
      gastosGenerales: 5,
      utilidadAntesGastosEmpresariales: utilidad + 100,
      gastosEmpresariales: 100,
      utilidadNeta: utilidad,
    } as any,
    porCategoria: [{ categoria: "Botas", unidades: 10, importe: venta, ganancia: utilidad } as any],
    porModelo: [{ modelo: "GT114", categoria: "Botas", unidades: 10, importe: venta, ganancia: utilidad } as any],
    avisos: [],
    exacto: true,
    ...extra,
  } as Consolidado;
}

describe("periodosDelEjercicio", () => {
  it("va de mayo a abril del año siguiente", () => {
    const l = periodosDelEjercicio(2026);
    expect(l).toHaveLength(12);
    expect(l[0]).toBe("2026-05");
    expect(l[7]).toBe("2026-12");
    expect(l[8]).toBe("2027-01");
    expect(l[11]).toBe("2027-04");
  });
});

describe("sumarAnio", () => {
  it("suma los meses con datos, separa el en curso y no cuenta el futuro", () => {
    const a = sumarAnio(
      2026,
      [
        { periodo: "2026-05", cns: mes("2026-05", 1000.1, 5000) },
        { periodo: "2026-06", cns: mes("2026-06", 2000.2, 6000) },
        { periodo: "2026-07", cns: null },
        { periodo: "2026-08", cns: mes("2026-08", 500, 3000) },
      ],
      "2026-08",
    );
    expect(a.total.utilidadNeta).toBe(3500.3);
    expect(a.total.ventaBruta).toBe(14000);
    expect(a.total.gastosEmpresariales).toBe(300);
    expect(a.mesesConDatos).toBe(3);
    expect(a.mesesTranscurridos).toBe(4);
    // promedio solo de los cerrados con datos (mayo y junio)
    expect(a.promedioMensual).toBe(1500.15);
    expect(a.meses.find((m) => m.periodo === "2026-07")?.sinDatos).toBe(true);
    expect(a.meses.find((m) => m.periodo === "2026-08")?.enCurso).toBe(true);
    expect(a.meses).toHaveLength(12);
    expect(a.canales[0].utilidadNeta).toBe(3800.3);
    expect(a.categorias[0]).toMatchObject({ categoria: "Botas", unidades: 30, ganancia: 3500.3 });
    expect(a.total.margen).toBeCloseTo(3500.3 / 14000);
    expect(a.generadoEn).toBe("2026-05-28T00:00:00Z");
  });

  it("un canal que no se pudo calcular no suma y se nombra el mes", () => {
    const m = mes("2026-05", 100, 1000);
    (m.canales[0] as any).calculable = false;
    const a = sumarAnio(2026, [{ periodo: "2026-05", cns: m }], "2026-10");
    expect(a.canales[0].utilidadNeta).toBe(0);
    expect(a.canales[0].mesesSinCalcular).toEqual(["2026-05"]);
  });

  it("ganancia sin costo es parcial, nunca cero inventado", () => {
    const m = mes("2026-05", 100, 1000, {
      porModelo: [{ modelo: "GT999", categoria: "Tenis", unidades: 4, importe: 400, ganancia: null } as any],
    });
    const a = sumarAnio(2026, [{ periodo: "2026-05", cns: m }], "2026-10");
    expect(a.modelos[0]).toMatchObject({ modelo: "GT999", ganancia: null, parcial: true });
  });
});
