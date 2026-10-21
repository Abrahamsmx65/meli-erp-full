import { describe, expect, it } from "vitest";
import { ajustarCorridaPorHermanas, type DatosSkuCorrida } from "./corrida";
import { colchonDeSubida } from "./colchon";
import { generarPlan } from "./index";
import { normalizarParametros } from "./params";
import { rangoFechas, sumarDias } from "./fechas";
import type { Caja, DemandaSku, DiaStock, SnapshotStock, VentaDiaria } from "./types";

// Reglas acordadas por el dueño con Daniel el 21-oct-2026, revisando el
// envío MELI-121 de EnvioPack. Los números son los del plan de ese día.

function caja(codigo: string, cajas: number, items: [string, number][]): Caja {
  return {
    codigo,
    cajasDisponibles: cajas,
    producto: codigo,
    items: items.map(([sku, piezas]) => ({ sku, piezas })),
  };
}

function datos(filas: [string, number, number][]): Map<string, DatosSkuCorrida> {
  return new Map(filas.map(([sku, posicion, demandaDiaria]) => [sku, { posicion, demandaDiaria }]));
}

const REGLA = { hermanasMaxDias: 45, objetivoCorto: 15, fraccionTallaChica: 0.1 };

describe("corrida de Full por hermanas", () => {
  it("GT135 DK BROWN: la 24 se surte a 15 días (2 cajas, no 14); las demás esperan", () => {
    const necesidad = new Map([
      ["T23", 27],
      ["T24", 92],
      ["T27", 51],
      ["T28", 37],
    ]);
    const ajustes = ajustarCorridaPorHermanas({
      ...REGLA,
      necesidad,
      datos: datos([
        ["T23", 28, 1.386],
        ["T24", 57, 4.264],
        ["T25", 124, 3.169],
        ["T26", 109, 2.322],
        ["T27", 64, 2.965],
        ["T28", 51, 2.348],
      ]),
      cajas: [
        caja("IN10120-GT135-DK BROWN", 14, [
          ["T23", 2],
          ["T24", 4],
          ["T25", 6],
          ["T26", 5],
          ["T27", 4],
          ["T28", 3],
        ]),
      ],
    });
    expect(necesidad.get("T24")).toBe(7); // 15 × 4.264 − 57 → 2 cajas de 4
    expect(necesidad.has("T23")).toBe(false); // talla chica con 20 días: espera
    expect(necesidad.has("T27")).toBe(false);
    expect(necesidad.has("T28")).toBe(false);
    expect(ajustes.find((a) => a.sku === "T24")?.regla).toBe("quince_dias");
  });

  it("GT135 TABACO BROWN: la talla 23 (2 pares de 24) gotea 1 caja; la 24 va a 15 días", () => {
    const necesidad = new Map([
      ["T23", 86],
      ["T24", 111],
      ["T25", 65],
    ]);
    ajustarCorridaPorHermanas({
      ...REGLA,
      necesidad,
      datos: datos([
        ["T23", 15, 2.873],
        ["T24", 44, 4.513],
        ["T25", 83, 4.141],
        ["T26", 91, 3.458],
        ["T27", 91, 3.747],
        ["T28", 60, 2.257],
      ]),
      cajas: [
        caja("IN10120-GT135-TABACO BROWN", 22, [
          ["T23", 2],
          ["T24", 4],
          ["T25", 5],
          ["T26", 5],
          ["T27", 5],
          ["T28", 3],
        ]),
      ],
    });
    expect(necesidad.get("T23")).toBe(2); // una caja
    expect(necesidad.get("T24")).toBe(24); // 6 cajas, no 14 ni 22
    expect(necesidad.has("T25")).toBe(false); // 20 días: le alcanza para 15
  });

  it("GT194 BLK: 1 par de talla 23 por caja → goteo de UNA caja", () => {
    const necesidad = new Map([["T23", 17]]);
    const ajustes = ajustarCorridaPorHermanas({
      ...REGLA,
      necesidad,
      datos: datos([
        ["T23", 3, 0.45],
        ["T24", 53, 0.323],
        ["T25", 61, 0.415],
        ["T26", 17, 0.203],
        ["T27", 9, 0.214],
      ]),
      cajas: [
        caja("IN10056-GT194-BLK", 27, [
          ["T23", 1],
          ["T24", 4],
          ["T25", 4],
          ["T26", 2],
          ["T27", 1],
        ]),
      ],
    });
    expect(necesidad.get("T23")).toBe(1);
    expect(ajustes[0].regla).toBe("goteo");
  });

  it("GT167 BLK: la mayoría de la caja va a tallas sobradas → goteo, no 8 cajas", () => {
    const necesidad = new Map([
      ["T26", 55],
      ["T27", 33],
    ]);
    ajustarCorridaPorHermanas({
      ...REGLA,
      necesidad,
      datos: datos([
        ["T23", 50, 1.244],
        ["T24", 144, 1.586],
        ["T25", 116, 1.904],
        ["T26", 0, 1.481],
        ["T27", 0, 0.819],
      ]),
      cajas: [
        caja("IN10108-GT167-BLK", 32, [
          ["T23", 3],
          ["T24", 8],
          ["T25", 8],
          ["T26", 3],
          ["T27", 2],
        ]),
      ],
    });
    expect(necesidad.get("T26")).toBe(3); // una caja
    expect(necesidad.get("T27")).toBe(2);
  });

  it("si las hermanas no pasan de 45 días, la talla pide su objetivo completo", () => {
    const necesidad = new Map([["A", 20]]);
    const ajustes = ajustarCorridaPorHermanas({
      ...REGLA,
      necesidad,
      datos: datos([
        ["A", 5, 1],
        ["B", 20, 1],
      ]),
      cajas: [caja("C", 10, [["A", 6], ["B", 6]])],
    });
    expect(ajustes).toHaveLength(0);
    expect(necesidad.get("A")).toBe(20);
  });

  it("una caja de UNA sola talla no tiene hermanas: no se recorta", () => {
    const necesidad = new Map([["A", 50]]);
    ajustarCorridaPorHermanas({
      ...REGLA,
      necesidad,
      datos: datos([["A", 5, 2]]),
      cajas: [caja("SOLA", 10, [["A", 24]])],
    });
    expect(necesidad.get("A")).toBe(50);
  });
});

describe("colchón de subida", () => {
  const p = normalizarParametros({});

  function dias(n: number, porDia: (i: number) => number): DiaStock[] {
    return Array.from({ length: n }, (_, i) => ({
      fecha: `d${i}`,
      inicio: 10,
      fin: 10,
      unidades: porDia(i),
      fraccionConStock: 1,
      origen: "snapshot" as const,
    }));
  }
  const demanda = (d: number) => ({ demandaDiaria: d }) as unknown as DemandaSku;

  it("GT156 BLK: 3.7 al día en 2 semanas contra 2.7 del plan → va en subida (1.37×)", () => {
    // Una sola talla con todo el color, para ver el factor limpio.
    const hist = new Map([["T", dias(30, (i) => (i >= 15 && i < 29 ? (i % 2 ? 4 : 3.4) : 1))]]);
    const r = colchonDeSubida(new Map([["T", "GT156-BLK"]]), hist, new Map([["T", demanda(2.7)]]), new Map(), p);
    expect(r.get("GT156-BLK")).toBeCloseTo(3.7 / 2.7, 1);
  });

  it("GT135 DK BROWN vende lo mismo que el plan: no hay colchón", () => {
    const hist = new Map([["T", dias(30, () => 16.5)]]);
    const r = colchonDeSubida(new Map([["T", "P"]]), hist, new Map([["T", demanda(16.4)]]), new Map(), p);
    expect(r.size).toBe(0);
  });

  it("con menos de 10 pares en la ventana no dice nada", () => {
    const hist = new Map([["T", dias(30, (i) => (i >= 15 ? 0.6 : 0))]]);
    const r = colchonDeSubida(new Map([["T", "P"]]), hist, new Map([["T", demanda(0.1)]]), new Map(), p);
    expect(r.size).toBe(0);
  });

  it("generarPlan: el color en subida no pasa de 60 días; la caja que cruza sí va", () => {
    const HOY = "2026-10-21";
    const inicio = sumarDias(HOY, -89);
    const snapshots: SnapshotStock[] = [];
    const ventas: VentaDiaria[] = [];
    const fechas = rangoFechas(inicio, HOY);
    fechas.forEach((f, i) => {
      for (const t of ["26", "27"]) {
        snapshots.push({ sku: `GT156-BLK-${t}`, fecha: f, disponible: 60 });
        // 1 par al día por talla, y las últimas dos semanas 6 (temporada): la tendencia
        // del plan topa en +50 %, el colchón ve el ritmo completo.
        ventas.push({ sku: `GT156-BLK-${t}`, fecha: f, unidades: i >= fechas.length - 15 ? 6 : 1 });
      }
    });
    const plan = generarPlan({
      skus: [{ sku: "GT156-BLK-26" }, { sku: "GT156-BLK-27" }],
      stockActual: ["26", "27"].map((t) => ({
        sku: `GT156-BLK-${t}`,
        disponible: 60,
        enTransferencia: 0,
        noDisponible: 0,
        total: 60,
      })),
      ventas,
      snapshots,
      operaciones: [],
      inventarioPropio: [],
      cajas: [
        {
          codigo: "IN10078-GT156-BLK",
          producto: "GT156-BLK",
          cajasDisponibles: 30,
          items: [
            { sku: "GT156-BLK-26", piezas: 6 },
            { sku: "GT156-BLK-27", piezas: 6 },
          ],
        },
      ],
      skusConVentaPrevia: new Set(["GT156-BLK-26", "GT156-BLK-27"]),
      parametros: { diasHistoria: 90 },
      hoy: HOY,
    });
    const l = plan.lineas.find((x) => x.sku === "GT156-BLK-26")!;
    expect(l.colchonSubida).toBeGreaterThanOrEqual(1.2);
    const ritmo = plan.lineas.reduce((a, x) => a + x.demanda.demandaDiaria, 0);
    const posicion = plan.lineas.reduce((a, x) => a + x.posicion, 0);
    const caben = 60 * ritmo - posicion;
    // Nunca más de las cajas que caben bajo el tope (redondeando la que cruza).
    expect(plan.cajas.totalCajas).toBeLessThanOrEqual(Math.ceil(caben / 12));
    expect(plan.cajas.totalCajas).toBeGreaterThan(0);
  });
});
