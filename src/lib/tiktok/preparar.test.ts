import { describe, expect, it } from "vitest";
import { numerarPaquetes, codigoDeHoja, parsearCodigoDeHoja, codigoDeEtiqueta } from "./despacho";
import { avanzar, estadoInicial } from "./preparar";

const paquetes = numerarPaquetes([
  { orderId: "a", packageId: "pa", destinatario: null, pares: [{ sku: "GT114-BEIGE-23", pares: 1, fnsku: "X001AAA" }] },
  { orderId: "b", packageId: "pb", destinatario: null, pares: [{ sku: "GT114-BLK-25", pares: 2, fnsku: "X001BBB" }] },
  { orderId: "c", packageId: "pc", destinatario: null, pares: [{ sku: "GT150-CAMEL-27", pares: 1, fnsku: null }] },
]);
const CORTE = 7;
const nadie = new Set<number>();

describe("código de hoja", () => {
  it("va y viene", () => {
    expect(codigoDeHoja(7, 12)).toBe("TT7-12");
    expect(parsearCodigoDeHoja("tt7-12")).toEqual({ corte: 7, numero: 12 });
    expect(parsearCodigoDeHoja("X001AAA")).toBeNull();
  });
  it("la etiqueta lleva el FNSKU, y sin FNSKU el código de hoja", () => {
    expect(codigoDeEtiqueta(paquetes[0], CORTE)).toBe("X001AAA");
    expect(codigoDeEtiqueta(paquetes[2], CORTE)).toBe("TT7-3");
  });
});

describe("estación de preparar: el camino feliz", () => {
  it("hoja → etiqueta → producto → listo", () => {
    let e = estadoInicial();
    e = avanzar(e, "TT7-1", CORTE, paquetes, nadie);
    expect(e.paso).toBe("etiqueta");
    expect(e.error).toBeNull();
    e = avanzar(e, "X001AAA", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    e = avanzar(e, "X001AAA", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
    expect(e.escaneos).toEqual(["TT7-1", "X001AAA", "X001AAA"]);
  });

  it("si se pidieron dos, hay que escanear dos", () => {
    let e = avanzar(estadoInicial(), "TT7-2", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.indicacion).toMatch(/Faltan 1 par/);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
  });

  it("el escáner puede mandar minúsculas o espacios", () => {
    let e = avanzar(estadoInicial(), "  tt7-1 ", CORTE, paquetes, nadie);
    e = avanzar(e, "x001aaa\n", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
  });
});

describe("estación de preparar: lo que NO debe pasar", () => {
  it("una etiqueta de otro producto no avanza", () => {
    let e = avanzar(estadoInicial(), "TT7-1", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("etiqueta");
    expect(e.error).toMatch(/no es del #1/);
  });

  it("un producto equivocado no avanza", () => {
    let e = avanzar(estadoInicial(), "TT7-1", CORTE, paquetes, nadie);
    e = avanzar(e, "X001AAA", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.error).toMatch(/no va en el #1/);
  });

  it("escanear el producto antes que la hoja avisa", () => {
    const e = avanzar(estadoInicial(), "X001AAA", CORTE, paquetes, nadie);
    expect(e.paso).toBe("hoja");
    expect(e.error).toMatch(/Primero la hoja/);
  });

  it("una hoja de otro corte, o ya preparada, no entra", () => {
    expect(avanzar(estadoInicial(), "TT6-1", CORTE, paquetes, nadie).error).toMatch(/corte #6/);
    expect(avanzar(estadoInicial(), "TT7-1", CORTE, paquetes, new Set([1])).error).toMatch(/ya está preparado/);
    expect(avanzar(estadoInicial(), "TT7-99", CORTE, paquetes, nadie).error).toMatch(/No hay renglón/);
  });

  it("escanear otra hoja a medio camino cambia de paquete sin trabarse", () => {
    let e = avanzar(estadoInicial(), "TT7-1", CORTE, paquetes, nadie);
    e = avanzar(e, "TT7-2", CORTE, paquetes, nadie);
    expect(e.paquete?.numero).toBe(2);
    expect(e.paso).toBe("etiqueta");
  });
});

describe("estación de preparar: producto sin FNSKU", () => {
  it("se da por listo al escanear la etiqueta (código de hoja) y lo dice", () => {
    let e = avanzar(estadoInicial(), "TT7-3", CORTE, paquetes, nadie);
    e = avanzar(e, "TT7-3", CORTE, paquetes, nadie);
    expect(e.paquete?.numero).toBe(3);
    expect(e.paso).toBe("listo");
    expect(e.indicacion).toMatch(/sin FNSKU/);
  });
});
