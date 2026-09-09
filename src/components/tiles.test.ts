import { describe, expect, it } from "vitest";
import { tamanoDeCifra } from "./tiles";

/**
 * La regla real: en la rejilla más apretada de la app (ocho columnas dentro
 * de 1400 px) la tarjeta mide ~158 px y el texto tiene ~126 px de ancho útil.
 * Con dígitos de ancho fijo, cada carácter come ~0.55 del tamaño de letra, así
 * que la cifra cabe si `caracteres × 0.55 × tamaño ≤ 126`.
 */
const ANCHO_TARJETA = 158.5;
const ANCHO_UTIL = 126.5;

/** Los px que de verdad se pintan en esa rejilla: el término de cqi, topado. */
function pxEnRejillaApretada(texto: string): number {
  const m = tamanoDeCifra(texto).match(
    /^clamp\((\d+(?:\.\d+)?)rem, (\d+(?:\.\d+)?)cqi, (\d+(?:\.\d+)?)rem\)$/,
  );
  expect(m, `formato inesperado para «${texto}»`).not.toBeNull();
  const [minRem, cqi, maxRem] = m!.slice(1).map(Number);
  const porCqi = (cqi / 100) * ANCHO_TARJETA;
  return Math.min(Math.max(porCqi, minRem * 16), maxRem * 16);
}

const cabe = (texto: string) => texto.length * 0.55 * pxEnRejillaApretada(texto) <= ANCHO_UTIL;

describe("tamanoDeCifra", () => {
  it("cifras cortas conservan el tamaño grande de siempre", () => {
    // 28 px es el tamaño histórico; en tarjetas anchas no debe encogerse.
    expect(tamanoDeCifra("1,234")).toContain("1.75rem");
    expect(tamanoDeCifra("$98,340")).toContain("1.75rem");
  });

  it("las cifras que antes se salían ahora caben en la rejilla de ocho", () => {
    // Casos REALES de la base: la venta de julio y la de agosto.
    for (const texto of ["$5,301,760", "$6,945,520", "$1,671,664", "$12,345,678"]) {
      expect(cabe(texto), `no cabe: ${texto} a ${pxEnRejillaApretada(texto)}px`).toBe(true);
    }
  });

  it("nunca baja de un tamaño legible", () => {
    for (const texto of ["$1,234,567,890.00", "—".repeat(20)]) {
      expect(pxEnRejillaApretada(texto)).toBeGreaterThanOrEqual(12);
    }
  });

  it("el tamaño nunca crece cuando la cifra se alarga", () => {
    const largos = ["1", "1,234", "$98,340", "$123,456", "$1,234,567", "$12,345,678", "$123,456,789"];
    const px = largos.map(pxEnRejillaApretada);
    for (let i = 1; i < px.length; i++) expect(px[i]).toBeLessThanOrEqual(px[i - 1]);
  });
});
