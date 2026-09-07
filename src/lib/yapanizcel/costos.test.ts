import { describe, expect, it } from "vitest";
import { costoDeSku, leerCostosDeCeldas } from "./costos";

describe("leerCostosDeCeldas", () => {
  it("lee modelo y costo por encabezado", () => {
    const r = leerCostosDeCeldas([
      ["Lista de costos", ""],
      ["MODELO", "COSTO"],
      ["499", "$ 32.50"],
      ["501", "28"],
      ["", ""],
    ]);
    expect(r.filas).toEqual([
      { modelo: "499", etiqueta: "499", costo: 32.5 },
      { modelo: "501", etiqueta: "501", costo: 28 },
    ]);
  });

  it("sin encabezados toma las dos primeras columnas", () => {
    const r = leerCostosDeCeldas([["499", "30"], ["501", "31"]]);
    expect(r.filas).toHaveLength(2);
  });

  it("avisa de repetidos y de costos no numéricos", () => {
    const r = leerCostosDeCeldas([
      ["MODELO", "COSTO"],
      ["499", "30"],
      ["499", "35"],
      ["502", "por confirmar"],
    ]);
    expect(r.filas).toEqual([{ modelo: "499", etiqueta: "499", costo: 35 }]);
    expect(r.avisos).toHaveLength(2);
  });

  it("truena si no hay ni un renglón válido", () => {
    expect(() => leerCostosDeCeldas([["hola", "mundo"]])).toThrow();
  });
});

describe("costoDeSku", () => {
  const costos = new Map([
    ["499", 30],
    ["501-IP15PM", 40],
  ]);

  it("busca por el diseño del SKU", () => {
    expect(costoDeSku("499-IP15PM-NEGRO", costos)).toBe(30);
  });
  it("prefiere la clave completa cuando existe", () => {
    expect(costoDeSku("501-IP15PM", costos)).toBe(40);
  });
  it("tolera la letra de más en el diseño", () => {
    expect(costoDeSku("499N-IP15PM", costos)).toBe(30);
  });
  it("devuelve null cuando no hay dato, nunca 0", () => {
    expect(costoDeSku("777-X", costos)).toBeNull();
  });
});
