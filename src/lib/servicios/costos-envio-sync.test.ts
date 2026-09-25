import { beforeEach, describe, expect, it, vi } from "vitest";

const { traerTodo } = vi.hoisted(() => ({ traerTodo: vi.fn() }));

vi.mock("../datos/repos", async (importOriginal) => {
  const original = await importOriginal<typeof import("../datos/repos")>();
  return { ...original, traerTodo };
});

import { hayQueReleer, sincronizarMedidas } from "./costos-envio";

const DIA = 86_400_000;
const REFRESCO = 30 * DIA;

describe("cuándo se vuelve a leer una medida de MELI", () => {
  const ahora = Date.parse("2026-09-25T12:00:00Z");
  const hace = (dias: number) => new Date(ahora - dias * DIA).toISOString();

  it("sin medida guardada, siempre", () => {
    expect(hayQueReleer(undefined, REFRESCO, ahora)).toBe(true);
    expect(hayQueReleer({ alto: null, medidas_en: hace(1), costo: null, costo_normal: null }, REFRESCO, ahora)).toBe(true);
  });

  it("una que cobra de más se relee en CADA pasada: es la que se reclamó", () => {
    expect(hayQueReleer({ alto: 36, medidas_en: hace(0), costo: 139.5, costo_normal: 88.5 }, REFRESCO, ahora)).toBe(true);
  });

  it("una bien medida se relee cuando cumple el refresco, no antes", () => {
    expect(hayQueReleer({ alto: 10, medidas_en: hace(3), costo: 88.5, costo_normal: 88.5 }, REFRESCO, ahora)).toBe(false);
    expect(hayQueReleer({ alto: 10, medidas_en: hace(31), costo: 88.5, costo_normal: 88.5 }, REFRESCO, ahora)).toBe(true);
    // Sin costo calculado todavía tampoco se relee antes de tiempo.
    expect(hayQueReleer({ alto: 10, medidas_en: hace(3), costo: null, costo_normal: null }, REFRESCO, ahora)).toBe(false);
  });
});

/**
 * El bug real: MELI ya había corregido varias medidas y seguían saliendo como
 * pendientes. Cada "revisar de nuevo" reutilizaba la medida guardada de la
 * variante (viven en el user product) y le ponía fecha de hoy, así que los
 * 30 días nunca corrían y nunca se volvía a preguntar.
 */
describe("sincronizarMedidas y las correcciones de MELI", () => {
  const item = {
    id: "MLM1",
    price: 499,
    status: "active",
    listing_type_id: "gold_special",
    shipping: { free_shipping: true, logistic_type: "fulfillment" },
    attributes: [], // publicación con variantes: las medidas viven en el user product
    variations: [
      { id: 1, price: 499, user_product_id: "UP-MALA", inventory_id: "F1" },
      { id: 2, price: 499, user_product_id: "UP-BUENA", inventory_id: "F2" },
    ],
  };
  const skus = [
    { sku: "GT229-DK-26", item_id: "MLM1", variation_id: "1", user_product_id: "UP-MALA", inventory_id: "F1", modelo: "GT229", color: "DK", talla: "26", estado: "active" },
    { sku: "GT229-DK-27", item_id: "MLM1", variation_id: "2", user_product_id: "UP-BUENA", inventory_id: "F2", modelo: "GT229", color: "DK", talla: "27", estado: "active" },
  ];
  const medidaCorregida = (alto: number) => [
    { id: "PACKAGE_HEIGHT", value_struct: { number: alto, unit: "cm" } },
    { id: "PACKAGE_WIDTH", value_struct: { number: 24, unit: "cm" } },
    { id: "PACKAGE_LENGTH", value_struct: { number: 27, unit: "cm" } },
    { id: "PACKAGE_WEIGHT", value_struct: { number: 530, unit: "g" } },
    { id: "PACKAGE_DATA_SOURCE", value_name: "MEASUREMENT" },
  ];

  let guardado: Record<string, unknown>[];
  const db = {
    from: vi.fn(() => ({
      upsert: vi.fn(async (filas: Record<string, unknown>[]) => {
        guardado.push(...filas);
        return { error: null };
      }),
    })),
  };

  beforeEach(() => {
    guardado = [];
    traerTodo.mockReset();
  });

  it("relee la que cobra de más, ve la corrección y tira su costo viejo; la buena ni se toca", async () => {
    const ayer = new Date(Date.now() - DIA).toISOString();
    const haceUnRato = new Date(Date.now() - 3_600_000).toISOString();
    traerTodo
      .mockResolvedValueOnce(skus) // skus
      .mockResolvedValueOnce([
        // medidas_envio: la DK-26 quedó parada (36.6) y cobra $139.50; la DK-27 está bien.
        // El precio de venta se leyó hace un rato: hoy no se vuelve a pedir.
        { sku: "GT229-DK-26", alto: 36.6, ancho: 29.4, largo: 11.2, peso: 530, fuente: "MEASUREMENT", medidas_en: ayer, costo: 139.5, costo_normal: 88.5, precio_venta: 341, precio_en: haceUnRato },
        { sku: "GT229-DK-27", alto: 9.6, ancho: 25, largo: 29.8, peso: 560, fuente: "MEASUREMENT", medidas_en: ayer, costo: 88.5, costo_normal: 88.5, precio_venta: 341, precio_en: haceUnRato },
      ]);

    const pedidas: string[] = [];
    const cliente = {
      get: vi.fn(async (ruta: string) => {
        pedidas.push(ruta);
        if (ruta === "/items") return [{ code: 200, body: item }];
        if (ruta === "/user-products/UP-MALA") return { attributes: medidaCorregida(10) };
        throw new Error(`no se esperaba ${ruta}`);
      }),
    };

    const r = await sincronizarMedidas(cliente as never, db as never, "cuenta", { limiteMs: 10_000 });

    expect(r.userProducts).toBe(1);
    expect(pedidas).toEqual(["/items", "/user-products/UP-MALA"]);

    const mala = guardado.find((g) => g.sku === "GT229-DK-26")!;
    expect(mala.alto).toBe(10); // ya corregida por MELI
    expect(mala.costo).toBeNull(); // el costo viejo ya no vale: se recalcula
    expect(mala.medidas_en).not.toBe(ayer); // sí se leyó hoy

    const buena = guardado.find((g) => g.sku === "GT229-DK-27")!;
    expect(buena.alto).toBe(9.6);
    expect(buena).not.toHaveProperty("costo"); // no se toca
    expect(buena).not.toHaveProperty("medidas_en"); // NO estrena fecha: no se leyó
  });

  it("una medida reutilizada de la base no se vuelve fresca: a los 30 días sí se relee", async () => {
    const hace31 = new Date(Date.now() - 31 * DIA).toISOString();
    traerTodo
      .mockResolvedValueOnce(skus.slice(1))
      .mockResolvedValueOnce([
        { sku: "GT229-DK-27", alto: 9.6, ancho: 25, largo: 29.8, peso: 560, fuente: "MEASUREMENT", medidas_en: hace31, costo: 88.5, costo_normal: 88.5, precio_venta: 341, precio_en: new Date().toISOString() },
      ]);
    const cliente = {
      get: vi.fn(async (ruta: string) => {
        if (ruta === "/items") return [{ code: 200, body: item }];
        if (ruta === "/user-products/UP-BUENA") return { attributes: medidaCorregida(9.6) };
        throw new Error(`no se esperaba ${ruta}`);
      }),
    };
    const r = await sincronizarMedidas(cliente as never, db as never, "cuenta", { limiteMs: 10_000 });
    expect(r.userProducts).toBe(1);
    expect(guardado[0].medidas_en).toBeDefined();
  });

  /**
   * El envío se cobra por tramo de PRECIO: una publicación de $499 en
   * promoción a $341 paga otro envío. MELI enseña el costo al precio de venta
   * y el ERP preguntaba al de lista: por eso "MELI ya lo corrigió" y la lista
   * seguía igual (GT229-TABACO BROWN-24, 25-sep-2026).
   */
  it("lee el precio de venta de la publicación y, si cambió, tira el costo para recalcularlo", async () => {
    const ayer = new Date(Date.now() - DIA).toISOString();
    traerTodo
      .mockResolvedValueOnce(skus.slice(1))
      .mockResolvedValueOnce([
        { sku: "GT229-DK-27", alto: 9.6, ancho: 25, largo: 29.8, peso: 560, fuente: "MEASUREMENT", medidas_en: ayer, costo: 88.5, costo_normal: 88.5, precio_venta: null, precio_en: null },
      ]);
    const cliente = {
      get: vi.fn(async (ruta: string, params?: Record<string, unknown>) => {
        if (ruta === "/items") return [{ code: 200, body: item }];
        if (ruta === "/items/MLM1/sale_price") {
          expect(params?.context).toBe("channel_marketplace");
          return { amount: 341, regular_amount: 499, currency_id: "MXN" };
        }
        throw new Error(`no se esperaba ${ruta}`);
      }),
    };
    await sincronizarMedidas(cliente as never, db as never, "cuenta", { limiteMs: 10_000 });
    const fila = guardado[0];
    expect(fila.precio).toBe(499); // el de lista se sigue guardando
    expect(fila.precio_venta).toBe(341);
    expect(fila.precio_en).toBeDefined();
    expect(fila.costo).toBeNull(); // se recalcula al precio de venta
    expect(fila).not.toHaveProperty("medidas_en"); // la medida no se releyó
  });

  it("sin precio de venta en MELI vale el de la publicación, y no se vuelve a preguntar hoy", async () => {
    traerTodo.mockResolvedValueOnce(skus.slice(1)).mockResolvedValueOnce([]);
    const cliente = {
      get: vi.fn(async (ruta: string) => {
        if (ruta === "/items") return [{ code: 200, body: item }];
        if (ruta === "/items/MLM1/sale_price") return { amount: null };
        if (ruta === "/user-products/UP-BUENA") return { attributes: medidaCorregida(9.6) };
        throw new Error(`no se esperaba ${ruta}`);
      }),
    };
    await sincronizarMedidas(cliente as never, db as never, "cuenta", { limiteMs: 10_000 });
    expect(guardado[0].precio_venta).toBe(499);
    expect(guardado[0].precio_en).toBeDefined();
  });
});
