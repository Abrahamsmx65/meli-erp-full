/**
 * S263-2026 (16-oct-2026, dueño: «faltaron datos en el Excel del S263 y estás
 * tomando mal los datos»): el packing list trae «G.W» (por caja) y «Total
 * G.W»; el lector tomaba «G.W» como total y lo dividía entre las cajas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importarPackingList } from "./packing-list";
import { medidasParaRenglones } from "../servicios/packing-list";

const buf = readFileSync(join(process.cwd(), "fixtures", "packing-list-S263-UETU5682034.xls"));

describe("packing list S263: G.W por caja junto a Total G.W", () => {
  it("el peso es el de la caja (11 kg), no G.W ÷ cajas", async () => {
    const p = await importarPackingList(buf, { nombre: "S263.xls" });
    const gt268 = p.lineas.find((l) => l.modelo === "GT268" && l.cajas === 30)!;
    expect(gt268.pesoKg).toBe(11);
    expect(gt268.medidas).toEqual({ largoCm: 59, anchoCm: 25, altoCm: 57.5 });
    const gt270 = p.lineas.find((l) => l.modelo === "GT270")!;
    expect(gt270.pesoKg).toBe(12);
    expect(p.lineas.every((l) => (l.pesoKg ?? 0) >= 5)).toBe(true);
  });
});

describe("medidasParaRenglones", () => {
  const caja = (largoCm: number, pesoKg: number) => ({ medidas: { largoCm, anchoCm: 25, altoCm: 57.5 }, pesoKg });
  it("un renglón confirmado a mano con otro color toma la caja de su modelo", () => {
    const m = medidasParaRenglones(
      [
        { pedido: "N10127", modelo: "GT270", color: "BLK (NEGRO)", talla: null, ...caja(59, 12) },
        { pedido: "N10127", modelo: "GT270", color: "BROWN(MARRON)", talla: null, ...caja(59, 12) },
      ],
      [{ id: "a", pedido: "IN10127", modelo: "GT270", color: "CAMEL", talla: null }],
    );
    expect(m.get("a")?.pesoKg).toBe(12);
  });
  it("la caja de cada talla es la suya y sin acuerdo no adivina", () => {
    const m = medidasParaRenglones(
      [
        { pedido: "IN10153", modelo: "GT114", color: "BLK", talla: "23", ...caja(57, 14) },
        { pedido: "IN10153", modelo: "GT114", color: "BLK", talla: "28", ...caja(63, 16) },
        { pedido: "IN10153", modelo: "GT999", color: "BLK", talla: null, ...caja(50, 9) },
        { pedido: "IN10153", modelo: "GT999", color: "TAN", talla: null, ...caja(60, 10) },
      ],
      [
        { id: "t28", pedido: "IN10153", modelo: "GT114", color: "BLK", talla: "28" },
        { id: "x", pedido: "IN10153", modelo: "GT999", color: "CAMEL", talla: null },
      ],
    );
    expect(m.get("t28")?.medidas?.largoCm).toBe(63);
    expect(m.has("x")).toBe(false);
  });
});
