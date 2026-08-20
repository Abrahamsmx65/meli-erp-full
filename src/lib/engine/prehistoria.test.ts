/**
 * Regresión del corte de "prehistoria sin datos" en la reconstrucción:
 *
 * - Un SKU NUEVO (sin ventas antes de su primer dato) sí corta: los días
 *   previos al lanzamiento no diluyen su demanda.
 * - Un SKU VIEJO cuyo historial de fotos empieza tarde NO corta: vendía
 *   desde antes, y cortarle esos días lo mandaba al régimen de fracciones
 *   parciales e inflaba su tasa (el plan pedía el doble).
 */
import { describe, expect, test } from "vitest";
import { calcularFraccionesConStock, reconstruirStockDiario } from "./stockHistory";
import type { SnapshotStock, VentaDiaria } from "./types";

function dia(n: number): string {
  return new Date(Date.UTC(2026, 5, 1 + n)).toISOString().slice(0, 10);
}

describe("prehistoria sin datos", () => {
  test("SKU viejo con fotos recientes: la tasa no se infla", () => {
    // Vende 10 diarias los 90 días; las fotos existen solo los últimos 20.
    const ventas: VentaDiaria[] = [];
    const snapshots: SnapshotStock[] = [];
    for (let i = 0; i < 90; i++) {
      ventas.push({ sku: "GT1-BLK-25", fecha: dia(i), unidades: 8 + (i % 5) });
      if (i >= 70) snapshots.push({ sku: "GT1-BLK-25", fecha: dia(i), disponible: 100 });
    }

    const mapa = reconstruirStockDiario({
      skus: ["GT1-BLK-25"],
      desde: dia(0),
      hasta: dia(89),
      stockActual: new Map(),
      snapshots,
      operaciones: [],
      ventas,
    });
    const dias = mapa.get("GT1-BLK-25")!;
    const tasa = calcularFraccionesConStock(dias);

    const unidades = ventas.reduce((a, v) => a + v.unidades, 0);
    const tasaReal = unidades / 90;
    // Sin el arreglo, la tasa salía muy por encima de la real (hasta 2×).
    expect(tasa).toBeLessThan(tasaReal * 1.15);
    expect(tasa).toBeGreaterThan(tasaReal * 0.85);
  });

  test("SKU nuevo: los días previos al lanzamiento no diluyen", () => {
    // Lanzado el día 70: vende 10 diarias desde entonces, nada antes.
    const ventas: VentaDiaria[] = [];
    const snapshots: SnapshotStock[] = [];
    for (let i = 70; i < 90; i++) {
      ventas.push({ sku: "GT2-BLK-25", fecha: dia(i), unidades: 10 });
      snapshots.push({ sku: "GT2-BLK-25", fecha: dia(i), disponible: 200 });
    }

    const mapa = reconstruirStockDiario({
      skus: ["GT2-BLK-25"],
      desde: dia(0),
      hasta: dia(89),
      stockActual: new Map(),
      snapshots,
      operaciones: [],
      ventas,
    });
    const dias = mapa.get("GT2-BLK-25")!;
    const tasa = calcularFraccionesConStock(dias);

    // La tasa debe reflejar ~10/día del periodo vivo, no 200/90 ≈ 2.2.
    expect(tasa).toBeGreaterThan(8);
  });
});
