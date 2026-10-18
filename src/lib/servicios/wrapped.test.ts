import { describe, expect, it } from "vitest";
import { armarWrapped, horaEnPalabras, ritmoEnPalabras, textoParaCompartir } from "./wrapped";
import type { Anio } from "./consolidado-anio";

function anio(): Anio {
  const mes = (periodo: string, utilidadNeta: number, extra: object = {}) => ({
    periodo,
    sinDatos: false,
    enCurso: false,
    exacto: true,
    unidades: 0,
    ventaBruta: 1000,
    neto: 0,
    costoProducto: 0,
    publicidad: 0,
    gastosGenerales: 0,
    utilidadPlataformas: 0,
    gastosEmpresariales: 0,
    utilidadNeta,
    margen: null,
    ...extra,
  });
  return {
    ejercicio: 2026,
    meses: [mes("2026-05", 100), mes("2026-06", 900), mes("2026-07", 5000, { enCurso: true })],
    total: {
      unidades: 300,
      ventaBruta: 60000,
      neto: 0,
      costoProducto: 0,
      publicidad: 0,
      gastosGenerales: 0,
      utilidadPlataformas: 0,
      gastosEmpresariales: 0,
      utilidadNeta: 6000,
      margen: 0.1,
    },
    canales: [
      { canal: "meli_calzado", nombre: "Calzado en MELI", unidades: 200, ventaBruta: 45000 } as any,
      { canal: "tiktok", nombre: "TikTok Shop", unidades: 100, ventaBruta: 15000 } as any,
    ],
    categorias: [
      { categoria: "Botas", unidades: 150, importe: 40000, ganancia: 1, parcial: false },
      { categoria: "Fundas", unidades: 50, importe: 5000, ganancia: 1, parcial: false },
      { categoria: "Tenis", unidades: 100, importe: 15000, ganancia: 1, parcial: false },
    ],
    modelos: [
      { modelo: "GT148", categoria: "Botas", unidades: 150, importe: 40000, ganancia: 3000, parcial: false },
      { modelo: "GT114", categoria: "Tenis", unidades: 100, importe: 15000, ganancia: 4000, parcial: false },
      { modelo: "499", categoria: "Fundas", unidades: 50, importe: 5000, ganancia: 500, parcial: false },
      { modelo: "GT001", categoria: "Botas", unidades: 0, importe: 0, ganancia: null, parcial: false },
    ],
    mesesConDatos: 3,
    mesesTranscurridos: 3,
    promedioMensual: 500,
    generadoEn: null,
  };
}

const series = [
  {
    canal: "meli_calzado" as const,
    dias: [
      { f: "2026-05-01", u: 10, o: 10, i: 2000 },
      { f: "2026-05-10", u: 40, o: 30, i: 9000 }, // domingo
      { f: "2026-04-30", u: 999, o: 1, i: 999999 }, // fuera del ejercicio
    ],
    horas: [
      { f: "2026-05-01", h: 21, u: 5, o: 5, i: 1500 },
      { f: "2026-05-01", h: 10, u: 5, o: 5, i: 500 },
      { f: "2026-05-10", h: -1, u: 40, o: 30, i: 9000 }, // sin hora
    ],
  },
  {
    canal: "tiktok" as const,
    dias: [{ f: "2026-05-10", u: 5, o: 5, i: 1000 }],
    horas: [{ f: "2026-05-10", h: 21, u: 5, o: 5, i: 1000 }],
  },
];

describe("armarWrapped", () => {
  const w = armarWrapped(anio(), series, "2026-05-01", "2026-07-15");

  it("el modelo estrella es el que más unidades vendió y el que más dejó, aparte", () => {
    expect(w.modeloEstrella?.modelo).toBe("GT148");
    expect(w.modeloQueMasDejo?.modelo).toBe("GT114");
    expect(w.modelos).toBe(3);
  });

  it("los pares en fila no cuentan las fundas", () => {
    expect(w.pares).toBe(250);
    expect(w.kmEnFila).toBeCloseTo(0.0825);
  });

  it("el mejor día junta los canales y no sale del rango", () => {
    expect(w.mejorDia).toMatchObject({ fecha: "2026-05-10", importe: 10000, unidades: 45, diaSemana: "domingo" });
    expect(w.diasConVenta).toBe(2);
  });

  it("la hora pico ignora lo que no trae hora", () => {
    expect(w.horaPico?.hora).toBe(21);
    expect(w.horaPico?.parte).toBeCloseTo(2500 / 3000);
  });

  it("el día favorito de la semana y el canal favorito", () => {
    expect(w.diaSemanaFavorito?.dia).toBe("domingo");
    expect(w.canalFavorito?.nombre).toBe("Calzado en MELI");
    expect(w.canalFavorito?.parte).toBeCloseTo(0.75);
  });

  it("el mejor mes es de los cerrados, no el que va en curso", () => {
    expect(w.mejorMes?.periodo).toBe("2026-06");
  });

  it("el ritmo cuenta desde la primera venta", () => {
    // 10 días, 300 unidades
    expect(w.segundosPorUnidad).toBeCloseTo((10 * 86400) / 300);
  });

  it("sin series no inventa días ni horas", () => {
    const v = armarWrapped(anio(), [], "2026-05-01", "2026-07-15");
    expect(v.mejorDia).toBeNull();
    expect(v.horaPico).toBeNull();
    expect(v.segundosPorUnidad).toBeNull();
    expect(v.modeloEstrella?.modelo).toBe("GT148");
  });

  it("el texto para compartir lleva lo importante", () => {
    const txt = textoParaCompartir(w, "may 2026 – abr 2027", (x) => `$${x}`);
    expect(txt).toContain("GT148");
    expect(txt).toContain("Utilidad neta: $6000");
  });
});

describe("palabras", () => {
  it("horas y ritmo", () => {
    expect(horaEnPalabras(21)).toBe("9 de la noche");
    expect(horaEnPalabras(12)).toBe("12 del día");
    expect(horaEnPalabras(9)).toBe("9 de la mañana");
    expect(horaEnPalabras(15)).toBe("3 de la tarde");
    expect(ritmoEnPalabras(23)).toBe("una cada 23 segundos");
    expect(ritmoEnPalabras(600)).toBe("una cada 10 minutos");
  });
});
