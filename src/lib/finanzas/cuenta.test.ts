import { describe, expect, it } from "vitest";
import { comisionDeTransferencia, ejercicioDeFecha, rangoEjercicio, resumenCuenta, type MovimientoCuenta } from "./cuenta";

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

describe("cuenta del año", () => {
  it("la cuenta va de mayo a abril", () => {
    expect(ejercicioDeFecha("2026-05-01")).toBe(2026);
    expect(ejercicioDeFecha("2027-04-30")).toBe(2026);
    expect(ejercicioDeFecha("2026-04-30")).toBe(2025);
    expect(rangoEjercicio(2026)).toEqual({ desde: "2026-05-01", hasta: "2027-04-30" });
  });

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

  it("lo que deja Shein se le suma al socio que lo recibe", () => {
    const r = resumenCuenta({
      movimientos: [
        mov({ monto: 1_160_000, comision: 20_000 }),
        mov({ id: 2, monto: 116_000, comision: 2_000, beneficiario: "DEPOSITO SHEIN" }),
        mov({ id: 3, tipo: "shein", monto: 30_000, beneficiario: "RENTA MAYO" }),
        mov({ id: 4, tipo: "shein", monto: 60_000, beneficiario: "MERCANCIA" }),
        mov({ id: 5, tipo: "shein", monto: -10_000, beneficiario: "MERCANCIA DEVUELTA" }),
      ],
      contenedoresCalzado: 0,
      contenedoresFundas: 0,
      comisionAgenteCalzado: 0,
      comisionAgenteFundas: 0,
      gastosEfectivo: 0,
      socios: [
        { id: 1, nombre: "Abraham", porcentaje: 25, recibeShein: true },
        { id: 2, nombre: "Papá", porcentaje: 75 },
      ],
      retiros: [],
    });
    expect(r.shein).toMatchObject({ depositos: 116_000, salidas: 80_000, neto: 36_000 });
    expect(r.ganancia).toBe(1_254_000);
    expect(r.socios[0].parte).toBe(313_500);
    expect(r.socios[0].leToca).toBe(349_500);
    expect(r.socios[1].shein).toBe(0);
  });
});
