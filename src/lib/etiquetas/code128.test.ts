import { describe, expect, it } from "vitest";
import { codificar128, svg128 } from "./code128";

describe("Code 128 B", () => {
  it("saca el dígito verificador documentado de 'Wikipedia'", () => {
    // Vector de prueba clásico: el verificador de "Wikipedia" en Code 128 B
    // es 88. Si esto cambia, el escáner del almacén va a rechazar todo.
    expect(codificar128("Wikipedia").verificador).toBe(88);
  });

  it("calcula el verificador a mano igual que la función", () => {
    const texto = "QPLW61342";
    const valores = [...texto].map((c) => c.charCodeAt(0) - 32);
    const suma = valores.reduce((a, v, i) => a + v * (i + 1), 104);
    expect(codificar128(texto).verificador).toBe(suma % 103);
  });

  it("respeta el ancho estructural: 11 módulos por símbolo más 13 del fin", () => {
    const texto = "ABC123";
    const { modulos } = codificar128(texto);
    // inicio + datos + verificador, a 11 módulos cada uno, y el fin con 13.
    const esperado = 11 * (1 + texto.length + 1) + 13;
    expect(modulos).toBe(esperado);
  });

  it("empieza y termina en barra", () => {
    const { anchos } = codificar128("GT104");
    // El patrón de inicio B es 211214 y el de fin 2331112: ambos empiezan en
    // barra, y el fin trae siete elementos para cerrar con barra.
    expect(anchos.length % 2).toBe(1);
  });

  it("no acepta caracteres fuera del subconjunto B", () => {
    expect(() => codificar128("CAFÉ")).toThrow();
    expect(() => codificar128("")).toThrow();
  });

  it("dibuja un SVG con barras", () => {
    const r = svg128("QPLW61342", { alto: 50, modulo: 2 });
    expect(r.svg).toContain("<svg");
    expect(r.svg).toContain("<rect");
    expect(r.alto).toBe(50);
    // margen + módulos*2 + margen
    expect(r.ancho).toBe(10 + codificar128("QPLW61342").modulos * 2 + 10);
  });
});
