import { describe, expect, it } from "vitest";
import { demandaConStock } from "./demanda-surtida";
import type { DiaStock } from "./types";

function dia(fecha: string, unidades: number, fraccion: number): DiaStock {
  return { fecha, inicio: fraccion > 0 ? 10 : 0, fin: fraccion > 0 ? 10 : 0, unidades, fraccionConStock: fraccion, origen: "snapshot" };
}
function serie(bloques: { dias: number; unidades: number; fraccion: number }[]): DiaStock[] {
  const out: DiaStock[] = [];
  let n = 0;
  for (const b of bloques) {
    for (let i = 0; i < b.dias; i++) {
      const f = new Date(Date.UTC(2026, 6, 1 + n++));
      out.push(dia(f.toISOString().slice(0, 10), b.unidades, b.fraccion));
    }
  }
  return out;
}

describe("demandaConStock: lo que vende cuando tiene stock", () => {
  it("los días agotados no diluyen: 30 días a 20 y 60 agotados = 20 al día", () => {
    const d = demandaConStock(serie([{ dias: 30, unidades: 20, fraccion: 1 }, { dias: 60, unidades: 1, fraccion: 0 }]));
    expect(d.tasa).toBeCloseTo(20, 5);
    expect(d.diasSurtidos).toBe(30);
  });

  it("un día con poco stock (fracción < 0.75) tampoco cuenta", () => {
    const d = demandaConStock(serie([{ dias: 30, unidades: 20, fraccion: 1 }, { dias: 10, unidades: 5, fraccion: 0.4 }]));
    expect(d.tasa).toBeCloseTo(20, 5);
    expect(d.diasSurtidos).toBe(30);
  });

  it("las tandas van por conteo de días surtidos y lo reciente pesa 50 %", () => {
    // 30 surtidos a 10, luego 30 agotados, luego 30 surtidos a 20 (los más recientes).
    const d = demandaConStock(
      serie([
        { dias: 30, unidades: 10, fraccion: 1 },
        { dias: 30, unidades: 0, fraccion: 0 },
        { dias: 30, unidades: 20, fraccion: 1 },
      ]),
    );
    // tandas: reciente 20 (peso .5), anterior 10 (peso .3); sin tercera → pesos renormalizados
    expect(d.tasa).toBeCloseTo((0.5 * 20 + 0.3 * 10) / 0.8, 5);
    expect(d.tasaReciente).toBeCloseTo(20, 5);
  });

  it("sigue la subida sin extrapolarla: nunca pasa de lo mejor que vendió surtido", () => {
    const d = demandaConStock(
      serie([
        { dias: 30, unidades: 10, fraccion: 1 },
        { dias: 30, unidades: 15, fraccion: 1 },
        { dias: 30, unidades: 25, fraccion: 1 },
      ]),
    );
    expect(d.tasa!).toBeLessThanOrEqual(25);
    expect(d.tasa!).toBeGreaterThan(15);
  });

  it("una oferta de una semana entra con su peso, no se vuelve la normal", () => {
    const d = demandaConStock(serie([{ dias: 53, unidades: 10, fraccion: 1 }, { dias: 7, unidades: 50, fraccion: 1 }]));
    // reciente: 23 días a 10 + 7 a 50 = 580/30 = 19.33; anterior 30 a 10
    expect(d.tasa).toBeCloseTo((0.5 * (580 / 30) + 0.3 * 10) / 0.8, 3);
    expect(d.tasa!).toBeLessThan(20);
  });

  it("con menos de 14 días surtidos no hay dato", () => {
    const d = demandaConStock(serie([{ dias: 10, unidades: 30, fraccion: 1 }, { dias: 80, unidades: 0, fraccion: 0 }]));
    expect(d.tasa).toBeNull();
    expect(d.diasSurtidos).toBe(10);
  });
});
