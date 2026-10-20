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

describe("COLOR N CTNS + ASSORTMENT (GT252 y GT259, 20-oct-2026)", () => {
  const corrida = { "23": 3, "24": 8, "25": 8, "26": 5 };

  it("lee el surtido debajo del color como UNA corrida por caja", () => {
    const { modelos, sinEntender } = leerLista(`GT252
BROWN 50 CTNS
ASSORTMENT
23 3
24 8
25 8
26 5

GT259
BLACK 30 CTNS
ASSORTMENT
23 3
24 8
25 8
26 5

BROWN 30 CTNS
ASSORTMENT
23 3
24 8
25 8
26 5`);
    expect(sinEntender).toEqual([]);
    expect(modelos.map((m) => m.modelo)).toEqual(["GT252", "GT259"]);
    for (const m of modelos) expect(m.avisos).toEqual([]);
    expect(modelos[0].colores).toHaveLength(1);
    expect(modelos[0].colores[0].color).toBe("BROWN");
    expect(modelos[0].colores[0].renglones).toMatchObject([{ unitalla: null, cajas: 50, paresPorCaja: 24, corrida }]);
    expect(modelos[1].colores.map((c) => c.color)).toEqual(["BLACK", "BROWN"]);
    for (const c of modelos[1].colores) {
      expect(c.renglones).toMatchObject([{ unitalla: null, cajas: 30, paresPorCaja: 24, corrida }]);
    }
  });

  it("sin línea en blanco y con el color en la línea del modelo", () => {
    const { modelos } = leerLista(`GT259 BLACK 30 CTNS
ASSORTMENT
23 3
24 8
BROWN 10 CTNS
ASSORTMENT
23 4
24 4`);
    expect(modelos[0].colores).toMatchObject([
      { color: "BLACK", renglones: [{ cajas: 30, paresPorCaja: 11, corrida: { "23": 3, "24": 8 } }] },
      { color: "BROWN", renglones: [{ cajas: 10, paresPorCaja: 8, corrida: { "23": 4, "24": 4 } }] },
    ]);
  });

  it("sin ASSORTMENT las líneas siguen siendo talla y cajas", () => {
    const { modelos } = leerLista(`GT179 CTNS OF 12
BROWN
26 22`);
    expect(modelos[0].colores[0].renglones).toMatchObject([{ unitalla: "26", cajas: 22, paresPorCaja: 12 }]);
  });
});

describe("la hoja del dueño con tabulador: «RED 20 CTNS\tASSORTMENT» y «BLK\tSOLID SIZE CTNS OF 48» (GT142, 20-oct-2026)", () => {
  const texto = [
    "GT142\t",
    "RED 20 CTNS\tASSORTMENT",
    "23\t10",
    "24\t6",
    "25\t8",
    "26\t13",
    "27\t11",
    "\t",
    "PINK 20 CTNS\tASSORTMENT",
    "23\t8",
    "24\t11",
    "25\t20",
    "26\t3",
    "27\t6",
    "\t",
    "\t",
    "BLK\tSOLID SIZE CTNS OF 48",
    "25\t7",
    "27\t7",
    "30\t11",
  ].join("\n");

  it("dos colores de corrida con 20 cajas y uno de cajas de una talla de 48", () => {
    const r = leerLista(texto);
    expect(r.sinEntender).toEqual([]);
    expect(r.modelos).toHaveLength(1);
    const m = r.modelos[0];
    expect(m.modelo).toBe("GT142");
    expect(m.avisos).toEqual([]);
    expect(m.colores.map((c) => c.color)).toEqual(["RED", "PINK", "BLK"]);
    expect(m.colores[0].renglones).toHaveLength(1);
    expect(m.colores[0].renglones[0]).toMatchObject({
      unitalla: null,
      cajas: 20,
      paresPorCaja: 48,
      corrida: { "23": 10, "24": 6, "25": 8, "26": 13, "27": 11 },
    });
    expect(m.colores[1].renglones[0]).toMatchObject({
      unitalla: null,
      cajas: 20,
      paresPorCaja: 48,
      corrida: { "23": 8, "24": 11, "25": 20, "26": 3, "27": 6 },
    });
    expect(m.colores[2].renglones.map((x) => [x.unitalla, x.cajas, x.paresPorCaja])).toEqual([
      ["25", 7, 48],
      ["27", 7, 48],
      ["30", 11, 48],
    ]);
  });
});

describe("colores NUEVOS y «CTNS 48» sin OF (GT128, 20-oct-2026)", () => {
  const texto = [
    "GT128\t",
    "PINK\tSOLID SIZE CTNS 48",
    "23\t3",
    "24\t5",
    "\t",
    "BROWN\t",
    "23\t3",
    "\t",
    "LT BROWN NEW COLOR\t",
    "23\t3",
    "24\t5",
    "\t",
    "CAMEL NEW COLOR\t",
    "23\t3",
  ].join("\n");

  it("lee la caja de 48 para todos los colores y marca los nuevos", () => {
    const r = leerLista(texto);
    const m = r.modelos[0];
    expect(m.avisos).toEqual([]);
    expect(m.colores.map((c) => [c.color, Boolean(c.nuevo), c.renglones.length])).toEqual([
      ["PINK", false, 2],
      ["BROWN", false, 1],
      ["LT BROWN", true, 2],
      ["CAMEL", true, 1],
    ]);
    expect(m.colores.flatMap((c) => c.renglones.map((x) => x.paresPorCaja))).toEqual([48, 48, 48, 48, 48, 48]);
  });
});
