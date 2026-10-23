import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { libroDeXlsx, type Libro } from "../finanzas/sheets";
import { leerPreciosFundas } from "./precios-sheet";

const abrir = () => libroDeXlsx(readFileSync(join(process.cwd(), "fixtures", "sheet-numeros-2026-10-16.xlsx")));

describe("leerPreciosFundas (pestaña FUNDAS de Números)", () => {
  it("lee los tres bloques del sheet real", async () => {
    const { precios } = leerPreciosFundas(await abrir());
    const de = (d: string) => precios.find((p) => p.diseno === d);
    expect(precios.length).toBe(95);
    // Fundas: PV MELI y su columna de relámpago.
    expect(de("499")).toMatchObject({ pvMeli: 98.78, relampago: 104.21, bloque: "FUNDAS" });
    // Micas: su categoría no permite relámpago, no hay precio.
    expect(de("462")).toMatchObject({ pvMeli: 80.16, relampago: null, bloque: "MICAS" });
    // Tabletas.
    expect(de("686")).toMatchObject({ pvMeli: 364.92, relampago: 384.99, bloque: "FUNDAS TABLETA" });
  });

  it("un diseño en dos renglones se queda con el precio más alto", async () => {
    const { precios, avisos } = leerPreciosFundas(await abrir());
    expect(precios.find((p) => p.diseno === "380")).toMatchObject({ renglones: ["380 GRANDE", "380 CHICO"], pvMeli: 135.96 });
    expect(avisos.join(" ")).toMatch(/380 \(380 GRANDE, 380 CHICO\)/);
  });

  it("sin la pestaña lo dice", () => {
    expect(leerPreciosFundas(new Map() as Libro)).toEqual({ precios: [], avisos: ["El sheet de Números no tiene la pestaña FUNDAS."] });
  });

  it("ignora renglones sin diseño o sin precio", () => {
    const libro: Libro = new Map([
      [
        "FUNDAS",
        [
          [{ v: "MODELO" }, { v: "PV MELI" }, { v: "5% MAS PARA RELAMPAGO" }],
          [{ v: "514" }, { v: 94.18 }, { v: 99.36 }],
          [{ v: "748" }, { v: null }, { v: null }],
          [{ v: "TOTAL" }, { v: 10 }, { v: 11 }],
        ],
      ],
    ]);
    expect(leerPreciosFundas(libro).precios).toEqual([
      { diseno: "514", pvMeli: 94.18, relampago: 99.36, bloque: "FUNDAS", renglones: ["514"] },
    ]);
  });
});
