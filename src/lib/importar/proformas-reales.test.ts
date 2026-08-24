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
