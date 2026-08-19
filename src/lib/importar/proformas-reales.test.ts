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
