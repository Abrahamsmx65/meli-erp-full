import { describe, expect, it } from "vitest";
import { sugerirEnvioFba } from "./fba";
import { indexarCatalogo } from "../etiquetas/resolver";
import type { RenglonAmazon } from "./amazon";

/**
 * Regla de la corrida despareja en la tabla de cobertura por producto:
 * cuando la mayoría de las tallas está al día y solo una (o pocas) se
 * agotaron, no se completan sus 30 días a costa de sobre-surtir al resto.
 */

const SKUS = ["22", "23", "24", "25", "26", "27"].map((talla) => ({
  sku: `GT5-RED-${talla}`,
  modelo: "GT5",
  color: "RED",
  talla,
}));

const indice = indexarCatalogo(SKUS as never);

// La corrida de GT5 RED: 24 pares por caja.
const corridas = new Map([["GT5|RED", 24]]);

function renglon(talla: string, unidades: number, disponible: number): RenglonAmazon {
  return {
    sku: `GT5-RED-${talla}`,
    titulo: null,
    asin: null,
    unidades,
    ordenes: unidades,
    importe: 0,
    disponible,
    enTransferencia: 0,
    totalFba: disponible,
    cobertura: null,
  };
}

// El objetivo real por talla es 37 días (30 + 7 de recepción en FBA).
const STOCK_AL_DIA = 37; // 1/día × 37 días = surtida justo al objetivo

describe("sugerirEnvioFba con la regla de la corrida despareja", () => {
  it("hermanas al día: viaja la mitad de las cajas de la talla agotada", () => {
    // La 22 vende 4/día y está en cero: pide 4 × 37 = 148 pares → 7 cajas.
    // Las otras 5 tallas venden 1/día con stock justo al objetivo.
    const filas = [
      renglon("22", 120, 0),
      ...["23", "24", "25", "26", "27"].map((t) => renglon(t, 30, STOCK_AL_DIA)),
    ];
    const [s] = sugerirEnvioFba(filas, 30, corridas, undefined, indice);

    expect(s.ajusteCorrida).toBe("mitad_corrida");
    expect(s.faltantePares).toBe(148);
    // La mitad de las 7 cajas que completarían sus 37 días.
    expect(s.cajas).toBe(4);
    expect(s.pares).toBe(96);
  });

  it("corrida dispareja: solo se cubren los próximos 7 días", () => {
    // La 22 vende 2/día y está en cero (faltante 74, abajo del umbral de
    // 100 del faltante grande); la 27 trae 100 pares con venta de 1/día:
    // 100 días de stock, arriba del factor. Solo viaja la semana de venta
    // de la 22.
    const filas = [
      renglon("22", 60, 0),
      ...["23", "24", "25", "26"].map((t) => renglon(t, 30, STOCK_AL_DIA)),
      renglon("27", 30, 100),
    ];
    const [s] = sugerirEnvioFba(filas, 30, corridas, undefined, indice);

    expect(s.ajusteCorrida).toBe("solo_7_dias");
    // 2/día × 7 días = 14 pares → 1 caja de 24.
    expect(s.cajas).toBe(1);
    expect(s.pares).toBe(24);
  });

  it("con un faltante grande la corrida dispareja se surte completa", () => {
    // La 22 vende 8/día en cero: debe 296 pares (> 200). Aunque la 27
    // esté pasada del factor, esa venta pesa más: viajan las 13 cajas
    // completas, sin ajuste.
    const filas = [
      renglon("22", 240, 0),
      ...["23", "24", "25", "26"].map((t) => renglon(t, 30, STOCK_AL_DIA)),
      renglon("27", 30, 100),
    ];
    const [s] = sugerirEnvioFba(filas, 30, corridas, undefined, indice);

    expect(s.ajusteCorrida).toBeNull();
    expect(s.cajas).toBe(13);
  });

  it("si la mayoría de las tallas tiene faltante, no se recorta nada", () => {
    // Tres de seis tallas en cero: la corrida entera se lo pide.
    const filas = [
      ...["22", "23", "24"].map((t) => renglon(t, 120, 0)),
      ...["25", "26", "27"].map((t) => renglon(t, 30, STOCK_AL_DIA)),
    ];
    const [s] = sugerirEnvioFba(filas, 30, corridas, undefined, indice);

    expect(s.ajusteCorrida).toBeNull();
    // 3 × 148 = 444 pares → 19 cajas completas, sin recorte.
    expect(s.cajas).toBe(19);
  });

  it("una hermana vacía y sin venta no vuelve la corrida dispareja", () => {
    // La 27 no vende y está en cero: que le llegue no es sobrar.
    const filas = [
      renglon("22", 120, 0),
      ...["23", "24", "25", "26"].map((t) => renglon(t, 30, STOCK_AL_DIA)),
      renglon("27", 0, 0),
    ];
    const [s] = sugerirEnvioFba(filas, 30, corridas, undefined, indice);

    expect(s.ajusteCorrida).toBe("mitad_corrida");
  });
});
