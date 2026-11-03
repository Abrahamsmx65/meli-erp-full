import { describe, expect, it } from "vitest";
import { formatoDuracion, textoTiempoPreparacion } from "./tiempo-preparacion";

describe("formatoDuracion", () => {
  it("menos de un minuto", () => {
    expect(formatoDuracion(0)).toBe("< 1 min");
    expect(formatoDuracion(59_000)).toBe("< 1 min");
    expect(formatoDuracion(-5_000)).toBe("< 1 min");
  });
  it("minutos", () => {
    expect(formatoDuracion(60_000)).toBe("1 min");
    expect(formatoDuracion(59 * 60_000 + 59_000)).toBe("59 min");
  });
  it("horas y minutos", () => {
    expect(formatoDuracion(60 * 60_000)).toBe("1 h");
    expect(formatoDuracion((2 * 60 + 15) * 60_000)).toBe("2 h 15 min");
  });
});

describe("textoTiempoPreparacion", () => {
  const primera = "2026-10-09T13:00:00Z";
  const ultima = "2026-10-09T15:15:30Z";
  it("corte completo", () => {
    expect(textoTiempoPreparacion(primera, ultima, true)).toBe("Preparado en 2 h 15 min");
  });
  it("corte a medias", () => {
    expect(textoTiempoPreparacion(primera, "2026-10-09T14:10:00Z", false)).toBe("En preparación · 1 h 10 min");
  });
  it("nada preparado", () => {
    expect(textoTiempoPreparacion(null, null, false)).toBeNull();
    expect(textoTiempoPreparacion(primera, null, true)).toBeNull();
  });
});
