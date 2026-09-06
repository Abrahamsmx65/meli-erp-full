import { describe, expect, it } from "vitest";
import {
  PARAMETROS_COSTOS_OMISION,
  calcularCosto,
  filasDesdeHoja,
  gananciaAmazon,
  gananciaTiktok,
  leerParametrosCostos,
  type CapturaCosto,
} from "./costos-producto";

const P = PARAMETROS_COSTOS_OMISION;

const captura = (x: Partial<CapturaCosto> & { modelo: string }): CapturaCosto => ({
  costoUsd: null,
  tdc: null,
  cbmPar: null,
  envioMeli: null,
  precioRelampago: null,
  precioNormal: null,
  envioAmazon: null,
  precioAmazon: null,
  afiliadoTiktok: null,
  precioTiktok: null,
  notas: "",
  ...x,
});

/**
 * Las fórmulas de la hoja Numeros, tal cual, con sus constantes redondeadas
 * (0.2405205 = 15 % + 10.5 %/1.16; 0.2205205 = 5 % + 8 % + 10.5 %/1.16).
 * El motor debe reproducirlas al centavo.
 */
function hoja(usd: number, tdc: number, cbm: number, envio: number, precio: number, envioAmz: number, afiliadoExtra = 0.2205205) {
  const F = 4920 * cbm;
  const G = usd * tdc + F;
  const J = precio - precio * 0.15 - envio - (precio / 1.16) * 0.105 - G;
  const N = G + J;
  const Pv = (N + envioAmz) / (1 - 0.2405205);
  const R = (N + 6) / (1 - afiliadoExtra);
  return { F, G, J, K: J / G, N, P: Pv, Q: Pv * 1.12, R, S: R * 1.06 };
}

describe("calcularCosto reproduce la hoja Numeros", () => {
  it("MY2307 (afiliados de TikTok al 18 %)", () => {
    const esperado = hoja(1.1423, 17.5, 0.00310960144, 38, 119.99, 28.1, 0.3205205);
    const c = calcularCosto(
      captura({
        modelo: "MY2307",
        costoUsd: 1.1423,
        tdc: 17.5,
        cbmPar: 0.00310960144,
        envioMeli: 38,
        precioRelampago: 119.99,
        precioNormal: 119.99,
        envioAmazon: 28.1,
        afiliadoTiktok: 0.18,
      }),
      P,
    );
    expect(c.aduana).toBeCloseTo(esperado.F, 4);
    expect(c.costoTotal).toBeCloseTo(esperado.G, 4);
    expect(c.relampago?.ganancia).toBeCloseTo(esperado.J, 2);
    expect(c.relampago?.porcentaje).toBeCloseTo(esperado.K, 3);
    expect(c.normal?.ganancia).toBeCloseTo(esperado.J, 2);
    expect(c.recibirAmazon).toBeCloseTo(esperado.N, 2);
    expect(c.pvpAmazon).toBeCloseTo(esperado.P, 1);
    expect(c.pvpAmazonDeal).toBeCloseTo(esperado.Q, 1);
    expect(c.precioTiktok).toBeCloseTo(esperado.R, 1);
    expect(c.precioTiktokOferta).toBeCloseTo(esperado.S, 1);
  });

  it("GT104 con el afiliado de omisión (8 %) y el TDC de omisión", () => {
    const esperado = hoja(1.4527, 17.5, 0.00178472222, 38, 141, 39);
    const c = calcularCosto(
      captura({
        modelo: "GT104",
        costoUsd: 1.4527,
        cbmPar: 0.00178472222,
        envioMeli: 38,
        precioRelampago: 141,
        precioNormal: 148.99,
        envioAmazon: 39,
      }),
      P,
    );
    expect(c.tdc).toBe(17.5);
    expect(c.afiliadoTiktok).toBe(0.08);
    expect(c.costoTotal).toBeCloseTo(esperado.G, 4);
    expect(c.relampago?.ganancia).toBeCloseTo(esperado.J, 2);
    expect(c.pvpAmazon).toBeCloseTo(esperado.P, 1);
    expect(c.precioTiktok).toBeCloseTo(esperado.R, 1);
    // El PV normal es más alto que el relámpago: gana más.
    expect(c.normal!.ganancia).toBeGreaterThan(c.relampago!.ganancia);
  });

  it("GT135: la ganancia en Amazon al PVP sugerido es la misma que la relámpago en MELI", () => {
    const c = calcularCosto(
      captura({
        modelo: "GT135",
        costoUsd: 2.9167,
        tdc: 17.5,
        cbmPar: 0.005,
        envioMeli: 67,
        precioRelampago: 298.99,
        envioAmazon: 54,
      }),
      P,
    );
    const enAmazon = gananciaAmazon(c.pvpAmazon!, 54, c.costoTotal!, P);
    expect(enAmazon.ganancia).toBeCloseTo(c.relampago!.ganancia, 6);
    const enTiktok = gananciaTiktok(c.precioTiktok!, 0.08, c.costoTotal!, P);
    expect(enTiktok.ganancia).toBeCloseTo(c.relampago!.ganancia, 6);
  });

  it("con precios reales de Amazon y TikTok calcula la ganancia con ESOS precios", () => {
    const c = calcularCosto(
      captura({
        modelo: "GT104",
        costoUsd: 1.4527,
        cbmPar: 0.00178472222,
        envioMeli: 38,
        precioRelampago: 141,
        envioAmazon: 39,
        precioAmazon: 200,
        precioTiktok: 150,
      }),
      P,
    );
    expect(c.amazonReal?.ganancia).toBeCloseTo(
      200 - 200 * 0.15 - 39 - (200 / 1.16) * 0.105 - c.costoTotal!,
      6,
    );
    expect(c.tiktokReal?.ganancia).toBeCloseTo(
      150 - 150 * 0.13 - 6 - (150 / 1.16) * 0.105 - c.costoTotal!,
      6,
    );
  });

  it("sin costo en USD no calcula nada más que la aduana (nulo, nunca cero)", () => {
    const c = calcularCosto(captura({ modelo: "GT265", cbmPar: 0.004, precioRelampago: 200 }), P);
    expect(c.aduana).toBeCloseTo(4920 * 0.004, 6);
    expect(c.costoTotal).toBeNull();
    expect(c.relampago).toBeNull();
    expect(c.pvpAmazon).toBeNull();
    expect(c.precioTiktok).toBeNull();
  });

  it("sin precio relámpago hay costo y ganancia normal, pero no sugerencias de Amazon ni TikTok", () => {
    const c = calcularCosto(
      captura({ modelo: "GT104", costoUsd: 1.4527, cbmPar: 0.0017, envioMeli: 38, precioNormal: 148.99 }),
      P,
    );
    expect(c.costoTotal).not.toBeNull();
    expect(c.normal).not.toBeNull();
    expect(c.relampago).toBeNull();
    expect(c.recibirAmazon).toBeNull();
    expect(c.pvpAmazon).toBeNull();
  });

  it("sin CBM el costo total es solo USD × TDC", () => {
    const c = calcularCosto(captura({ modelo: "GT108", costoUsd: 2, tdc: 18 }), P);
    expect(c.aduana).toBeNull();
    expect(c.costoTotal).toBe(36);
  });
});

describe("leerParametrosCostos", () => {
  it("completa con las omisiones e ignora basura", () => {
    const p = leerParametrosCostos({ tdc: "18.2", aduanaPorCbm: 5000, iva: "x", meliComision: -1, otro: 9 });
    expect(p.tdc).toBe(18.2);
    expect(p.aduanaPorCbm).toBe(5000);
    expect(p.iva).toBe(0.16);
    expect(p.meliComision).toBe(0.15);
    expect((p as any).otro).toBeUndefined();
  });

  it("sin datos devuelve las omisiones de la hoja", () => {
    expect(leerParametrosCostos(null)).toEqual(PARAMETROS_COSTOS_OMISION);
  });
});

describe("filasDesdeHoja (la hoja Numeros tal cual)", () => {
  const encabezados = [
    "CATEGORIA", "MODELO", "USD", "TDC", "CBM X PAR", "ADUANA LA", "COSTO TOTAL", "ENVIO",
    "PRECIO RELAMPAGO", "GANANCIA", "PORCENTAJE", "PV NORMAL", "GANANCIA", "RECIBIR AMAZON",
    "ENVIO AMAZON", "PVP AMAZON SIN ADS", "PVP AMAZON PARA DEAL", "Tik tok con afiliados 8%",
    "PRECIO EN OFERTA NORMAL",
  ];

  it("reconoce las columnas por encabezado y salta las calculadas", () => {
    const { filas, error } = filasDesdeHoja([
      encabezados,
      ["EVA", "MY2307", "1.1423", "17.5", "0.00310960144", "15.29", "35.28", "38", "119.99", "17.8", "0.5", "119.99", "17.8", "53.1", "28.1", "106.9", "119.7", "87", "92.2"],
      ["CORCHO FRIO", "GT265", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      [],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "my2307", "9", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]);
    expect(error).toBeUndefined();
    expect(filas).toHaveLength(2);
    expect(filas[0]).toEqual({
      modelo: "MY2307",
      categoria: "EVA",
      costoUsd: 1.1423,
      tdc: 17.5,
      cbmPar: 0.00310960144,
      envioMeli: 38,
      precioRelampago: 119.99,
      precioNormal: 119.99,
      envioAmazon: 28.1,
    });
    // El modelo nuevo sin números entra solo con su categoría.
    expect(filas[1]).toMatchObject({ modelo: "GT265", categoria: "CORCHO FRIO", costoUsd: null, tdc: null });
  });

  it("acepta pesos con signo y coma", () => {
    const { filas } = filasDesdeHoja([
      ["MODELO", "USD", "ENVIO", "PRECIO RELAMPAGO"],
      ["GT179", "$8.3256", "$95", "$1,599.99"],
    ]);
    expect(filas[0]).toMatchObject({ costoUsd: 8.3256, envioMeli: 95, precioRelampago: 1599.99 });
  });

  it("sin encabezados conocidos avisa", () => {
    const { filas, error } = filasDesdeHoja([["SKU", "CANTIDAD"], ["GT104-BLK-25", "3"]]);
    expect(filas).toEqual([]);
    expect(error).toMatch(/MODELO/);
  });
});
