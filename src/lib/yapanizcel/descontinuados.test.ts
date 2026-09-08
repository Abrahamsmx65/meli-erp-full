import { describe, expect, it } from "vitest";
import { decidirDescontinuados } from "./descontinuados";

const HOY = "2026-09-03";

describe("decidirDescontinuados", () => {
  it("sin 180 días de historial no descontinúa a nadie", () => {
    const r = decidirDescontinuados([{ sku: "A", publicadoEn: null }], new Map(), "2026-06-04", HOY);
    expect(r.activo).toBe(false);
    expect(r.skus.size).toBe(0);
  });

  it("con historial completo, el que no vendió en 180 días se descontinúa", () => {
    const r = decidirDescontinuados(
      [
        { sku: "MUERTO", publicadoEn: "2025-01-01T00:00:00Z" },
        { sku: "VIEJO-QUE-VENDE", publicadoEn: "2025-01-01T00:00:00Z" },
        { sku: "NUEVO", publicadoEn: "2026-08-01T00:00:00Z" },
        { sku: "SIN-FECHA", publicadoEn: null },
      ],
      new Map([["VIEJO-QUE-VENDE", "2026-08-30"]]),
      "2026-03-01",
      HOY,
    );
    expect(r.activo).toBe(true);
    // SIN-FECHA no se juzga: puede ser nueva.
    expect([...r.skus].sort()).toEqual(["MUERTO"]);
  });

  it("los últimos 180 días son [hoy − 179, hoy]: una venta en el primer día cuenta", () => {
    // HOY = 3 sep → la ventana arranca el 8 de marzo.
    const vieja = { sku: "A", publicadoEn: "2025-01-01T00:00:00Z" };
    const r = decidirDescontinuados([vieja], new Map([["A", "2026-03-08"]]), "2026-01-01", HOY);
    expect(r.skus.has("A")).toBe(false);
    const r2 = decidirDescontinuados([vieja], new Map([["A", "2026-03-07"]]), "2026-01-01", HOY);
    expect(r2.skus.has("A")).toBe(true);
  });

  it("se enciende en cuanto el historial cubre exactamente el horizonte", () => {
    // La sincronización guarda desde hoy − 179: eso YA es el horizonte completo.
    const r = decidirDescontinuados([{ sku: "A", publicadoEn: null }], new Map(), "2026-03-08", HOY);
    expect(r.activo).toBe(true);
    const r2 = decidirDescontinuados([{ sku: "A", publicadoEn: null }], new Map(), "2026-03-09", HOY);
    expect(r2.activo).toBe(false);
  });
});

describe("decidirDescontinuados por diseño", () => {
  const vieja = "2025-01-01T00:00:00Z";
  const nueva = "2026-08-01T00:00:00Z";

  it("un diseño viejo donde NADIE vendió se retira completo, con sus variantes nuevas y sin fecha", () => {
    const r = decidirDescontinuados(
      [
        { sku: "654-I13", publicadoEn: vieja },
        { sku: "654-I14", publicadoEn: vieja },
        { sku: "654-I15PRO-BLK", publicadoEn: nueva },
        { sku: "654-A54", publicadoEn: null },
      ],
      new Map(),
      "2026-03-01",
      HOY,
    );
    expect([...r.disenos]).toEqual(["654"]);
    expect([...r.skus].sort()).toEqual(["654-A54", "654-I13", "654-I14", "654-I15PRO-BLK"]);
  });

  it("si alguna variante vendió, solo se van las variantes muertas y el diseño sigue", () => {
    const r = decidirDescontinuados(
      [
        { sku: "499-I13", publicadoEn: vieja },
        { sku: "499-I14", publicadoEn: vieja },
        { sku: "499-I15PRO", publicadoEn: nueva },
      ],
      new Map([["499-I14", "2026-08-30"]]),
      "2026-03-01",
      HOY,
    );
    expect(r.disenos.size).toBe(0);
    expect([...r.skus]).toEqual(["499-I13"]);
  });

  it("un diseño con puras variantes nuevas o sin fecha es un lanzamiento: no se retira", () => {
    const r = decidirDescontinuados(
      [
        { sku: "701-I15", publicadoEn: nueva },
        { sku: "701-I16", publicadoEn: null },
      ],
      new Map(),
      "2026-03-01",
      HOY,
    );
    expect(r.disenos.size).toBe(0);
    expect(r.skus.size).toBe(0);
  });

  it("el calzado de la cuenta no entra en la regla por diseño", () => {
    const r = decidirDescontinuados(
      [
        { sku: "GT114-BLK-25", publicadoEn: vieja },
        { sku: "GT114-BLK-26", publicadoEn: nueva },
      ],
      new Map(),
      "2026-03-01",
      HOY,
    );
    expect(r.disenos.size).toBe(0);
    // La variante vieja sí, por la regla de variante.
    expect([...r.skus]).toEqual(["GT114-BLK-25"]);
  });
});
