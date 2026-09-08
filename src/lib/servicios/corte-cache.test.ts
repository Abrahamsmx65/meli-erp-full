import { describe, expect, it } from "vitest";
import { corteNecesitaRefresco } from "./corte-cache";

const min = (n: number) => n * 60_000;
const h = (n: number) => n * 3_600_000;

describe("corteNecesitaRefresco", () => {
  // "Hoy" fijo: 15 de septiembre de 2026, mediodía UTC.
  const ahora = Date.parse("2026-09-15T12:00:00Z");
  const hoyPeriodo = "2026-09";

  it("mes corriente: fresco dentro de 10 minutos, refresco después", () => {
    expect(corteNecesitaRefresco("2026-09", new Date(ahora - min(5)).toISOString(), true, ahora, hoyPeriodo)).toBe(false);
    expect(corteNecesitaRefresco("2026-09", new Date(ahora - min(11)).toISOString(), true, ahora, hoyPeriodo)).toBe(true);
  });

  it("invalidado siempre se refresca", () => {
    expect(corteNecesitaRefresco("2026-08", new Date(ahora - min(1)).toISOString(), false, ahora, hoyPeriodo)).toBe(true);
  });

  it("mes cerrado calculado con el mes aún abierto: le faltan días, se refresca", () => {
    // Agosto calculado el 31 de agosto por la tarde (antes de la medianoche MX).
    expect(corteNecesitaRefresco("2026-08", "2026-08-31T20:00:00Z", true, ahora, hoyPeriodo)).toBe(true);
  });

  it("mes cerrado calculado ya cerrado: congelado hasta 6 horas", () => {
    expect(corteNecesitaRefresco("2026-08", new Date(ahora - h(2)).toISOString(), true, ahora, hoyPeriodo)).toBe(false);
    expect(corteNecesitaRefresco("2026-08", new Date(ahora - h(7)).toISOString(), true, ahora, hoyPeriodo)).toBe(true);
  });

  it("sin fecha legible se refresca", () => {
    expect(corteNecesitaRefresco("2026-08", "no-es-fecha", true, ahora, hoyPeriodo)).toBe(true);
  });
});
