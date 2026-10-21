import { describe, expect, it } from "vitest";
import {
  PARAMETROS_CALCULADORA,
  calcularPrecios,
  desgloseIva,
  facturaDeContenedor,
  normalizarParametros,
} from "./calculadora-precios";

const canal = { unidades: 1000, neto: 150_000, gastosFull: 10_000, adsModelos: 18_000, adsGenerales: 2_000 };

describe("calcularPrecios", () => {
  const res = calcularPrecios({
    parametros: PARAMETROS_CALCULADORA,
    canal,
    ventas: [
      { modelo: "GT148", unidades: 600, neto: 90_000, ads: 12_000 },
      { modelo: "GT300", unidades: 4, neto: 600, ads: 0 },
    ],
    modelos: [
      { modelo: "GT148", categoria: "Botas", costo: 80, netoRelampago: 140, precioRelampago: 199 },
      { modelo: "GT300", categoria: null, costo: 90, netoRelampago: 130, precioRelampago: 189 },
      { modelo: "GT301", categoria: null, costo: 90, netoRelampago: null, precioRelampago: null },
    ],
    unidadesTodas: 300_000,
    mesesLeidos: 3,
  });

  it("reparte el gasto de Industher entre las unidades promedio del mes", () => {
    expect(res.unidadesMesUsadas).toBe(100_000);
    expect(res.gastoOperativoPar).toBe(4);
    expect(res.fullPar).toBe(10);
    expect(res.publicidadPromedioPar).toBe(20);
  });

  it("con ventas: lo recibido menos Full y publicidad es el precio de Komerline", () => {
    const r = res.renglones.find((x) => x.modelo === "GT148")!;
    expect(r.fuente).toBe("real");
    expect(r.recibidoPar).toBe(150);
    // 12,000 / 600 + 2,000 / 1,000
    expect(r.publicidadPar).toBe(22);
    expect(r.precioKomerline).toBe(118);
    // 118 − 4 − 3 % de 118
    expect(r.gananciaIndustherPar).toBe(3.54);
    expect(r.precioIndusther).toBe(110.46);
    expect(r.margenProveedor).toBe(30.46);
  });

  it("producto nuevo: se calcula con el relámpago de Números y el promedio del canal", () => {
    const r = res.renglones.find((x) => x.modelo === "GT300")!;
    expect(r.fuente).toBe("relampago");
    expect(r.precioKomerline).toBe(130 - 10 - 20);
  });

  it("sin ventas ni relámpago no inventa precio", () => {
    const r = res.renglones.find((x) => x.modelo === "GT301")!;
    expect(r.fuente).toBe("sin_dato");
    expect(r.precioKomerline).toBeNull();
    expect(r.precioIndusther).toBeNull();
  });

  it("unidades al mes a mano mandan sobre el promedio", () => {
    const r = calcularPrecios({
      parametros: { ...PARAMETROS_CALCULADORA, unidadesMes: 200_000, margenKomerline: 0.01 },
      canal,
      ventas: [{ modelo: "GT148", unidades: 600, neto: 90_000, ads: 12_000 }],
      modelos: [],
      unidadesTodas: 300_000,
      mesesLeidos: 3,
    });
    expect(r.gastoOperativoPar).toBe(2);
    expect(r.renglones[0].precioKomerline).toBe(116.82);
  });
});

describe("factura del contenedor", () => {
  it("junta por modelo y desglosa el IVA", () => {
    const f = facturaDeContenedor(
      [
        { modelo: "GT148", pares: 48 },
        { modelo: "GT148", pares: 12 },
        { modelo: "GT301", pares: 10 },
      ],
      (m) => (m === "GT148" ? 116 : null),
      (m) => ({ descripcion: m, codigoSat: m === "GT148" ? "53111500" : "" }),
    );
    expect(f.filas[0]).toMatchObject({ modelo: "GT148", pares: 60, precioSinIva: 100, importeSinIva: 6000, iva: 960, total: 6960 });
    expect(f.totales).toEqual({ pares: 70, base: 6000, iva: 960, total: 6960 });
    expect(f.sinPrecio).toEqual(["GT301"]);
    expect(f.sinCodigo).toEqual(["GT301"]);
  });

  it("desgloseIva", () => {
    expect(desgloseIva(116)).toEqual({ base: 100, iva: 16, total: 116 });
  });
});

describe("normalizarParametros", () => {
  it("lo inválido toma el de omisión", () => {
    expect(normalizarParametros({ meses: 9, gananciaIndusther: 3, unidadesMes: "" })).toEqual(PARAMETROS_CALCULADORA);
  });
});
