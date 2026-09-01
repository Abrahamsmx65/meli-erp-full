import { describe, expect, it } from "vitest";
import { armarSkuBodega, leerHoja, leerInventario, urlExportacion } from "./sheets";

describe("urlExportacion", () => {
  it("convierte la URL del navegador en la de exportación", () => {
    expect(urlExportacion("https://docs.google.com/spreadsheets/d/abc_123-XYZ/edit#gid=0")).toBe(
      "https://docs.google.com/spreadsheets/d/abc_123-XYZ/export?format=xlsx",
    );
  });
  it("rechaza lo que no es un sheet", () => {
    expect(() => urlExportacion("https://ejemplo.com/x.xlsx")).toThrow();
  });
});

describe("leerHoja en formato tabla", () => {
  const celdas = [
    ["DISEÑO 499 — inventario", "", ""],
    ["", "", ""],
    ["Modelo", "Color", "Cantidad"],
    ["IP15PM", "Negro", "120"],
    ["IP15PM", "Azul", "35"],
    ["A54", "", "1,200"],
    ["", "", ""],
    ["TOTAL", "", "1355"],
  ];

  it("lee por nombre de columna, saltando títulos y totales", () => {
    const r = leerHoja("499", celdas);
    expect(r.formato).toBe("tabla");
    expect(r.filas).toHaveLength(3);
    expect(r.filas[0]).toEqual({
      skuBodega: "499-IP15PM-NEGRO",
      hoja: "499",
      diseno: "499",
      modelo: "IP15PM",
      color: "NEGRO",
      cantidad: 120,
    });
    expect(r.filas[2].cantidad).toBe(1200);
    expect(r.filas[2].skuBodega).toBe("499-A54");
  });

  it("usa la columna SKU cuando existe", () => {
    const r = leerHoja("499", [
      ["SKU", "MODELO", "EXISTENCIA"],
      ["499N-IP15PM", "IP15PM", "10"],
    ]);
    expect(r.filas[0].skuBodega).toBe("499N-IP15PM");
  });

  it("avisa de cantidades que no son número", () => {
    const r = leerHoja("499", [
      ["MODELO", "CANTIDAD"],
      ["IP15PM", "muchas"],
    ]);
    expect(r.filas).toHaveLength(0);
    expect(r.avisos[0].fila).toBe(2);
  });
});

describe("leerHoja en formato matriz", () => {
  const celdas = [
    ["", "NEGRO", "AZUL", "ROJO"],
    ["IP15PM", "12", "", "3"],
    ["A54", "0", "7", ""],
    ["TOTAL", "12", "7", "3"],
  ];

  it("cruza modelos con colores", () => {
    const r = leerHoja("501", celdas);
    expect(r.formato).toBe("matriz");
    expect(r.filas.map((f) => [f.skuBodega, f.cantidad])).toEqual([
      ["501-IP15PM-NEGRO", 12],
      ["501-IP15PM-ROJO", 3],
      ["501-A54-NEGRO", 0],
      ["501-A54-AZUL", 7],
    ]);
  });
});

describe("leerInventario", () => {
  it("junta todas las pestañas y suma repetidos avisando", () => {
    const r = leerInventario([
      { nombre: "499", celdas: [["MODELO", "CANTIDAD"], ["IP15PM", "10"]] },
      { nombre: "499 bis", celdas: [["SKU", "CANTIDAD"], ["499-IP15PM", "5"]] },
      { nombre: "Notas", celdas: [["esto es un texto libre"], ["sin nada"]] },
    ]);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].cantidad).toBe(15);
    expect(r.hojas.map((h) => h.formato)).toEqual(["tabla", "tabla", "sin_datos"]);
    expect(r.avisos.some((a) => a.mensaje.includes("se sumó"))).toBe(true);
  });
});

describe("armarSkuBodega", () => {
  it("canoniza y omite lo vacío", () => {
    expect(armarSkuBodega("499", "ip 15 pm", "")).toBe("499-IP-15-PM");
  });
});
