/**
 * Prueba de escala con el catálogo REAL: 448 tipos de caja, ~1,175 SKUs.
 * El optimizador tiene una fase de búsqueda local cuadrática en tipos de
 * caja, así que aquí se verifica que a tamaño real siga siendo usable.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importarCorridas, importarExistencias } from "./excel";
import { construirCajas } from "./cajas";
import { generarPlan } from "../engine";
import type { StockFull, VentaDiaria } from "../engine/types";
import { sumarDias } from "../engine/fechas";

const dir = join(process.cwd(), "fixtures");
const HOY = "2026-08-17";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function escenarioReal() {
  const corr = await importarCorridas(readFileSync(join(dir, "CORRIDAS_BASE.xlsx")));
  const exist = await importarExistencias(readFileSync(join(dir, "ExistenciasGlobales.xlsx")));
  const catalogo = construirCajas(exist.filas, corr.corridas);

  const skus = [...new Set(catalogo.cajas.flatMap((c) => c.items.map((i) => i.sku)))];

  // Demanda y stock sintéticos sobre los SKUs reales: no tenemos las ventas
  // de MELI aquí, pero la forma y el tamaño del problema sí son los reales.
  const rand = mulberry32(7);
  const ventas: VentaDiaria[] = [];
  const stockActual: StockFull[] = [];

  for (const sku of skus) {
    const lambda = rand() < 0.25 ? 0 : Math.round(rand() * 6 * 10) / 10;
    for (let i = 0; i < 90; i++) {
      const u = lambda > 0 && rand() < 0.7 ? Math.round(lambda * (0.5 + rand())) : 0;
      if (u > 0) ventas.push({ sku, fecha: sumarDias(HOY, -89 + i), unidades: u });
    }
    const disponible = Math.round(rand() * lambda * 40);
    stockActual.push({
      sku,
      disponible,
      enTransferencia: rand() < 0.15 ? Math.round(rand() * 20) : 0,
      noDisponible: 0,
      total: disponible,
    });
  }

  return { catalogo, skus, ventas, stockActual };
}

describe("escala con el catálogo real", () => {
  it("arma el plan completo en tiempo razonable", async () => {
    const { catalogo, skus, ventas, stockActual } = await escenarioReal();

    expect(catalogo.cajas.length).toBeGreaterThan(400);
    expect(skus.length).toBeGreaterThan(1000);

    const t0 = Date.now();
    const plan = generarPlan({
      skus: skus.map((sku) => ({ sku })),
      stockActual,
      ventas,
      snapshots: [],
      operaciones: [],
      inventarioPropio: [],
      cajas: catalogo.cajas,
      parametros: { leadTimeDias: 7, horizonteDias: 30, enviosPorSemana: 2 },
      hoy: HOY,
    });
    const ms = Date.now() - t0;

    // El plan se calcula en cada carga de página, así que tiene que sentirse
    // instantáneo. Con el catálogo real corre en ~0.6s; este umbral está para
    // que una regresión de rendimiento truene aquí y no en producción.
    expect(ms).toBeLessThan(3_000);
    expect(plan.lineas).toHaveLength(skus.length);
    expect(plan.cajas.totalCajas).toBeGreaterThan(0);
  }, 60_000);

  it("nunca elige más cajas de las que hay en bodega", async () => {
    const { catalogo, skus, ventas, stockActual } = await escenarioReal();
    const plan = generarPlan({
      skus: skus.map((sku) => ({ sku })),
      stockActual,
      ventas,
      snapshots: [],
      operaciones: [],
      inventarioPropio: [],
      cajas: catalogo.cajas,
      parametros: { leadTimeDias: 7, horizonteDias: 30, enviosPorSemana: 2 },
      hoy: HOY,
    });

    const disponibles = new Map(catalogo.cajas.map((c) => [c.codigo, c.cajasDisponibles]));
    for (const elegida of plan.cajas.cajas) {
      expect(elegida.cantidad).toBeLessThanOrEqual(disponibles.get(elegida.codigo)!);
      expect(elegida.cantidad).toBeGreaterThan(0);
    }
  }, 60_000);

  it("respeta el tope de cajas por envío cuando se configura", async () => {
    const { catalogo, skus, ventas, stockActual } = await escenarioReal();
    const plan = generarPlan({
      skus: skus.map((sku) => ({ sku })),
      stockActual,
      ventas,
      snapshots: [],
      operaciones: [],
      inventarioPropio: [],
      cajas: catalogo.cajas,
      parametros: {
        leadTimeDias: 7,
        horizonteDias: 30,
        enviosPorSemana: 2,
        maxCajasPorEnvio: 120,
      },
      hoy: HOY,
    });

    expect(plan.cajas.totalCajas).toBeLessThanOrEqual(120);
  }, 60_000);
});
