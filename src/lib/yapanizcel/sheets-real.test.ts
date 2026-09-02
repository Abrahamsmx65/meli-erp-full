import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leerInventario, leerLibro } from "./sheets";
import { leerCostos } from "./costos";
import { desglosar } from "./sku";

/**
 * El sheet REAL de inventario (INVENTARIO NUEVO, 1 sep 2026): una pestaña
 * por diseño, sin encabezados, SKU en la columna A y cantidad en la B; más
 * TOTALES, CONSECUTIVO TOTALES y RETIRO, que no son inventario.
 */
const buf = readFileSync("fixtures/yz-inventario.xlsx");

describe("sheet real de inventario", async () => {
  const hojas = await leerLibro(buf);
  const r = leerInventario(hojas);

  it("omite las pestañas que no son diseño", () => {
    const omitidas = r.hojas.filter((h) => h.formato === "omitida").map((h) => h.nombre);
    expect(omitidas).toEqual(["TOTALES", "CONSECUTIVO TOTALES", "RETIRO"]);
  });

  it("lee cada pestaña de diseño como lista", () => {
    const disenos = r.hojas.filter((h) => h.formato !== "omitida");
    expect(disenos.length).toBe(97);
    // 654 está vacía; las demás traen datos.
    expect(disenos.filter((h) => h.formato === "lista").length).toBe(96);
    expect(disenos.find((h) => h.nombre === "654")?.formato).toBe("sin_datos");
  });

  it("cuadra con los totales de cada pestaña", () => {
    const suma = (hoja: string) => r.filas.filter((f) => f.hoja === hoja).reduce((a, f) => a + f.cantidad, 0);
    expect(suma("367")).toBe(3600);
    expect(suma("380")).toBe(660);
    expect(suma("499")).toBe(10364);
    expect(suma("678")).toBe(9054);
    // Total de todas las pestañas de diseño, sin resúmenes ni RETIRO.
    expect(r.filas.reduce((a, f) => a + f.cantidad, 0)).toBe(155342);
  });

  it("guarda el SKU tal cual y desglosa diseño, modelo y color", () => {
    const f = r.filas.find((x) => x.skuBodega === "362-Rmn13-5G-blue")!;
    expect(f).toMatchObject({ hoja: "362", diseno: "362", modelo: "RMN13-5G", color: "BLUE", cantidad: 23 });
    const g = r.filas.find((x) => x.skuBodega === "367-A24-4G")!;
    expect(g).toMatchObject({ modelo: "A24-4G", color: "" });
  });

  it("avisa de los renglones con SKU y sin cantidad en vez de tirarlos en silencio", () => {
    const sin = r.avisos.filter((a) => a.mensaje.includes("sin cantidad"));
    expect(sin.some((a) => a.hoja === "499" && a.mensaje.includes("499-ise2022"))).toBe(true);
    expect(sin.some((a) => a.hoja === "450" && a.mensaje.includes("450-i14pro"))).toBe(true);
  });

  it("ignora la nota que va a la derecha de la cantidad", () => {
    expect(r.filas.find((x) => x.skuBodega === "437-A11plus-blk")?.cantidad).toBe(555);
  });
});

describe("costos", () => {
  it("rechaza el sheet de inventario: de TOTALES no se toma información", async () => {
    await expect(leerCostos(buf)).rejects.toThrow(/TOTALES/);
  });
});

describe("desglosar con SKUs reales", () => {
  it.each([
    ["437-A11plus-blk", "437", "A11PLUS", "BLK"],
    ["412-iPad10-blue", "412", "IPAD10", "BLUE"],
    ["437-iPadPro11-2024", "437", "IPADPRO11-2024", ""],
    ["450-Rm15c/C85", "450", "RM15C-C85", ""],
    ["439-A34-transparente", "439", "A34", "TRANSPARENTE"],
    ["388-S22plus", "388", "S22PLUS", ""],
  ])("%s", (sku, diseno, modelo, color) => {
    expect(desglosar(sku)).toEqual({ diseno, modelo, color });
  });
});
