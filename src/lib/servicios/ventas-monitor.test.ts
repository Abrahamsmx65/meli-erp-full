import { describe, expect, it } from "vitest";
import { netoVigente } from "../meli/pagos";
import { netoConfirmadoDeFila } from "./ventas-monitor";

describe("neto confirmado del monitor de ventas", () => {
  it("mantiene cero y negativo cuando una lectura actual los confirmó", () => {
    const cero = netoVigente(170, 0);
    const negativo = netoVigente(170, -15);

    expect(netoConfirmadoDeFila({ neto: cero, neto_confirmado: true })).toBe(0);
    expect(netoConfirmadoDeFila({ neto: negativo, neto_confirmado: true })).toBe(-15);
    expect(cero - 60).toBe(-60);
    expect(negativo - 60).toBe(-75);
  });

  it("no confunde el cero centinela histórico con un saldo confirmado", () => {
    expect(netoConfirmadoDeFila({ neto: 0, neto_confirmado: false })).toBeNull();
    expect(netoConfirmadoDeFila({ neto: 0 })).toBeNull();
    expect(netoConfirmadoDeFila({ neto: null, neto_confirmado: true })).toBeNull();
    expect(netoConfirmadoDeFila({ neto: 170 })).toBe(170);
  });

  it("conserva el contrato al volver a leer la misma fila desde caché", () => {
    const filaGuardada = JSON.parse(JSON.stringify({ neto: 0, neto_confirmado: true }));
    expect(netoConfirmadoDeFila(filaGuardada)).toBe(0);
  });
});