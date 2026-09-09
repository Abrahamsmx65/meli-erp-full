import { describe, expect, it } from "vitest";
import { repartirNetoDelDia } from "./netos";

describe("repartirNetoDelDia", () => {
  it("reparte el neto de cada orden entre sus SKUs por importe, al centavo", () => {
    const r = repartirNetoDelDia([
      { total: 300, neto: 150, renglones: [{ sku: "499-A", importe: 200 }, { sku: "501-B", importe: 100 }] },
      { total: 100, neto: 55.55, renglones: [{ sku: "499-A", importe: 100 }] },
    ]);
    expect(r).not.toBeNull();
    expect(r!.get("499-A")).toBe(155.55);
    expect(r!.get("501-B")).toBe(50);
  });

  it("un día con una orden cobrada sin neto, o sin renglones, no se asienta", () => {
    expect(repartirNetoDelDia([{ total: 100, neto: 0, renglones: [{ sku: "A", importe: 100 }] }])).toBeNull();
    expect(repartirNetoDelDia([{ total: 100, neto: 50, renglones: null }])).toBeNull();
    // Una orden en $0 (muestra, cupón total) no bloquea el día.
    expect(repartirNetoDelDia([{ total: 0, neto: 0, renglones: [{ sku: "A", importe: 0 }] }])).toEqual(new Map());
  });

  it("reparte el saldo actual corregido también en lecturas posteriores", () => {
    expect(repartirNetoDelDia([
      { total: 200, neto: 170, netoActual: 150, renglones: [{ sku: "A", importe: 200 }] },
    ])).toEqual(new Map([["A", 150]]));
    expect(repartirNetoDelDia([
      { total: 200, neto: 170, netoActual: 0, renglones: [{ sku: "A", importe: 200 }] },
    ])).toEqual(new Map([["A", 0]]));
    expect(repartirNetoDelDia([
      { total: 100, neto: 0, netoLeido: true, renglones: [{ sku: "A", importe: 100 }] },
    ])).toEqual(new Map([["A", 0]]));
  });
});
