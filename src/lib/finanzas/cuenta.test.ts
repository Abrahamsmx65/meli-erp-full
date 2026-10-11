import { describe, expect, it } from "vitest";
import { comisionDeTransferencia, resumenCuenta, type MovimientoCuenta } from "./cuenta";

const mov = (m: Partial<MovimientoCuenta>): MovimientoCuenta => ({
  id: 1,
  fecha: "2026-05-14",
  tipo: "transferencia",
  monto: 0,
  beneficiario: "RAFA.INDUSTHER",
  referencia: null,
  comision: 0,
  notas: null,
  ...m,
});

describe("cuenta con Rafa", () => {
  it("la comisión de Rafa es 2/116 (la fórmula del sheet: B − B/116 × 114)", () => {
    expect(comisionDeTransferencia(1_200_000)).toBeCloseTo(1_200_000 - (1_200_000 / 116) * 114, 2);
    expect(comisionDeTransferencia(-4_150_000)).toBe(0);
  });

  it("replica la pestaña TOTAL: recibido − contenedores − agente − gastos = ganancia, y la reparte 25/25/50", () => {
    const r = resumenCuenta({
      movimientos: [
        mov({ monto: 1_160_000, comision: 20_000 }),
        mov({ id: 2, tipo: "ingreso", monto: 100_000, beneficiario: "CREDI PAGO" }),
        mov({ id: 3, tipo: "gasto", monto: 50_000, beneficiario: "RENTA OFICINA", fecha: null }),
      ],
      contenedoresCalzado: 600_000,
      contenedoresFundas: 100_000,
      comisionAgenteCalzado: 9_000,
      comisionAgenteFundas: 1_000,
      gastosEfectivo: 200_000,
      socios: [
        { id: 1, nombre: "Abraham", porcentaje: 25 },
        { id: 2, nombre: "Daniel", porcentaje: 25 },
        { id: 3, nombre: "Papá", porcentaje: 50 },
      ],
      retiros: [
        { id: 1, socioId: 1, fecha: null, concepto: "TSEDAKA", monto: 30_000 },
        { id: 2, socioId: 1, fecha: null, concepto: "VIDEOS", monto: -5_000 },
        { id: 3, socioId: 2, fecha: null, concepto: "EFECTIVO", monto: 10_000 },
      ],
    });
    expect(r.recibido).toBe(1_140_000);
    // gastos en efectivo 200 mil − 100 mil que entraron sin comisión
    expect(r.totalSalidas).toBe(600_000 + 100_000 + 9_000 + 1_000 + 100_000 + 50_000);
    expect(r.ganancia).toBe(1_140_000 - 860_000);
    const [ab, da, pa] = r.socios;
    expect(ab.leToca).toBe(70_000);
    expect(ab.retirado).toBe(25_000);
    expect(ab.tsedaka).toBe(30_000);
    expect(ab.sobra).toBe(45_000);
    expect(da.sobra).toBe(60_000);
    expect(pa.leToca).toBe(140_000);
  });
});
