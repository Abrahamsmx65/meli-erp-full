import { describe, expect, it } from "vitest";
import { inversionPorCategoria } from "./inventario";

const r = (modelo: string, enBodega: number, enCamino = 0) => ({ modelo, enBodega, enCamino });

/** productos_config: costo y categoría por modelo. */
const config = (filas: [string, string | null, number | null][]) =>
  new Map(filas.map(([m, categoria, costo]) => [m, { categoria, costo }]));

describe("inversionPorCategoria", () => {
  const base = config([
    ["GT110", "corcho", 300],
    ["GT120", "corcho", 250],
    ["GT200", "pantufla", 100],
    ["GT900", "EVA", null], // capturado sin costo
  ]);

  it("agrupa por categoría y separa bodega de lo que viene en el barco", () => {
    const inv = inversionPorCategoria(
      [r("GT110", 10, 5), r("GT120", 4, 0), r("GT200", 20, 10)],
      base,
    );

    const corcho = inv.categorias.find((c) => c.categoria === "corcho")!;
    expect(corcho.valor.enBodega).toBe(10 * 300 + 4 * 250); // 4,000
    expect(corcho.valor.enCamino).toBe(5 * 300); // 1,500
    expect(corcho.valor.total).toBe(5500);
    expect(corcho.modelos).toBe(2);

    const pantufla = inv.categorias.find((c) => c.categoria === "pantufla")!;
    expect(pantufla.valor.total).toBe(20 * 100 + 10 * 100); // 3,000
  });

  it("el total de abajo cuadra con la suma de las categorías", () => {
    const inv = inversionPorCategoria([r("GT110", 10, 5), r("GT120", 4), r("GT200", 20, 10)], base);
    const suma = inv.categorias.reduce((a, c) => a + c.valor.total, 0);
    expect(inv.total.total).toBe(suma);
    expect(inv.total.total).toBe(inv.total.enBodega + inv.total.enCamino);
    // Y los porcentajes suman 1.
    expect(inv.categorias.reduce((a, c) => a + c.parte, 0)).toBeCloseTo(1, 10);
  });

  it("lo que no tiene costo NO se cuenta como cero: se aparta y se declara", () => {
    const inv = inversionPorCategoria([r("GT110", 10), r("GT900", 7, 3)], base);
    expect(inv.total.total).toBe(3000); // solo el GT110
    expect(inv.sinCosto.pares).toBe(10); // 7 + 3 del GT900
    expect(inv.sinCosto.modelos).toEqual(["GT900"]);
    // Un modelo que ni siquiera está en productos_config cuenta igual.
    const inv2 = inversionPorCategoria([r("XX999", 5)], base);
    expect(inv2.sinCosto.modelos).toEqual(["XX999"]);
    expect(inv2.total.total).toBe(0);
  });

  it("un modelo con costo pero sin categoría no se pierde: va en «Sin categoría»", () => {
    const inv = inversionPorCategoria([r("GT300", 10)], config([["GT300", null, 150]]));
    expect(inv.categorias.map((c) => c.categoria)).toEqual(["Sin categoría"]);
    expect(inv.total.total).toBe(1500);
    expect(inv.sinCategoria).toBe(1);
    expect(inv.sinCosto.pares).toBe(0);
  });

  it("ordena de más dinero a menos, que es la pregunta que responde", () => {
    const inv = inversionPorCategoria([r("GT200", 100), r("GT110", 100)], base);
    expect(inv.categorias.map((c) => c.categoria)).toEqual(["corcho", "pantufla"]);
  });

  it("encuentra el costo aunque el modelo venga en minúsculas", () => {
    // productos_config guarda los modelos en mayúsculas; el inventario a
    // veces no. Mismo respaldo que usa cargarProductos, para que un costo
    // capturado no se pierda por una diferencia de mayúsculas.
    const inv = inversionPorCategoria([r("gt110", 10)], base);
    expect(inv.total.total).toBe(3000);
    expect(inv.sinCosto.pares).toBe(0);
  });

  it("los renglones sin existencia no ensucian el conteo de modelos", () => {
    const inv = inversionPorCategoria([r("GT110", 0, 0), r("GT120", 1)], base);
    expect(inv.categorias).toHaveLength(1);
    expect(inv.categorias[0].modelos).toBe(1);
  });
});
