import { describe, expect, it } from "vitest";
import { armarPedidoAlmacen } from "./pedidos-almacen";

const base = {
  ventas: [
    { sku: "GT114-BLK-25-MX", unidades: 4 },
    { sku: "GT114-BEIGE-23-MX", unidades: 1 },
    { sku: "GT150-CAMEL-27-MX", unidades: 10 },
  ],
  existencias: [
    { sku: "GT114-BLK-25-MX", almacen: "Industher", pares: 3 },
    { sku: "GT114-BLK-25-MX", almacen: "EnvioPack", pares: 20 },
    { sku: "GT114-BEIGE-23-MX", almacen: "En camino de China", pares: 50 },
    { sku: "GT150-CAMEL-27-MX", almacen: "Caseshop", pares: 4 },
    { sku: "GT150-CAMEL-27-MX", almacen: "TIKTOK", pares: 99 },
  ],
  kardex: [
    { sku: "GT114-BLK-25-MX", saldo: 5, apartado: 2 },
    { sku: "GT150-CAMEL-27-MX", saldo: 0, apartado: 0 },
  ],
  dias: 7,
};

describe("armarPedidoAlmacen · modo vendido", () => {
  const p = armarPedidoAlmacen({ ...base, modo: "vendido" });

  it("repone lo vendido topado por lo que hay en bodega, en orden de bodega (modelo, color, talla)", () => {
    // GT114-BEIGE solo tiene existencia en camino de China: no se pide y no aparece.
    // GT150 vendió 10 pero Caseshop solo tiene 4: se piden 4.
    expect(p.renglones.map((r) => [r.sku, r.deseado, r.pedir])).toEqual([
      ["GT114-BLK-25-MX", 4, 4],
      ["GT150-CAMEL-27-MX", 10, 4],
    ]);
  });

  it("surte primero de Industher, luego Caseshop, luego EnvioPack, hasta donde alcance cada una", () => {
    const blk = p.renglones.find((r) => r.sku === "GT114-BLK-25-MX")!;
    expect(blk.surtir).toEqual([
      { almacen: "Industher", pares: 3 },
      { almacen: "Caseshop", pares: 0 },
      { almacen: "EnvioPack", pares: 1 },
    ]);
    expect(blk.faltante).toBe(0);
  });

  it("lo que ninguna bodega tiene NO se pide: se declara en sinBodega; China y la bodega TikTok no cuentan", () => {
    expect(p.renglones.find((r) => r.sku === "GT114-BEIGE-23-MX")).toBeUndefined();
    expect(p.sinBodega).toEqual({ skus: 1, pares: 1, lista: ["GT114-BEIGE-23-MX"] });
    const camel = p.renglones.find((r) => r.sku === "GT150-CAMEL-27-MX")!;
    expect(camel.surtir.find((s) => s.almacen === "Caseshop")?.pares).toBe(4);
    expect(camel.faltante).toBe(6);
  });

  it("trae el kardex de TikTok y la cobertura", () => {
    const blk = p.renglones.find((r) => r.sku === "GT114-BLK-25-MX")!;
    expect(blk.disponible).toBe(3);
    expect(blk.ventaDiaria).toBeCloseTo(4 / 7);
    expect(blk.diasCobertura).toBeCloseTo(3 / (4 / 7));
  });

  it("suma por modelo y por bodega: los vendidos son todos, lo pedido solo lo que hay", () => {
    expect(p.porModelo).toEqual([
      { modelo: "GT114", vendidos: 5, pedir: 4, faltante: 1, skus: 1 },
      { modelo: "GT150", vendidos: 10, pedir: 4, faltante: 6, skus: 1 },
    ]);
    expect(p.totales).toEqual({
      skus: 2,
      vendidos: 15,
      pedir: 8,
      faltante: 7,
      porBodega: [
        { almacen: "Industher", pares: 3 },
        { almacen: "Caseshop", pares: 4 },
        { almacen: "EnvioPack", pares: 1 },
      ],
    });
  });

  it("un modelo del que no se pide nada no va al resumen por modelo", () => {
    const solo = armarPedidoAlmacen({ ...base, ventas: [{ sku: "GT114-BEIGE-23-MX", unidades: 3 }], modo: "vendido" });
    expect(solo.renglones).toEqual([]);
    expect(solo.porModelo).toEqual([]);
    expect(solo.sinBodega.pares).toBe(3);
  });
});

describe("armarPedidoAlmacen · modo cobertura", () => {
  it("pide lo que falte para N días de venta, descontando el disponible", () => {
    const p = armarPedidoAlmacen({ ...base, modo: "cobertura", diasObjetivo: 14 });
    // GT114-BLK: 4/7 al día × 14 = 8 − 3 disponibles = 5 (hay 23 en bodega)
    expect(p.renglones.find((r) => r.sku === "GT114-BLK-25-MX")!.pedir).toBe(5);
    // GT150: 10/7 × 14 = 20 − 0 = 20 deseados, pero Caseshop solo tiene 4
    const camel = p.renglones.find((r) => r.sku === "GT150-CAMEL-27-MX")!;
    expect(camel.deseado).toBe(20);
    expect(camel.pedir).toBe(4);
    expect(p.diasObjetivo).toBe(14);
  });

  it("un SKU con más disponible que el objetivo no pide nada", () => {
    const p = armarPedidoAlmacen({
      ...base,
      kardex: [{ sku: "GT114-BLK-25-MX", saldo: 40, apartado: 0 }],
      modo: "cobertura",
      diasObjetivo: 14,
    });
    expect(p.renglones.find((r) => r.sku === "GT114-BLK-25-MX")).toBeUndefined();
    expect(p.sinBodega.lista).not.toContain("GT114-BLK-25-MX");
  });
});

describe("armarPedidoAlmacen · sin ventas", () => {
  it("un periodo sin ventas da un pedido vacío", () => {
    const p = armarPedidoAlmacen({ ...base, ventas: [], modo: "vendido" });
    expect(p.renglones).toEqual([]);
    expect(p.totales.pedir).toBe(0);
  });
});
