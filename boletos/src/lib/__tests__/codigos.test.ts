import { describe, expect, it } from "vitest";
import { ALFABETO, esCodigoBoleto, extraerCodigo, formatearFolio, generarCodigoBoleto, generarReferencia, urlBoleto } from "../codigos";

describe("códigos", () => {
  it("la referencia es corta, con prefijo y sin caracteres confusos", () => {
    for (let i = 0; i < 200; i++) {
      const r = generarReferencia();
      expect(r).toMatch(/^EV-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
      expect(r).not.toMatch(/[01OIL]/);
    }
  });

  it("el código del boleto tiene 20 caracteres del alfabeto", () => {
    const c = generarCodigoBoleto();
    expect(c).toHaveLength(20);
    expect([...c].every((ch) => ALFABETO.includes(ch))).toBe(true);
    expect(esCodigoBoleto(c)).toBe(true);
  });

  it("dos códigos seguidos no se repiten", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i++) vistos.add(generarCodigoBoleto());
    expect(vistos.size).toBe(1000);
  });

  it("extrae el código de la URL del QR, del código pelón y en minúsculas", () => {
    const c = "ABCDEFGHJKMNPQRSTUVW";
    expect(extraerCodigo(`https://boletos.mx/boleto/${c}`)).toBe(c);
    expect(extraerCodigo(`https://boletos.mx/boleto/${c}?x=1`)).toBe(c);
    expect(extraerCodigo(c)).toBe(c);
    expect(extraerCodigo(`  ${c.toLowerCase()} `)).toBe(c);
  });

  it("rechaza lo que no es un boleto", () => {
    expect(extraerCodigo("")).toBeNull();
    expect(extraerCodigo("https://otro-sitio.com/promo")).toBeNull();
    expect(extraerCodigo("ABC")).toBeNull();
    expect(extraerCodigo("0123456789012345678O")).toBeNull();
  });

  it("arma la URL del boleto sin diagonal doble", () => {
    expect(urlBoleto("ABCDEFGHJKMNPQRSTUVW", "https://boletos.mx/")).toBe(
      "https://boletos.mx/boleto/ABCDEFGHJKMNPQRSTUVW",
    );
  });

  it("formatea el folio a seis dígitos", () => {
    expect(formatearFolio(7)).toBe("#000007");
    expect(formatearFolio(123456)).toBe("#123456");
  });
});
