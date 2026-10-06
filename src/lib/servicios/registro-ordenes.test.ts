import { describe, expect, it } from "vitest";
import { diaNecesitaRegistro } from "./webhooks";

/**
 * Mayo 2026 de calzado: ventas diarias con ~400 órdenes por día y CERO
 * renglones en ordenes_neto. El registro hacia atrás decide por día.
 */
describe("¿al día le faltan órdenes registradas?", () => {
  it("un día con venta y sin órdenes registradas, sí", () => {
    expect(diaNecesitaRegistro(0, 400)).toBe(true);
  });

  it("un día con sus órdenes registradas, no (con holgura por el sobreconteo de ventas diarias)", () => {
    expect(diaNecesitaRegistro(380, 400)).toBe(false);
    expect(diaNecesitaRegistro(290, 400)).toBe(false);
  });

  it("un día a medias (el tope de 150 lo dejó incompleto), sí", () => {
    expect(diaNecesitaRegistro(150, 400)).toBe(true);
  });

  it("un día sin venta no necesita nada", () => {
    expect(diaNecesitaRegistro(0, 0)).toBe(false);
  });
});
