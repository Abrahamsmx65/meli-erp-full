/**
 * El Excel de ASINs es lo que se le pega al contenido A+: si le faltara un
 * hijo o repitiera uno, el A+ quedaría a medias. Se lee el libro de vuelta
 * para comprobar lo que en verdad sale.
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { AsinModelo } from "./contenido-amazon";
import { libroDeAsins } from "./contenido-asins";

const hijo = (sellerSku: string, extra: Partial<AsinModelo> = {}): AsinModelo => ({
  modelo: "GT128",
  color: "BLK",
  talla: "23",
  sellerSku,
  asin: `A-${sellerSku}`,
  estado: "Active",
  padre: null,
  ...extra,
});

async function leer(buffer: Buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as ArrayBuffer);
  const celdas = (nombre: string) => {
    const hoja = libro.getWorksheet(nombre)!;
    const filas: string[][] = [];
    hoja.eachRow((fila) => {
      const valores: string[] = [];
      fila.eachCell({ includeEmpty: true }, (c) => valores.push(String(c.value ?? "")));
      filas.push(valores);
    });
    return filas;
  };
  return { libro, celdas };
}

describe("libroDeAsins", () => {
  it("la hoja ASINs trae un renglón por hijo con encabezado", async () => {
    const { celdas } = await leer(
      await libroDeAsins([
        hijo("GT128-23-BLK-MX"),
        hijo("GT128-24-BLK-MX", { talla: "24", estado: "Inactive", padre: "PADRE1" }),
      ]),
    );
    const filas = celdas("ASINs");
    expect(filas[0]).toEqual([
      "ASIN", "Modelo", "Color", "Talla", "SKU (Amazon)", "Estado", "ASIN padre",
    ]);
    expect(filas[1]).toEqual(["A-GT128-23-BLK-MX", "GT128", "BLK", "23", "GT128-23-BLK-MX", "Activo", ""]);
    expect(filas[2]).toEqual([
      "A-GT128-24-BLK-MX", "GT128", "BLK", "24", "GT128-24-BLK-MX", "Inactivo", "PADRE1",
    ]);
  });

  it("la hoja Lista trae puros ASINs, sin encabezado, sin repetir y sin vacíos", async () => {
    const { celdas } = await leer(
      await libroDeAsins([
        hijo("GT128-23-BLK-MX"),
        hijo("GT128-23-BLK-MX-DUP", { asin: "A-GT128-23-BLK-MX" }),
        hijo("GT128-25-BLK-MX", { talla: "25", asin: null }),
        hijo("GT128-24-BLK-MX", { talla: "24" }),
      ]),
    );
    expect(celdas("Lista")).toEqual([["A-GT128-23-BLK-MX"], ["A-GT128-24-BLK-MX"]]);
  });
});
