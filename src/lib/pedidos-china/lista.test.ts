import { describe, expect, it } from "vitest";
import { leerLista } from "./lista";

describe("leerLista: la lista que el dueño manda a la fábrica", () => {
  it("lee el ejemplo real del dueño (GT179 y GT181, cajas de 12 de una talla)", () => {
    const r = leerLista(`GT179 CTNS OF 12\t\n\nBROWN\n26\t22\n27\t26\n28\t16\n29\t15\n30\t10\n\nGT181 BLK\t\nCTNS OF 12\t\n\t\n25\t12\n26\t8\n27\t13\n28\t6\n29\t6\n30\t6\n`);
    expect(r.sinEntender).toEqual([]);
    expect(r.modelos.map((m) => m.modelo)).toEqual(["GT179", "GT181"]);
    const [a, b] = r.modelos;
    expect(a.avisos).toEqual([]);
    expect(a.colores).toHaveLength(1);
    expect(a.colores[0].color).toBe("BROWN");
    expect(a.colores[0].renglones.map((x) => [x.unitalla, x.cajas, x.paresPorCaja])).toEqual([
      ["26", 22, 12],
      ["27", 26, 12],
      ["28", 16, 12],
      ["29", 15, 12],
      ["30", 10, 12],
    ]);
    expect(b.colores[0].color).toBe("BLK");
    expect(b.colores[0].renglones.reduce((s, x) => s + x.cajas, 0)).toBe(51);
    expect(b.colores[0].renglones.every((x) => x.paresPorCaja === 12)).toBe(true);
    expect(a.texto).toContain("GT179");
    expect(a.texto).not.toContain("GT181");
    expect(b.texto.startsWith("GT181 BLK")).toBe(true);
  });

  it("lee corridas con tallas en su línea, talla:pares y «misma corrida»", () => {
    const r = leerLista(`GT144 BLK CTNS OF 48
23 24 25 26 27
5 10 11 12 10 X 20
CREAM
23:5 24:10 25:11 26:12 27:10 x 15
BEIGE
MISMA CORRIDA X 30`);
    const m = r.modelos[0];
    expect(m.avisos).toEqual([]);
    expect(m.colores.map((c) => c.color)).toEqual(["BLK", "CREAM", "BEIGE"]);
    expect(m.colores[0].renglones[0]).toMatchObject({ unitalla: null, cajas: 20, paresPorCaja: 48, corrida: { "23": 5, "24": 10, "25": 11, "26": 12, "27": 10 } });
    expect(m.colores[1].renglones[0]).toMatchObject({ cajas: 15, corrida: { "23": 5, "27": 10 } });
    expect(m.colores[2].renglones[0]).toMatchObject({ cajas: 30, mismaCorrida: true, corrida: null });
  });

  it("varios colores de un modelo y pares por caja que no se escribieron", () => {
    const r = leerLista(`GT114
BEIGE
23 10
24 20
BLK
23 5`);
    const m = r.modelos[0];
    expect(m.colores.map((c) => [c.color, c.renglones.length])).toEqual([["BEIGE", 2], ["BLK", 1]]);
    expect(m.colores[0].renglones[0].paresPorCaja).toBeNull();
  });

  it("avisa lo que no entiende sin tirar lo demás", () => {
    const r = leerLista(`hola\nGT150 TOFFEE\n24 10\nesto no\n`);
    expect(r.sinEntender).toHaveLength(1);
    expect(r.modelos[0].colores[0].renglones).toHaveLength(1);
    // «esto no» se toma como un color sin cajas: se quita y se avisa.
    expect(r.modelos[0].avisos.join(" ")).toContain("ESTO NO");
    expect(r.modelos[0].colores.map((c) => c.color)).toEqual(["TOFFEE"]);
  });
});

describe("SOLID SIZE 16 PRS (GT180 y GT181, 19-oct-2026)", () => {
  it("son los pares por caja, no un color", () => {
    const r = leerLista(
      "GT180\tSOLID SIZE 16 PRS\nBLK\t\n26\t7\n27\t13\n28\t15\n29\t5\n30\t5\n\t\nBROWN\t\n26\t5\n27\t10\n28\t8\n29\t7\n30\t5\n\t\nGT181\t\nBLK\tSOLID SIZE 16 PRS\n26\t11\n27\t8\n28\t15\n29\t7",
    );
    expect(r.modelos.map((m) => m.modelo)).toEqual(["GT180", "GT181"]);
    const [a, b] = r.modelos;
    expect(a.colores.map((c) => c.color)).toEqual(["BLK", "BROWN"]);
    expect(a.colores[0].renglones.map((x) => [x.unitalla, x.cajas, x.paresPorCaja])).toEqual([
      ["26", 7, 16], ["27", 13, 16], ["28", 15, 16], ["29", 5, 16], ["30", 5, 16],
    ]);
    expect(a.colores[1].renglones.reduce((s, x) => s + x.cajas, 0)).toBe(35);
    expect(b.colores.map((c) => c.color)).toEqual(["BLK"]);
    expect(b.colores[0].renglones.every((x) => x.paresPorCaja === 16)).toBe(true);
    expect(b.colores[0].renglones.reduce((s, x) => s + x.cajas, 0)).toBe(41);
    expect([...a.avisos, ...b.avisos]).toEqual([]);
  });
});
