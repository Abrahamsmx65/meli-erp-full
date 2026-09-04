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
