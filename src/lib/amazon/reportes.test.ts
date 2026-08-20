import { describe, expect, it } from "vitest";
import { msDeFechaReporte } from "./reportes";

describe("msDeFechaReporte", () => {
  it("lee día.mes.año como lo manda Amazon México", () => {
    // "01.05.2026" es 1 de MAYO, no 5 de enero.
    const ms = msDeFechaReporte("01.05.2026 11:22:33 UTC");
    expect(new Date(ms).toISOString()).toBe("2026-05-01T11:22:33.000Z");
  });

  it("no pierde los días mayores a 12", () => {
    // Date.parse daba NaN con estos y la fila se descartaba en silencio.
    const ms = msDeFechaReporte("15.08.2026 03:00:00 UTC");
    expect(Number.isFinite(ms)).toBe(true);
    expect(new Date(ms).toISOString().slice(0, 10)).toBe("2026-08-15");
  });

  it("acepta la fecha sin hora", () => {
    const ms = msDeFechaReporte("02.06.2026");
    expect(new Date(ms).toISOString().slice(0, 10)).toBe("2026-06-02");
  });

  it("deja pasar el formato ISO tal cual", () => {
    const ms = msDeFechaReporte("2026-05-01T11:22:33Z");
    expect(new Date(ms).toISOString()).toBe("2026-05-01T11:22:33.000Z");
  });

  it("regresa NaN con basura, igual que Date.parse", () => {
    expect(Number.isFinite(msDeFechaReporte(""))).toBe(false);
    expect(Number.isFinite(msDeFechaReporte("no-es-fecha"))).toBe(false);
  });
});
