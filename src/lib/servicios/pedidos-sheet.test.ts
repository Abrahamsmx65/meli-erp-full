/**
 * El sheet de pedidos pendientes, contra una exportación REAL de la
 * pestaña INTERNET (fixtures/pedidos-pendientes-sheet.xlsx).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leerHoja } from "../importar/leer-hoja";
import {
  esNumeroDePedido,
  leerCsv,
  pedidosDeFilas,
  urlCsvSheets,
  URL_SHEET_PEDIDOS_OMISION,
} from "./pedidos-sheet";

describe("urlCsvSheets", () => {
  it("baja la pestaña del gid de la URL como CSV", () => {
    expect(urlCsvSheets(URL_SHEET_PEDIDOS_OMISION)).toBe(
      "https://docs.google.com/spreadsheets/d/18Pr9b6q2hDqZIWkX0uBX4g-ihfdi6tSpx6KKmYby7C8/export?format=csv&gid=0",
    );
    expect(urlCsvSheets("https://docs.google.com/spreadsheets/d/abc_-1/edit#gid=1234")).toContain(
      "gid=1234",
    );
  });

  it("rechaza URLs que no son de Google Sheets", () => {
    expect(() => urlCsvSheets("https://ejemplo.com/x.csv")).toThrow(/Google Sheets/);
  });
});

describe("leerCsv", () => {
  it("respeta comillas, comas adentro y saltos de línea", () => {
    const filas = leerCsv('IN10164,"GT250, GT297 GT298 GT303",7680\r\nIN10131,GT104-1,1920\n');
    expect(filas).toEqual([
      ["IN10164", "GT250, GT297 GT298 GT303", "7680"],
      ["IN10131", "GT104-1", "1920"],
    ]);
  });
});

describe("esNumeroDePedido", () => {
  it("reconoce IN##### y AR#####, y nada más", () => {
    expect(esNumeroDePedido("IN10127")).toBe(true);
    expect(esNumeroDePedido("AR10003")).toBe(true);
    expect(esNumeroDePedido("GT268-GT271")).toBe(false);
    expect(esNumeroDePedido("Jinjiang")).toBe(false);
    expect(esNumeroDePedido("June 24")).toBe(false);
  });
});

describe("pedidosDeFilas con la exportación real", () => {
  const buf = readFileSync(join(process.cwd(), "fixtures", "pedidos-pendientes-sheet.xlsx"));

  it("lee los 33 pedidos IN y deja fuera los dos AR", async () => {
    const filas = await leerHoja(buf, { nombre: "pendientes.xlsx" });
    const { pedidos, ignorados } = pedidosDeFilas(filas);
    expect(ignorados).toEqual(["AR10003", "AR10037"]);
    expect(pedidos).toHaveLength(33);
    expect(pedidos.map((p) => p.pedido)).toContain("IN10079");
    expect(pedidos.map((p) => p.pedido)).not.toContain("AR10003");
  });

  it("le pega a cada pedido su fábrica, modelos, pares y embarque", async () => {
    const filas = await leerHoja(buf, { nombre: "pendientes.xlsx" });
    const { pedidos } = pedidosDeFilas(filas);
    const p = pedidos.find((x) => x.pedido === "IN10151")!;
    expect(p.fabrica).toBe("Jinjiang");
    expect(p.modelos).toBe("GT104");
    expect(p.pares).toBe(18240);
    // En el xlsx la celda es fecha; en el CSV llega como texto ("Sep20").
    expect(p.embarque).toMatch(/^(2026-09-20|Sep ?20)$/);

    const primero = pedidos.find((x) => x.pedido === "IN10127")!;
    expect(primero.fabrica).toBe("Chaozhou / Jieyang");

    const ultimo = pedidos.find((x) => x.pedido === "IN10165")!;
    expect(ultimo.fabrica).toBe("Zhejiang");
  });

  it("no toma los renglones de totales como pedidos ni como fábricas", async () => {
    const filas = await leerHoja(buf, { nombre: "pendientes.xlsx" });
    const { pedidos } = pedidosDeFilas(filas);
    const fabricas = new Set(pedidos.map((p) => p.fabrica));
    expect(fabricas.has("Total")).toBe(false);
    expect(fabricas.has("Qtys")).toBe(false);
  });
});
