/**
 * Los sheets del dueño tal como estaban el 16-oct-2026. Los totales se
 * comparan contra la pestaña TOTAL del propio sheet: si la lectura cuadra con
 * lo que el dueño ve, está bien.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { categoriaDeGasto, fecha, leerCuentas, leerNumeros, libroDeXlsx, type CuentasSheet, type NumerosSheet } from "./sheets";

const abrir = (n: string) => libroDeXlsx(readFileSync(join(process.cwd(), "fixtures", n)));
let c: CuentasSheet;
let numeros: NumerosSheet[];
beforeAll(async () => {
  c = leerCuentas(await abrir("sheet-cuentas-2026-10-16.xlsx"));
  numeros = leerNumeros(await abrir("sheet-numeros-2026-10-16.xlsx")).modelos;
});
const suma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe("Cuentas YAPANIZCEL", () => {
  it("transferencias y comisión cuadran con TOTAL", () => {
    const t = c.movimientos.filter((m) => m.tipo === "transferencia");
    expect(suma(t.map((m) => m.monto))).toBe(44154035.64);
    expect(Math.abs(suma(t.map((m) => m.comision)) - 832828.2)).toBeLessThan(0.1);
    expect(t.filter((m) => m.fecha == null)).toHaveLength(0); // «05-JUNIO-2026» también es fecha
  });
  it("GASTOS MEX: lo positivo es gasto y el negativo (CREDI PAGO) ingreso; neto = TOTAL", () => {
    const ingreso = c.movimientos.filter((m) => m.tipo === "ingreso");
    expect(ingreso).toEqual([expect.objectContaining({ beneficiario: "CREDI PAGO", monto: 172089 })]);
    expect(suma(c.gastos.map((g) => g.monto)) - 172089).toBe(410966);
    expect(c.gastos.every((g) => g.categoria !== "Otros")).toBe(true);
  });
  it("SUELDOS: retiros de cada socio = TOTAL, con las fechas escritas como texto", () => {
    expect(suma(c.retiros.filter((r) => r.socio === "ABRAHAM").map((r) => r.monto))).toBe(3692260);
    expect(suma(c.retiros.filter((r) => r.socio === "DANIEL").map((r) => r.monto))).toBe(3181615);
  });
  it("Shein: solo las salidas de la derecha", () => {
    const s = c.movimientos.filter((m) => m.tipo === "shein");
    expect(s[0]).toMatchObject({ fecha: "2026-05-05", monto: 24360, beneficiario: "RENTA MAYO" });
    expect(s.some((m) => m.monto < 0)).toBe(true); // MERCANCIA DEVUELTA
  });
  it("costeo: T.C. del flete = pesos ÷ dólares de su renglón; renglones vacíos fuera", () => {
    const s239 = c.contenedores.find((k) => k.contenedor === "S239")!;
    expect(s239).toMatchObject({ costoUsd: 56567.56, fleteUsd: 3080, tcFabrica: 17.327, tcFlete: 17.408, aduana: 320050, entregado: true });
    expect(c.contenedores.find((k) => k.contenedor === "P605")).toMatchObject({ negocio: "fundas", tcFlete: 17.25 });
    expect(c.contenedores.find((k) => k.contenedor === "S273")).toBeUndefined();
    expect(c.leidas.has("costeo")).toBe(true);
  });
});

describe("Números", () => {
  const m = (x: string) => numeros.find((n) => n.modelo === x)!;
  it("factores de siempre quedan vacíos; lo demás se toma del sheet", () => {
    expect(m("G650")).toMatchObject({ envioMeli: 44, precioRelampago: 298.99, pvNormal: null, pvpDeal: null, envioAmazon: 72 });
    expect(m("GT114").pvNormal).toBeCloseTo(219.024, 3); // =I*1.053
    expect(m("GT114").tiktokComision).toBe(0.3);
    expect(m("GT148")).toMatchObject({ precioRelampago: 199.99, pvNormal: 211 });
  });
  it("retención de 10.5 % solo donde la fórmula la trae", () => {
    expect(m("MY2304").retencion).toBe(true);
    expect(m("GT148").retencion).toBe(false);
  });
});

describe("piezas", () => {
  it("fecha acepta ISO y texto en español", () => {
    expect(fecha({ v: "2026-05-04" })).toBe("2026-05-04");
    expect(fecha({ v: "03-AGO-2026" })).toBe("2026-08-03");
    expect(fecha({ v: "13-07-2026" })).toBe("2026-07-13");
    expect(fecha({ v: "AMEX" })).toBeNull();
  });
  it("categoría: la que el ERP ya tenía manda", () => {
    expect(categoriaDeGasto("QUINCENA ZURY")).toBe("Nómina");
    expect(categoriaDeGasto("AI", new Map([["AI", "Software"]]))).toBe("Software");
  });
});
