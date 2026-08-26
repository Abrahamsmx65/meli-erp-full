import { describe, expect, it } from "vitest";
import { armarPublicidad, type AnuncioAds } from "./publicidad";

/**
 * El panel de publicidad junta ventas (por SKU) con anuncios (por item) a
 * nivel MODELO. Aquí se prueba ese amarre y la aritmética: costo por unidad,
 * TACOS, ganancia neta y el gasto que no amarra.
 */

const modeloDeSku = new Map([
  ["MY2307-BLACK-25", "MY2307"],
  ["MY2307-BLACK-26", "MY2307"],
  ["GT128-BROWN-27", "GT128"],
]);

const modeloDeItem = new Map([
  ["MLM111", "MY2307"],
  ["MLM222", "MY2307"],
  ["MLM333", "GT128"],
]);

const venta = (sku: string, unidades: number, importe: number, extra?: Partial<any>) => ({
  sku,
  fecha: "2026-08-01",
  unidades,
  importe,
  comision: null,
  neto: null,
  ...extra,
});

const anuncio = (itemId: string, gasto: number, extra?: Partial<AnuncioAds>): AnuncioAds => ({
  itemId,
  gasto,
  clicks: 10,
  impresiones: 100,
  unidadesAds: 0,
  ventaAds: 0,
  ...extra,
});

describe("armarPublicidad", () => {
  it("junta ventas y anuncios por modelo y saca el costo por unidad", () => {
    const p = armarPublicidad({
      anuncios: [
        anuncio("MLM111", 300, { unidadesAds: 3, ventaAds: 1500 }),
        anuncio("MLM222", 100, { unidadesAds: 1, ventaAds: 500 }),
      ],
      ventas: [
        venta("MY2307-BLACK-25", 6, 3000, { comision: 300 }),
        venta("MY2307-BLACK-26", 4, 2000, { comision: 200 }),
      ],
      modeloDeItem,
      modeloDeSku,
      costoDeModelo: new Map([["MY2307", 250]]),
      errorAds: null,
    });

    expect(p.filas).toHaveLength(1);
    const f = p.filas[0];
    expect(f.modelo).toBe("MY2307");
    expect(f.anuncios).toBe(2);
    expect(f.unidades).toBe(10);
    expect(f.importe).toBe(5000);
    expect(f.gastoAds).toBe(400);
    expect(f.ventaAds).toBe(2000);
    expect(f.unidadesAds).toBe(4);
    // Gasto entre TODAS las unidades vendidas, no solo las atribuidas a ads.
    expect(f.costoPorUnidad).toBeCloseTo(40);
    expect(f.tacos).toBeCloseTo(400 / 5000);
    // Sin neto real: neto = importe − comisión = 4500; ganancia = 4500 − 250×10.
    expect(f.ganancia).toBe(2000);
    expect(f.gananciaNeta).toBe(1600);
  });

  it("usa el neto REAL cuando ya llegó y el respaldo donde no", () => {
    const p = armarPublicidad({
      anuncios: [],
      ventas: [
        venta("MY2307-BLACK-25", 2, 1000, { comision: 100, neto: 800 }),
        venta("MY2307-BLACK-26", 1, 500, { comision: 50, neto: 0 }), // 0 no creíble
      ],
      modeloDeItem,
      modeloDeSku,
      costoDeModelo: new Map([["MY2307", 100]]),
      errorAds: null,
    });
    // 800 real + (500 − 50) respaldo − 100×3 de costo.
    expect(p.filas[0].ganancia).toBe(950);
  });

  it("sin costo capturado la ganancia y la ganancia neta quedan en null", () => {
    const p = armarPublicidad({
      anuncios: [anuncio("MLM333", 50)],
      ventas: [venta("GT128-BROWN-27", 2, 900)],
      modeloDeItem,
      modeloDeSku,
      costoDeModelo: new Map(),
      errorAds: null,
    });
    expect(p.filas[0].ganancia).toBeNull();
    expect(p.filas[0].gananciaNeta).toBeNull();
    expect(p.filas[0].costoPorUnidad).toBeCloseTo(25);
  });

  it("amarra la venta por prefijo cuando el SKU no está en el catálogo", () => {
    const p = armarPublicidad({
      anuncios: [],
      ventas: [venta("ZZ999-RED-25", 1, 400)],
      modeloDeItem,
      modeloDeSku,
      costoDeModelo: new Map(),
      errorAds: null,
    });
    expect(p.filas[0].modelo).toBe("ZZ999");
  });

  it("el gasto sin amarre se reporta aparte pero cuenta en el total", () => {
    const p = armarPublicidad({
      anuncios: [anuncio("MLM111", 100), anuncio("MLM999", 60)],
      ventas: [venta("MY2307-BLACK-25", 5, 2500)],
      modeloDeItem,
      modeloDeSku,
      costoDeModelo: new Map(),
      errorAds: null,
    });
    expect(p.sinAmarre).toEqual({ gasto: 60, anuncios: 1 });
    expect(p.totales.gastoAds).toBe(160);
    // El costo por unidad global incluye el gasto sin amarre.
    expect(p.totales.costoPorUnidad).toBeCloseTo(32);
  });

  it("ignora anuncios sin actividad y ordena por gasto", () => {
    const p = armarPublicidad({
      anuncios: [
        anuncio("MLM111", 0, { clicks: 0, impresiones: 0 }), // muerto: fuera
        anuncio("MLM333", 200),
      ],
      ventas: [
        venta("MY2307-BLACK-25", 9, 9000),
        venta("GT128-BROWN-27", 1, 500),
      ],
      modeloDeItem,
      modeloDeSku,
      costoDeModelo: new Map(),
      errorAds: null,
    });
    // GT128 gastó en ads: va primero aunque venda menos.
    expect(p.filas.map((f) => f.modelo)).toEqual(["GT128", "MY2307"]);
    expect(p.filas[1].anuncios).toBe(0);
    expect(p.filas[1].gastoAds).toBe(0);
  });

  it("calcula ACOS y TACOS globales", () => {
    const p = armarPublicidad({
      anuncios: [anuncio("MLM111", 500, { ventaAds: 2000, unidadesAds: 4 })],
      ventas: [venta("MY2307-BLACK-25", 10, 10000)],
      modeloDeItem,
      modeloDeSku,
      costoDeModelo: new Map(),
      errorAds: null,
    });
    expect(p.totales.acos).toBeCloseTo(0.25); // gasto / venta por ads
    expect(p.totales.tacos).toBeCloseTo(0.05); // gasto / venta total
  });
});
