/**
 * Contra la Proforma Invoice REAL de la fábrica (IN10151, formato .xls de 2011).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colorDeProforma, importarProforma, tallaDeEncabezado } from "./proforma";

const buf = readFileSync(join(process.cwd(), "fixtures", "PEDIDO_IN10151.xls"));

describe("piezas sueltas del lector", () => {
  it("saca el color en inglés de los tres idiomas", () => {
    expect(colorDeProforma("BLK 黑 NEGRO")).toBe("BLK");
    expect(colorDeProforma("NAVY 深藍 AZUL MARINO")).toBe("NAVY");
    expect(colorDeProforma("GREY 灰GRIS")).toBe("GREY");
    expect(colorDeProforma("BROWN")).toBe("BROWN");
  });

  it("lee la talla mexicana del encabezado", () => {
    expect(tallaDeEncabezado("25MX=39")).toBe("25");
    expect(tallaDeEncabezado("30MX=45")).toBe("30");
    expect(tallaDeEncabezado("26")).toBe("26");
    expect(tallaDeEncabezado("259.74mm")).toBeNull();
    expect(tallaDeEncabezado("PER CTN")).toBeNull();
  });
});

describe("Proforma Invoice real (.xls)", () => {
  it("lee el número de pedido", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    expect(p.pedido).toBe("IN10151");
  });

  it("detecta las tallas de la corrida", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    expect(p.tallasDetectadas).toEqual(["25", "26", "27", "28", "29", "30"]);
  });

  it("lee los 6 renglones con sus modelos y colores", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    expect(p.lineas).toHaveLength(6);
    expect(p.lineas.map((l) => l.modelo)).toEqual([
      "GT104-1", "GT104-2", "GT104-3", "GT104-4", "GT104-6", "GT104-7",
    ]);
    expect(p.lineas.map((l) => l.color)).toEqual([
      "BLK", "GREY", "RED", "NAVY", "BROWN", "BLK",
    ]);
  });

  it("la corrida de cada renglón suma sus pares por caja", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    for (const l of p.lineas) {
      const suma = Object.values(l.tallas).reduce((a, b) => a + b, 0);
      expect(suma).toBe(l.paresPorCaja);
      expect(l.cuadra).toBe(true);
    }
  });

  it("saca la corrida correcta del primer renglón", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    const gt1041 = p.lineas.find((l) => l.modelo === "GT104-1")!;
    expect(gt1041.tallas).toEqual({ "25": 3, "26": 6, "27": 15, "28": 12, "29": 12 });
    expect(gt1041.paresPorCaja).toBe(48);
    expect(gt1041.cajas).toBe(70);
    expect(gt1041.pares).toBe(3360);
  });

  it("los totales cuadran con el pie del archivo", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    expect(p.totales.cajas).toBe(380);
    expect(p.totales.pares).toBe(18240);
  });

  it("cajas × pares por caja = pares, en cada renglón", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    for (const l of p.lineas) {
      expect(l.cajas * l.paresPorCaja).toBe(l.pares);
    }
  });
});
