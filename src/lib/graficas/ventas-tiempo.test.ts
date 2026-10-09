import { describe, expect, it } from "vitest";
import { canalesSinHora, diasConHoras, etiquetaHora, puntosPorDia, puntosPorHora, type VentasTiempo } from "./ventas-tiempo";

const calzado: VentasTiempo = {
  canal: "meli_calzado",
  dias: [
    { f: "2026-10-07", u: 10, o: 9, i: 2000 },
    { f: "2026-10-08", u: 20, o: 18, i: 4000 },
  ],
  horas: [
    { f: "2026-10-07", h: 9, u: 4, o: 4, i: 800 },
    { f: "2026-10-08", h: 9, u: 6, o: 5, i: 1200 },
    { f: "2026-10-08", h: 21, u: 14, o: 13, i: 2800 },
  ],
};
const amazon: VentasTiempo = { canal: "amazon", dias: [{ f: "2026-10-08", u: 5, o: 5, i: 1000 }], horas: [] };

describe("puntos por día", () => {
  it("un punto por día del rango, con ceros y los canales apilados", () => {
    const p = puntosPorDia([calzado, amazon], "2026-10-06", "2026-10-08", "importe");
    expect(p.map((x) => x.clave)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(p[0].valores).toEqual({});
    expect(p[2].valores).toEqual({ meli_calzado: 4000, amazon: 1000 });
    expect(p[2].ordenes).toBe(23);
  });
  it("en unidades", () => {
    expect(puntosPorDia([calzado], "2026-10-08", "2026-10-08", "unidades")[0].valores.meli_calzado).toBe(20);
  });
});

describe("puntos por hora", () => {
  it("24 horas, cada una sumada en todo el rango", () => {
    const p = puntosPorHora([calzado, amazon], "unidades");
    expect(p).toHaveLength(24);
    expect(p[9].valores.meli_calzado).toBe(10);
    expect(p[21].valores.meli_calzado).toBe(14);
    expect(p[9].valores.amazon).toBeUndefined();
  });
  it("días con hora y canales que venden sin hora", () => {
    expect(diasConHoras([calzado, amazon])).toBe(2);
    expect(canalesSinHora([{ ...calzado, nombre: "Calzado", color: "" }, { ...amazon, nombre: "Amazon", color: "" }])).toEqual(["Amazon"]);
  });
  it("la hora como se lee en México", () => {
    expect(etiquetaHora(0)).toBe("12 a. m.");
    expect(etiquetaHora(9)).toBe("9 a. m.");
    expect(etiquetaHora(12)).toBe("12 p. m.");
    expect(etiquetaHora(21)).toBe("9 p. m.");
  });
});
