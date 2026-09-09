import { describe, expect, it } from "vitest";
import { filtroTocaRevision, tocaRevision } from "./devoluciones";

describe("filtro de 'toca revisar' en la consulta", () => {
  it("es la misma regla que tocaRevision: 10 días para la primera, 40 para la segunda", () => {
    const hoy = "2026-09-09";
    expect(filtroTocaRevision(hoy)).toBe(
      "and(revisiones.eq.0,fecha.lte.2026-08-30),and(revisiones.eq.1,fecha.lte.2026-07-31)",
    );
    expect(tocaRevision("2026-08-30", 0, hoy)).toBe(true);
    expect(tocaRevision("2026-08-31", 0, hoy)).toBe(false);
    expect(tocaRevision("2026-07-31", 1, hoy)).toBe(true);
    expect(tocaRevision("2026-08-01", 1, hoy)).toBe(false);
  });
});
