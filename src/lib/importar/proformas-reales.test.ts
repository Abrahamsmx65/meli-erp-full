import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importarProforma } from "./proforma";

const fixture = (nombre: string) =>
  readFileSync(join(__dirname, "../../../fixtures", nombre));

/**
 * Los cuatro formatos reales de proforma que mandan las fábricas. Cada uno
 * rompió al lector alguna vez; estos candados garantizan que ninguno vuelva.
 */
describe("proformas reales de fábrica", () => {
  it("CHAOZHOU: pedido en 'INVOICE NO.: (…)' y columna QUANTITY", async () => {
    const p = await importarProforma(fixture("proforma-chaozhou-IN10157.xls"), {
      nombre: "IN10157_GT144.xls",
    });
    expect(p.pedido).toBe("IN10157");
    expect(p.lineas).toHaveLength(1);

    const l = p.lineas[0];
    expect(l.modelo).toBe("GT144");
    expect(l.color).toBe("BLK");
    expect(l.tallas).toEqual({ "23": 5, "24": 10, "25": 11, "26": 12, "27": 10 });
    expect(l.paresPorCaja).toBe(48);
    expect(l.cajas).toBe(20);
    expect(l.pares).toBe(960);
    expect(p.totales.cajas).toBe(20);
    expect(p.totales.pares).toBe(960);
  });

  it("JINJIANG: la corrida sigue en la fila de abajo sin modelo ni color", async () => {
    const p = await importarProforma(fixture("proforma-jinjiang-IN10160.xls"), {
      nombre: "IN10160_GT161_HS.xls",
    });
    expect(p.pedido).toBe("IN10160");
    expect(p.lineas).toHaveLength(4);

    const camel = p.lineas[0];
    expect(camel.modelo).toBe("GT161");
    expect(camel.color).toBe("CAMEL (CAMEL)");
    // 7+11+14+8 de la primera fila MÁS 4+4 de la continuación = 48.
    expect(camel.tallas).toEqual({ "23": 7, "24": 11, "25": 14, "26": 8, "27": 4, "28": 4 });
    expect(camel.paresPorCaja).toBe(48);
    expect(camel.cuadra).toBe(true);
    expect(camel.cajas).toBe(20);
    expect(camel.pares).toBe(960); // 800 + 160 de la continuación

    // Los colores siguientes heredan el modelo.
    expect(p.lineas.every((l) => l.modelo === "GT161")).toBe(true);
    expect(p.totales.cajas).toBe(140);
    expect(p.totales.pares).toBe(6720);
  });

  it("JINJIANG unitalla: el número bajo la talla son CAJAS, no pares", async () => {
    const p = await importarProforma(fixture("proforma-jinjiang-unitalla-IN10159.xls"), {
      nombre: "GT10159_GT134_HS_Solid.xls",
    });
    expect(p.pedido).toBe("IN10159");
    expect(p.lineas).toHaveLength(6);
    expect(p.lineas.every((l) => l.modelo === "GT134" && l.unitalla !== null)).toBe(true);

    const t24 = p.lineas.find((l) => l.unitalla === "24");
    expect(t24?.cajas).toBe(18);
    expect(t24?.pares).toBe(864);
    expect(t24?.tallas).toEqual({ "24": 48 });

    expect(p.totales.cajas).toBe(92);
    expect(p.totales.pares).toBe(4416);
  });

  it("MINGTA: el formato clásico sigue leyéndose igual", async () => {
    const p = await importarProforma(fixture("proforma-mingta-IN10152.xls"), {
      nombre: "IN10152_GT118_119.xls",
    });
    expect(p.pedido).toBe("IN10152");
    expect(p.lineas).toHaveLength(2);
    expect(p.lineas[0].modelo).toBe("GT118");
    expect(p.lineas[0].tallas).toEqual({ "25": 3, "26": 8, "27": 15, "28": 9, "29": 11, "30": 2 });
    expect(p.lineas[1].modelo).toBe("GT119");
    expect(p.totales.cajas).toBe(65);
    expect(p.totales.pares).toBe(3120);
  });
});

describe("proforma BAIKE (tallas juntas en una celda)", () => {
  it("lee pedido, corridas y totales del IN10105", async () => {
    const p = await importarProforma(fixture("proforma-baike-IN10105.xls"), {
      nombre: "USD_PI_for_boot_orderBAIKE2026.6.25_IN10105.xls",
    });
    // El pedido viene escondido como "S/C NO.:BK26-0527 (IN10105)".
    expect(p.pedido).toBe("IN10105");
    expect(p.lineas).toHaveLength(15);

    const negro = p.lineas[0];
    expect(negro.modelo).toBe("GT251");
    expect(negro.color).toBe("BLACK");
    expect(negro.tallas).toEqual({ "23": 3, "24": 8, "25": 8, "26": 5 });
    expect(negro.paresPorCaja).toBe(24);
    expect(negro.cajas).toBe(20);
    expect(negro.pares).toBe(480);
    expect(negro.cuadra).toBe(true);
    expect(negro.precioUnitario).toBe(7.1);

    // El segundo color hereda el modelo.
    expect(p.lineas[1].modelo).toBe("GT251");
    expect(p.lineas[1].color).toBe("BROWN");

    // Todas las líneas cuadran (corrida × cajas = pares).
    expect(p.lineas.every((l) => l.cuadra)).toBe(true);
    expect(p.totales.cajas).toBe(297);
    expect(p.totales.pares).toBe(7128);
    expect(p.totales.importe).toBe(60564);
  });
});

describe("re-encabezado de tallas a mitad de hoja (IN10079 UGG)", () => {
  it("las damas van 23-27 y, tras el segundo encabezado, los caballeros 26-30", async () => {
    const p = await importarProforma(fixture("proforma-ugg-IN10079.xls"), {
      nombre: "IN10079 UGG revised on May 19.xls",
    });
    expect(p.pedido).toBe("IN10079");
    expect(p.tallasDetectadas).toEqual(["23", "24", "25", "26", "27", "28", "29", "30"]);

    // Antes del re-encabezado: corrida de damas.
    const damas = p.lineas.find((l) => l.modelo === "GT150" && l.color === "BLACK")!;
    expect(damas.tallas).toEqual({ "23": 4, "24": 7, "25": 7, "26": 4, "27": 2 });

    // Después del re-encabezado ("26MX 265MM…"): las MISMAS columnas ahora
    // son tallas de caballero. Antes salían como 23-27 y el pedido quedaba
    // con tallas que no existen en esos modelos.
    for (const modelo of ["GT227", "GT223", "GT224", "GT225"]) {
      for (const l of p.lineas.filter((x) => x.modelo === modelo)) {
        expect(l.tallas).toEqual({ "26": 2, "27": 6, "28": 7, "29": 6, "30": 3 });
        expect(l.cuadra).toBe(true);
      }
    }

    // Los totales del archivo, exactos.
    expect(p.totales.cajas).toBe(4070);
    expect(p.totales.pares).toBe(97680);
    expect(p.lineas).toHaveLength(62);
    expect(p.avisos).toEqual([]);
  });
});

describe("CHAOZHOU cajas completas (IN10148): sin Item No. y tallas = cajas", () => {
  it("saca el modelo del nombre del archivo y parte el renglón en unitallas", async () => {
    const p = await importarProforma(fixture("proforma-chaozhou-cajascompletas-IN10148.xls"), {
      nombre: "IN10148_GT114.xls",
    });
    expect(p.pedido).toBe("IN10148");
    // El renglón venía sin modelo (celda Item No. vacía) y con las CAJAS por
    // talla bajo cada columna (10+10+15+20 = 55 = CTNS): antes el lector lo
    // descartaba y la proforma entera salía "sin renglones".
    expect(p.lineas).toHaveLength(4);
    expect(p.lineas.every((l) => l.modelo === "GT114" && l.color === "BLK")).toBe(true);
    expect(p.lineas.every((l) => l.paresPorCaja === 48 && l.cuadra)).toBe(true);
    expect(p.lineas.map((l) => [l.unitalla, l.cajas, l.pares])).toEqual([
      ["26", 10, 480],
      ["27", 10, 480],
      ["28", 15, 720],
      ["29", 20, 960],
    ]);
    expect(p.totales.cajas).toBe(55);
    expect(p.totales.pares).toBe(2640);
    expect(p.avisos.some((a) => a.includes("nombre del archivo"))).toBe(true);
    expect(p.avisos.some((a) => a.includes("CAJAS por talla"))).toBe(true);
  });
});

describe("FUZHOU (IN10163): 'Article no', tallas 'Mex 23 36/37 (24cm)' y totales con TOTAL", () => {
  it("lee las 7 corridas del MY2307 con sus cajas y pares", async () => {
    const p = await importarProforma(fixture("proforma-fuzhou-IN10163.xls"), {
      nombre: "IN10163_MY2307.xls",
    });
    expect(p.pedido).toBe("IN10163");
    expect(p.proveedor).toMatch(/Fuzhou KC Trading/);
    expect(p.tallasDetectadas).toEqual(["23", "24", "25", "26", "27", "28", "29", "30"]);
    expect(p.lineas).toHaveLength(7);
    expect(p.lineas.map((l) => `${l.modelo} ${l.color}`)).toEqual([
      "MY2307 NAVY",
      "MY2307 CHOCOLATE BROWN",
      "MY2307 CREAM",
      "MY2307 GREY",
      "MY2307 LILAC",
      "MY2307 MILITARY GREEN",
      "MY2307 GREY BLUE",
    ]);

    const navy = p.lineas[0];
    expect(navy.tallas).toEqual({ "23": 2, "24": 4, "26": 2, "27": 7, "28": 9, "29": 8, "30": 16 });
    expect(navy.paresPorCaja).toBe(48);
    expect(navy.cajas).toBe(30);
    expect(navy.pares).toBe(1440);
    expect(navy.cuadra).toBe(true);
    expect(navy.precioUnitario).toBe(1.03);

    expect(p.totales.cajas).toBe(235);
    expect(p.totales.pares).toBe(11280);
    expect(p.lineas.every((l) => l.cuadra && !l.unitalla)).toBe(true);
  });
});

describe("IN10172 (JIAXING, GT148): cajas de UNA talla, una fila por talla", () => {
  const buf = readFileSync(join(process.cwd(), "fixtures", "proforma-IN10172-GT148.xls"));

  it("cada fila es una línea unitalla con sus propias cajas; el total cuadra con el TTL", async () => {
    const p = await importarProforma(buf, { nombre: "IN10172_GT148.xls" });
    expect(p.pedido).toBe("IN10172");
    expect(p.lineas).toHaveLength(20);
    expect(p.lineas.every((l) => l.unitalla && l.paresPorCaja === 48 && l.cuadra)).toBe(true);
    expect(p.totales.cajas).toBe(379);
    expect(p.totales.pares).toBe(18192);
    expect(p.avisos).toEqual([]);

    const negro23 = p.lineas[0];
    expect(negro23).toMatchObject({ modelo: "GT148", color: "BLACK", unitalla: "23", cajas: 20, pares: 960, tallas: { "23": 48 } });
    const negro24 = p.lineas[1];
    expect(negro24).toMatchObject({ color: "BLACK", unitalla: "24", cajas: 35, pares: 1680 });
    // Los colores se heredan a las filas de abajo.
    expect(p.lineas.map((l) => l.color)).toEqual([
      ...Array(5).fill("BLACK"), ...Array(5).fill("M BROWN"), ...Array(5).fill("M BROWN-RED"), ...Array(5).fill("CREAM"),
    ]);
  });
});
