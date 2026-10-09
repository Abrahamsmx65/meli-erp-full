import { describe, expect, it } from "vitest";
import { siguienteEspera } from "./datos-fiscales";

describe("espera entre preguntas de Datos fiscales", () => {
  it("vuelve a 6 s cuando el avance se movió", () => {
    expect(siguienteEspera(30_000, true)).toBe(6_000);
  });

  it("sin cambios se espacia 1.5× hasta 30 s", () => {
    expect(siguienteEspera(6_000, false)).toBe(9_000);
    expect(siguienteEspera(9_000, false)).toBe(13_500);
    expect(siguienteEspera(27_000, false)).toBe(30_000);
    expect(siguienteEspera(30_000, false)).toBe(30_000);
  });
});
