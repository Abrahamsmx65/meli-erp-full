import { describe, expect, it } from "vitest";
import { numerarPaquetes, codigoDeHoja, parsearCodigoDeHoja, codigoDeEtiqueta } from "./despacho";
import { avanzar, darPorBueno, estadoInicial } from "./preparar";

const paquetes = numerarPaquetes([
  { orderId: "a", packageId: "pa", destinatario: null, pares: [{ sku: "GT114-BEIGE-23", pares: 1, fnsku: "X001AAA" }] },
  { orderId: "b", packageId: "pb", destinatario: null, pares: [{ sku: "GT114-BLK-25", pares: 2, fnsku: "X001BBB" }] },
  { orderId: "c", packageId: "pc", destinatario: null, pares: [{ sku: "GT150-CAMEL-27", pares: 1, fnsku: null }] },
  { orderId: "d", packageId: "pd", destinatario: null, pares: [{ sku: "GT114-BEIGE-23", pares: 1, fnsku: "X001AAA" }] },
  {
    orderId: "e", packageId: "pe", destinatario: null,
    pares: [{ sku: "GT160-NAVY-24", pares: 1, fnsku: "X001EEE" }, { sku: "GT160-NAVY-25", pares: 1, fnsku: null }],
  },
]);
// Orden esperado: #1 a (BEIGE-23), #2 d (BEIGE-23), #3 b (BLK-25 ×2), #4 c (GT150), #5 e (GT160)
const CORTE = 7;
const nadie = new Set<number>();

describe("códigos", () => {
  it("hoja va y viene; etiqueta = FNSKU, o código de hoja si no hay", () => {
    expect(codigoDeHoja(7, 12)).toBe("TT7-12");
    expect(parsearCodigoDeHoja("tt7-12")).toEqual({ corte: 7, numero: 12 });
    expect(codigoDeEtiqueta(paquetes[0], CORTE)).toBe("X001AAA");
    expect(codigoDeEtiqueta(paquetes[3], CORTE)).toBe("TT7-4");
  });
});

describe("empezar por la etiqueta (lo normal)", () => {
  it("la etiqueta elige el SIGUIENTE paquete sin preparar con ese producto, y pita por par", () => {
    let e = avanzar(estadoInicial(), "X001AAA", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.paquete?.numero).toBe(1);
    expect(e.pitidos).toBe(1);
    e = avanzar(e, "X001AAA", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
    // Con el #1 preparado, la misma etiqueta va al #2.
    const e2 = avanzar(estadoInicial(), "X001AAA", CORTE, paquetes, new Set([1]));
    expect(e2.paquete?.numero).toBe(2);
  });

  it("dos pares: dos pitidos al identificar y dos escaneos de producto", () => {
    let e = avanzar(estadoInicial(), "X001BBB", CORTE, paquetes, nadie);
    expect(e.paquete?.numero).toBe(3);
    expect(e.pitidos).toBe(2);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.indicacion).toMatch(/faltan 1 par/);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
    expect(e.escaneos).toEqual(["X001BBB", "X001BBB", "X001BBB"]);
  });

  it("si ya se prepararon todos los de ese producto, lo dice", () => {
    const e = avanzar(estadoInicial(), "X001AAA", CORTE, paquetes, new Set([1, 2]));
    expect(e.error).toMatch(/ya están preparados/);
  });

  it("un código que no es de nada avisa sin avanzar", () => {
    const e = avanzar(estadoInicial(), "ZZZ", CORTE, paquetes, nadie);
    expect(e.paso).toBe("inicio");
    expect(e.error).toMatch(/no es etiqueta ni renglón/);
  });
});

describe("empezar por la hoja también sirve", () => {
  it("hoja → etiqueta → producto → listo", () => {
    let e = avanzar(estadoInicial(), "TT7-3", CORTE, paquetes, nadie);
    expect(e.paso).toBe("etiqueta");
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.pitidos).toBe(2);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
  });

  it("una etiqueta de otro producto no avanza", () => {
    let e = avanzar(estadoInicial(), "TT7-1", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("etiqueta");
    expect(e.error).toMatch(/no es del #1/);
  });

  it("hoja de otro corte, ya preparada o inexistente, no entra", () => {
    expect(avanzar(estadoInicial(), "TT6-1", CORTE, paquetes, nadie).error).toMatch(/corte #6/);
    expect(avanzar(estadoInicial(), "TT7-1", CORTE, paquetes, new Set([1])).error).toMatch(/ya está preparado/);
    expect(avanzar(estadoInicial(), "TT7-99", CORTE, paquetes, nadie).error).toMatch(/No hay renglón/);
  });
});

describe("lo que no debe pasar en el producto", () => {
  it("un producto equivocado no avanza", () => {
    let e = avanzar(estadoInicial(), "X001AAA", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.error).toMatch(/no va en el #1/);
  });

  it("escanear un tercer par cuando eran dos, no pasa", () => {
    let e = avanzar(estadoInicial(), "X001BBB", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
    const otra = avanzar(e, "X001BBB", CORTE, paquetes, new Set([3]));
    expect(otra.error).toMatch(/ya están preparados/);
  });
});

describe("sin FNSKU: solo lo cierra 'Dar por bueno'", () => {
  it("paquete entero sin FNSKU: hoja, etiqueta (código de hoja), y el botón", () => {
    let e = avanzar(estadoInicial(), "TT7-4", CORTE, paquetes, nadie);
    e = avanzar(e, "TT7-4", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.indicacion).toMatch(/Dar por bueno/);
    // El escáner no puede cerrarlo.
    const intento = avanzar(e, "LOQUESEA", CORTE, paquetes, nadie);
    expect(intento.error).toBeTruthy();
    e = darPorBueno(e);
    expect(e.paso).toBe("listo");
    expect(e.escaneos).toContain("MANUAL:GT150-CAMEL-27×1");
  });

  it("paquete mixto: el par con FNSKU se escanea, el otro se da por bueno", () => {
    let e = avanzar(estadoInicial(), "X001EEE", CORTE, paquetes, nadie);
    expect(e.paquete?.numero).toBe(5);
    expect(e.pitidos).toBe(2);
    e = avanzar(e, "X001EEE", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.indicacion).toMatch(/sin FNSKU/);
    e = darPorBueno(e);
    expect(e.paso).toBe("listo");
  });

  it("'Dar por bueno' no cierra lo que sí tiene FNSKU", () => {
    const e = avanzar(estadoInicial(), "X001EEE", CORTE, paquetes, nadie);
    const d = darPorBueno(e);
    // Cierra el par sin FNSKU, pero el X001EEE sigue faltando.
    expect(d.paso).toBe("producto");
    expect(d.indicacion).toMatch(/faltan 1 par/);
    const bloqueado = darPorBueno({ ...d });
    expect(bloqueado.error).toMatch(/sí tiene FNSKU/);
  });
});
