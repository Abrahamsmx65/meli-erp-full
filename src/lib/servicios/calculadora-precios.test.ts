import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { hojaResumen, type CalculadoraCargada } from "./calculadora-precios";

describe("hoja Resumen del Excel de la factura", () => {
  it("trae los dos precios por modelo y los totales", () => {
    const renglon = {
      modelo: "GT114", categoria: null, fuente: "real" as const, unidades: 100,
      recibidoPar: 133.48, fullPar: 3.32, publicidadPar: 5.17, margenKomerlinePar: 0,
      precioKomerline: 124.99, gastoOperativoPar: 3.86, gananciaIndustherPar: 3.75,
      precioIndusther: 117.38, costo: 60.55, margenProveedor: 56.83, precioRelampago: null,
    };
    const calc = { meses: ["2026-09"], renglones: [renglon] } as unknown as CalculadoraCargada;
    const libro = new ExcelJS.Workbook();
    hojaResumen(libro, { numero: "S271", iso: null }, calc, [{ modelo: "GT114", pares: 10 }, { modelo: "GT114", pares: 2 }],
      new Map([["GT114", renglon]]), () => ({ descripcion: "", codigoSat: "53111600" }));
    const hoja = libro.getWorksheet("Resumen")!;
    expect(hoja.getRow(4).values).toContain("PRECIO INDUSTHER");
    const fila = hoja.getRow(5).values as unknown[];
    expect(fila.slice(1)).toEqual(["GT114", "53111600", 12, 133.48, 3.32, 5.17, 124.99, 3.86, 3.75, 117.38, 1499.88, 1408.56]);
  });
});
