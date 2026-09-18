/**
 * Medidas y peso de la caja: salen del packing list de la fábrica, no de una
 * captura a mano («lo tomes del packing list, ahí sí sale», 18-sep-2026).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importarPackingList, medidasDeCeldas } from "./packing-list";

const buf = readFileSync(join(process.cwd(), "fixtures", "packing-list-IN10079.xls"));

describe("medidasDeCeldas", () => {
  it("tres celdas en metros pasan a centímetros", () => {
    expect(medidasDeCeldas([0.66, 0.56, 0.24])).toEqual({ largoCm: 66, anchoCm: 56, altoCm: 24 });
  });
  it("una celda con 66*56*24 o 66x56x24 cm se queda en centímetros", () => {
    expect(medidasDeCeldas(["66*56*24"])).toEqual({ largoCm: 66, anchoCm: 56, altoCm: 24 });
    expect(medidasDeCeldas(["66 x 56 x 24 cm", "", ""])).toEqual({ largoCm: 66, anchoCm: 56, altoCm: 24 });
  });
  it("sin tres números no adivina", () => {
    expect(medidasDeCeldas(["", "", ""])).toBeNull();
    expect(medidasDeCeldas([0.66, "", ""])).toBeNull();
  });
});

describe("packing list real: Means y G.W/ctn", () => {
  it("cada bloque trae sus medidas en cm y su peso bruto por caja", async () => {
    const p = await importarPackingList(buf, { nombre: "x.xls" });
    expect(p.lineas.every((l) => l.medidas && l.pesoKg)).toBe(true);
    expect(p.lineas[0].medidas).toEqual({ largoCm: 66, anchoCm: 56, altoCm: 24 });
    expect(p.lineas[0].pesoKg).toBe(9.5);
    const gt217Tan = p.lineas.find((l) => l.modelo === "GT217" && l.color === "TAN")!;
    expect(gt217Tan.medidas?.largoCm).toBeGreaterThan(0);
    expect(gt217Tan.pesoKg).toBeGreaterThan(0);
  });
});
