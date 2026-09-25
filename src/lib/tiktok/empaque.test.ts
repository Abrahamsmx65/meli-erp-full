import { describe, expect, it } from "vitest";
import { partirEnHojas, renglonesDeTallas, surtidoDeHoja } from "./empaque";

const paq = (...skus: Array<[string, number]>) => ({ pares: skus.map(([sku, pares]) => ({ sku, pares })) });

describe("surtidoDeHoja", () => {
  it("junta los pares por SKU y los agrupa por modelo + color con sus tallas, en orden de bodega", () => {
    const s = surtidoDeHoja([
      paq(["GT114-BEIGE-24-MX", 1]),
      paq(["GT114-TABACO BROWN-27-MX", 2]),
      paq(["GT114-BEIGE-23-MX", 1], ["GT114-BEIGE-24-MX", 1]),
      paq(["GT114-BEIGE-23-MX", 1]),
    ]);
    expect(s).toEqual([
      { modelo: "GT114", color: "BEIGE", tallas: [{ talla: "23", pares: 2 }, { talla: "24", pares: 2 }], pares: 4 },
      { modelo: "GT114", color: "TABACO BROWN", tallas: [{ talla: "27", pares: 2 }], pares: 2 },
    ]);
  });

  it("ordena las tallas como números (9 antes de 24) y dos modelos salen en líneas aparte", () => {
    const s = surtidoDeHoja([paq(["GT148-BLK-24-MX", 1], ["GT148-BLK-9-MX", 1], ["GT114-NAVY-28-MX", 1])]);
    expect(s.map((l) => `${l.modelo} ${l.color}: ${l.tallas.map((t) => t.talla).join(",")}`)).toEqual([
      "GT114 NAVY: 28",
      "GT148 BLK: 9,24",
    ]);
  });
});

describe("partirEnHojas", () => {
  const costoPaquete = (p: { pares: { pares: number }[] }) => 10 * p.pares.length;
  const costoFijo = (s: unknown[]) => 20 + 5 * s.length;

  it("un paquete nunca se parte y la hoja se cierra cuando ya no cabe con su surtido", () => {
    // alto 60: fijo 25 (un color) + 10 por paquete → caben 3 por hoja.
    const paquetes = Array.from({ length: 7 }, () => paq(["GT114-BEIGE-23-MX", 1]));
    const hojas = partirEnHojas(paquetes, 60, costoPaquete, costoFijo);
    expect(hojas.map((h) => h.paquetes.length)).toEqual([3, 3, 1]);
    expect(hojas[0].surtido).toEqual([{ modelo: "GT114", color: "BEIGE", tallas: [{ talla: "23", pares: 3 }], pares: 3 }]);
    expect(hojas[2].surtido[0].pares).toBe(1);
  });

  it("un color más en la hoja también cuesta espacio: el bloque de surtido crece", () => {
    // alto 60: con dos colores el fijo es 30 y solo caben 3 paquetes; el
    // cuarto, de otro color, sube el fijo a 35 y ya no cabe (35 + 40 > 60).
    const paquetes = [
      paq(["GT114-BEIGE-23-MX", 1]),
      paq(["GT114-BEIGE-23-MX", 1]),
      paq(["GT114-NAVY-23-MX", 1]),
      paq(["GT114-TABACO BROWN-23-MX", 1]),
    ];
    const hojas = partirEnHojas(paquetes, 60, costoPaquete, costoFijo);
    expect(hojas.map((h) => h.paquetes.length)).toEqual([3, 1]);
  });

  it("un paquete que no cabe ni solo va de todos modos, en su propia hoja", () => {
    const grande = paq(["A-B-1", 1], ["A-B-2", 1], ["A-B-3", 1], ["A-B-4", 1], ["A-B-5", 1]);
    const hojas = partirEnHojas([paq(["A-B-1", 1]), grande, paq(["A-B-1", 1])], 40, costoPaquete, costoFijo);
    expect(hojas.map((h) => h.paquetes.length)).toEqual([1, 1, 1]);
  });

  it("sin paquetes no hay hojas", () => {
    expect(partirEnHojas([], 100, costoPaquete, costoFijo)).toEqual([]);
  });
});

describe("renglonesDeTallas", () => {
  const medir = (t: string) => t.length;
  it("escribe «talla ×pares» y pasa al renglón de abajo lo que no cabe", () => {
    const tallas = [{ talla: "23", pares: 8 }, { talla: "24", pares: 5 }, { talla: "27", pares: 20 }];
    expect(renglonesDeTallas(tallas, 100, medir)).toEqual(["23 ×8   24 ×5   27 ×20"]);
    expect(renglonesDeTallas(tallas, 14, medir)).toEqual(["23 ×8   24 ×5", "27 ×20"]);
    expect(renglonesDeTallas([], 14, medir)).toEqual([]);
  });
});
