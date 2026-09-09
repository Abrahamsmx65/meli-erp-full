import { describe, expect, it } from "vitest";
import { prepararIntentoGasto } from "./gastos-idempotencia";

describe("prepararIntentoGasto", () => {
  it("reutiliza la clave cuando una respuesta se pierde y se reintenta exactamente el mismo cuerpo", () => {
    const claves = ["intento-1", "intento-2"];
    const generar = () => claves.shift()!;
    const cuerpo = JSON.stringify({ fecha: "2026-09-01", concepto: "Nómina", monto: 12500 });

    const respuestaPerdida = prepararIntentoGasto(null, cuerpo, generar);
    const reintento = prepararIntentoGasto(respuestaPerdida, cuerpo, generar);

    expect(reintento).toBe(respuestaPerdida);
    expect(reintento.clave).toBe("intento-1");
  });

  it("abandona la clave pendiente cuando el cuerpo cambia antes del reintento", () => {
    const original = prepararIntentoGasto(null, '{"concepto":"Nómina"}', () => "intento-1");
    const corregido = prepararIntentoGasto(original, '{"concepto":"Nómina corregida"}', () => "intento-2");

    expect(corregido.clave).toBe("intento-2");
  });
});