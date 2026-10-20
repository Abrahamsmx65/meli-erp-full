import { describe, expect, it } from "vitest";
import { importarProforma } from "../importar/proforma";
import { excelDePedido, filasDeTabla, tallasDeColumnas, type RenglonPI } from "./excel";
import { FABRICAS, perfilDeProveedor } from "./fabricas";

const unitallas = (modelo: string, color: string, porCaja: number, cajas: Record<string, number>, precio: number): RenglonPI[] =>
  Object.entries(cajas).map(([t, n]) => ({
    modelo,
    descripcion: "BOTA CABALLERO",
    color,
    unitalla: t,
    corrida: {},
    paresPorCaja: porCaja,
    cajas: n,
    precio,
    medidas: { largoCm: 66, anchoCm: 56, altoCm: 24 },
    cbmCaja: null,
  }));

const corrida: RenglonPI = {
  modelo: "GT161",
  descripcion: "MENS & LADIES SLIPPER",
  color: "CAMEL",
  unitalla: null,
  corrida: { "23": 7, "24": 11, "25": 14, "26": 8, "27": 4, "28": 4 },
  paresPorCaja: 48,
  cajas: 20,
  precio: 9.6,
  preciosTalla: { "23": 9.6, "24": 9.6, "25": 9.6, "26": 9.6, "27": 10.1, "28": 10.1 },
  medidas: null,
  cbmCaja: 0.1043,
};

/**
 * El Excel que se le manda a la fábrica es el mismo que regresa firmado y se
 * sube en Cargar pedidos: el lector tiene que leer EXACTAMENTE lo que se
 * pidió, en cada formato.
 */
describe("excelDePedido: el pedido en el formato de cada fábrica se vuelve a leer igual", () => {
  const ejemplo = unitallas("GT179", "BROWN", 12, { "26": 22, "27": 26, "28": 16, "29": 15, "30": 10 }, 7.5);

  for (const perfil of [...FABRICAS, perfilDeProveedor("ZHEJIANG MYWAY INDUSTRIAL CO. ,LTD.")!]) {
    it(`${perfil.clave}: cajas de una sola talla y corrida con precio por talla`, async () => {
      const moneda = perfil.moneda ?? "USD";
      const renglones = [...ejemplo, corrida];
      const buf = await excelDePedido({ pedido: "IN10184", fecha: "2026-10-11", perfil, moneda, renglones });
      const p = await importarProforma(buf, { nombre: "IN10184 (GT179).xlsx" });

      expect(p.pedido).toBe("IN10184");
      expect(p.moneda).toBe(moneda);
      expect(p.proveedor ?? "").toContain(perfil.nombre.trim().slice(0, 10));

      const uni = p.lineas.filter((l) => l.unitalla).map((l) => [l.modelo, l.color, l.unitalla, l.cajas, l.paresPorCaja, l.pares, l.precioUnitario]);
      expect(uni).toEqual([
        ["GT179", "BROWN", "26", 22, 12, 264, 7.5],
        ["GT179", "BROWN", "27", 26, 12, 312, 7.5],
        ["GT179", "BROWN", "28", 16, 12, 192, 7.5],
        ["GT179", "BROWN", "29", 15, 12, 180, 7.5],
        ["GT179", "BROWN", "30", 10, 12, 120, 7.5],
      ]);
      const c = p.lineas.find((l) => !l.unitalla)!;
      expect(c).toMatchObject({ modelo: "GT161", color: "CAMEL", cajas: 20, paresPorCaja: 48, pares: 960, cuadra: true });
      expect(c.tallas).toEqual(corrida.corrida);
      expect(c.preciosTalla?.["27"]).toBe(10.1);
      expect(p.totales.cajas).toBe(109);
      expect(p.totales.importe).toBeCloseTo(1068 * 7.5 + 800 * 9.6 + 160 * 10.1, 2);
    });
  }

  it("un pedido de una sola talla completa tres columnas para que se pueda leer", async () => {
    const r = unitallas("GT148", "BLACK", 48, { "24": 30 }, 1.78);
    expect(tallasDeColumnas(r)).toEqual(["24", "25", "26"]);
    const perfil = FABRICAS.find((f) => f.clave === "jiaxing")!;
    const p = await importarProforma(await excelDePedido({ pedido: "IN10185", fecha: "2026-10-11", perfil, moneda: "USD", renglones: r }), { nombre: "x.xlsx" });
    expect(p.lineas).toHaveLength(1);
    expect(p.lineas[0]).toMatchObject({ unitalla: "24", cajas: 30, pares: 1440 });
  });

  it("CHAOZHOU junta las cajas de una talla por color en un renglón", () => {
    const filas = filasDeTabla(ejemplo, "por-color");
    expect(filas).toHaveLength(1);
    expect(filas[0].bajoTalla).toEqual({ "26": 22, "27": 26, "28": 16, "29": 15, "30": 10 });
    expect(filas[0].cajas).toBe(89);
  });
});

describe("pedido SIN fábrica: Excel sencillo", () => {
  it("sin fábrica, moneda ni precio se arma y se vuelve a leer", async () => {
    const { SIN_FABRICA } = await import("./fabricas");
    const r = unitallas("GT999", "BLACK", 12, { "25": 10, "26": 8 }, 0).map((x) => ({ ...x, precio: null }));
    const buf = await excelDePedido({ pedido: "IN10190", fecha: "2026-10-20", perfil: SIN_FABRICA, moneda: null, renglones: r });
    const p = await importarProforma(buf, { nombre: "IN10190 (GT999).xlsx" });
    expect(p.pedido).toBe("IN10190");
    expect(p.lineas.map((l) => [l.unitalla, l.cajas, l.pares, l.precioUnitario])).toEqual([
      ["25", 10, 120, null],
      ["26", 8, 96, null],
    ]);
  });
});
