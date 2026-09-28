import { describe, expect, it } from "vitest";
import { armarCorreoResumen, armarResumen, conSemana, destinatariosResumen, diaAnterior, fechaLarga, filasDeConsolidado, semanaQueCierra, tramosPorMes } from "./resumen-diario";
import { cargosDelRango, rangoRecortado } from "./corte-meli";
import type { Consolidado } from "./consolidado";

function consolidado(canales: Record<string, unknown>[]): Consolidado {
  return { periodo: "2026-09", desde: "2026-09-27", hasta: "2026-09-27", canales } as unknown as Consolidado;
}

const calzado = {
  canal: "meli_calzado", nombre: "Calzado · Mercado Libre", unidades: 1_000, unidadesConCosto: 1_000, ventaBruta: 300_000, neto: 200_000,
  coberturaNeto: 0.9, utilidadBruta: 80_000, publicidad: 10_000, utilidadNeta: 40_000,
};

describe("rango de un día", () => {
  it("recorta el periodo por los dos lados", () => {
    expect(rangoRecortado("2026-09", { desde: "2026-09-27", hasta: "2026-09-27" })).toEqual({ desde: "2026-09-27", hasta: "2026-09-27" });
    expect(rangoRecortado("2026-08", { hasta: "2026-08-25" })).toEqual({ desde: "2026-08-01", hasta: "2026-08-25" });
  });
  it("la facturación sin fecha es del mes: entra con `hasta`, no en un tramo que arranca después del 1", () => {
    const cargos = [{ fecha: "2026-09-27T10:00:00Z" }, { fecha: "2026-09-20" }, { fecha: null }];
    expect(cargosDelRango(cargos, { desde: "2026-09-27", hasta: "2026-09-27" }, "2026-09-27", "2026-09-27")).toHaveLength(1);
    expect(cargosDelRango(cargos, { hasta: "2026-09-25" }, "2026-09-01", "2026-09-25")).toHaveLength(2);
    expect(cargosDelRango(cargos, {}, "2026-09-01", "2026-09-30")).toHaveLength(3);
  });
});

describe("filasDeConsolidado", () => {
  it("el día: ganancia = neto − costo − publicidad, sin los gastos del mes; declara lo que falta de depósito", () => {
    const [f] = filasDeConsolidado(consolidado([calzado]), true);
    expect(f.ganancia).toBe(70_000);
    expect(f.notas[0]).toContain("90 %");
  });
  it("el mes: la utilidad del canal después de sus gastos", () => {
    expect(filasDeConsolidado(consolidado([calzado]), false)[0].ganancia).toBe(40_000);
  });
});

describe("armarResumen y correo", () => {
  it("siempre las cuatro plataformas, en orden, con su total", () => {
    const tiktok = { canal: "tiktok", nombre: "TikTok Shop", unidades: 4, unidadesConCosto: 4, ventaBruta: 1_050, neto: 400, coberturaNeto: 1_050 > 0 ? 800 / 1_050 : null, utilidadBruta: 200, publicidad: 0, utilidadNeta: 200 };
    const r = armarResumen("2026-09-27", consolidado([calzado, tiktok]), null);
    expect(r.filas.map((f) => f.canal)).toEqual(["meli_calzado", "meli_fundas", "amazon", "tiktok"]);
    expect(r.filas[1].ganancia).toBeNull();
    expect(r.total).toEqual({ unidades: 1_004, facturacion: 301_050, ganancia: 70_200 });
    expect(r.filas[3].notas[0]).toContain("TikTok aún no dice cuánto paga");
    const correo = armarCorreoResumen(r);
    expect(correo.asunto).toContain("domingo 27 de septiembre");
    expect(correo.html).toContain("TikTok Shop");
    expect(correo.texto).toContain("Total: 1,004 u");
  });
  it("fechas", () => {
    expect(diaAnterior("2026-10-01")).toBe("2026-09-30");
    expect(fechaLarga("2026-09-28")).toBe("lunes 28 de septiembre");
  });
});

describe("semana de los lunes", () => {
  it("solo el domingo cierra semana, de lunes a domingo", () => {
    expect(semanaQueCierra("2026-09-27")).toEqual({ desde: "2026-09-21", hasta: "2026-09-27" });
    expect(semanaQueCierra("2026-09-28")).toBeNull();
  });
  it("una semana que cruza de mes se parte por periodo", () => {
    expect(tramosPorMes("2026-09-28", "2026-10-04")).toEqual([
      { periodo: "2026-09", desde: "2026-09-28", hasta: "2026-09-30" },
      { periodo: "2026-10", desde: "2026-10-01", hasta: "2026-10-04" },
    ]);
  });
  it("suma los tramos por plataforma y arma el correo con la semana", () => {
    const sep = consolidado([calzado]);
    const oct = consolidado([{ ...calzado, unidades: 500, ventaBruta: 100_000, utilidadBruta: 30_000, publicidad: 5_000, coberturaNeto: 1 }]);
    const r = conSemana(armarResumen("2026-10-04", sep, null), { desde: "2026-09-28", hasta: "2026-10-04" }, [sep, oct]);
    expect(r.semana!.filas[0]).toMatchObject({ canal: "meli_calzado", unidades: 1_500, facturacion: 400_000, ganancia: 95_000 });
    expect(r.semana!.filas).toHaveLength(4);
    const correo = armarCorreoResumen(r);
    expect(correo.asunto).toContain("semana");
    expect(correo.html).toContain("Semana pasada");
  });
});

describe("destinatarios", () => {
  it("los tres del dueño si no hay variable de entorno", () => {
    const antes = process.env.CORREO_RESUMEN_DIARIO;
    delete process.env.CORREO_RESUMEN_DIARIO;
    expect(destinatariosResumen()).toEqual(["abraham.darwish@yapanizcel.com.mx", "danidarwish1@gmail.com", "izickd@gmail.com"]);
    process.env.CORREO_RESUMEN_DIARIO = "a@x.mx, b@y.mx";
    expect(destinatariosResumen()).toEqual(["a@x.mx", "b@y.mx"]);
    if (antes == null) delete process.env.CORREO_RESUMEN_DIARIO;
    else process.env.CORREO_RESUMEN_DIARIO = antes;
  });
});
