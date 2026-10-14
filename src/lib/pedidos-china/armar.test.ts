import { describe, expect, it } from "vitest";
import { armarBorrador, faltantesDeBorrador, mismoColor, totalesDeBorrador, type LineaHistoria } from "./armar";
import { leerLista } from "./lista";

const h = (o: Partial<LineaHistoria>): LineaHistoria => ({
  pedido: "IN10173",
  proveedor: "Huaian Tengchuang Footwear Co., Ltd.",
  moneda: "USD",
  modelo: "GT181",
  color: "BLACK",
  talla: "",
  tallas: {},
  paresPorCaja: 12,
  precio: 10.85,
  preciosTalla: null,
  descripcion: "BOTA TACTICA CABALLERO (caja de una sola talla)",
  medidas: null,
  cbmCaja: null,
  ...o,
});

const historia: LineaHistoria[] = [
  h({ talla: "25", tallas: { "25": 144 }, medidas: { largoCm: 60, anchoCm: 40, altoCm: 30 } }),
  h({ talla: "26", tallas: { "26": 96 } }),
  h({ modelo: "GT179", color: "BROWN", talla: "26", tallas: { "26": 264 }, precio: 7.5, descripcion: "BOTA CABALLERO" }),
  // Jinjiang cobra más las tallas grandes.
  h({ pedido: "IN10160", proveedor: "JINJIANG HANDSOME SHOE CO.,LTD", moneda: "RMB", modelo: "GT161", color: "CAMEL", tallas: { "23": 7, "24": 11, "27": 4 }, paresPorCaja: 22, precio: 9.6, preciosTalla: { "23": 9.6, "24": 9.6, "27": 10.1 }, descripcion: "MENS & LADIES SLIPPER", cbmCaja: 0.1 }),
  h({ pedido: "IN10168", proveedor: "JINJIANG HANDSOME SHOE CO.,LTD", moneda: "RMB", modelo: "GT161", color: "CAMEL", talla: "23", tallas: { "23": 480 }, paresPorCaja: 48, precio: 9.6, descripcion: "MENS & LADIES SLIPPER" }),
];

describe("armarBorrador: lo que la lista no dice sale del último pedido del modelo", () => {
  const lista = leerLista(`GT179 CTNS OF 12\nBROWN\n26 22\n27 26\n\nGT181 BLK\nCTNS OF 12\n25 12\n26 8\n\nGT161 CAMEL\nMISMA CORRIDA X 20\n\nGT999 BLK\n24 10`);

  it("modelo repetido: fábrica, moneda, precio, descripción y el color como lo escribe la fábrica", () => {
    const b = armarBorrador(lista.modelos[1], historia);
    expect(b).toMatchObject({ fabrica: "tengchuang", moneda: "USD", descripcion: "BOTA TACTICA CABALLERO", nuevo: false });
    expect(b.lineas.map((l) => [l.color, l.unitalla, l.cajas, l.paresPorCaja, l.precio])).toEqual([
      ["BLACK", "25", 12, 12, 10.85],
      ["BLACK", "26", 8, 12, 10.85],
    ]);
    expect(b.lineas[0].medidas).toEqual({ largoCm: 60, anchoCm: 40, altoCm: 30 });
    expect(faltantesDeBorrador(b)).toEqual([]);
    expect(totalesDeBorrador(b.lineas)).toMatchObject({ cajas: 20, pares: 240, importe: 2604, cajasSinMedida: 0 });
  });

  it("una talla que nunca se pidió toma el precio del color", () => {
    const b = armarBorrador(lista.modelos[0], historia);
    expect(b.lineas.map((l) => [l.unitalla, l.precio])).toEqual([["26", 7.5], ["27", 7.5]]);
  });

  it("«misma corrida» toma la corrida y los precios por talla de JINJIANG en RMB", () => {
    const b = armarBorrador(lista.modelos[2], historia);
    expect(b.moneda).toBe("RMB");
    expect(b.lineas[0]).toMatchObject({ unitalla: null, cajas: 20, paresPorCaja: 22, corrida: { "23": 7, "24": 11, "27": 4 }, precio: 9.6 });
    expect(b.lineas[0].preciosTalla).toEqual({ "23": 9.6, "24": 9.6, "27": 10.1 });
    expect(totalesDeBorrador(b.lineas).importe).toBeCloseTo(20 * (18 * 9.6 + 4 * 10.1), 2);
  });

  it("producto nuevo: sin fábrica ni precio, avisado y sin poder confirmar", () => {
    const b = armarBorrador(lista.modelos[3], historia);
    expect(b.nuevo).toBe(true);
    expect(b.fabrica).toBeNull();
    expect(b.avisos.join(" ")).toContain("nunca se ha pedido");
    expect(faltantesDeBorrador(b)).toContain("la fábrica");
    // Con la fábrica elegida a mano, la moneda sale del perfil.
    const conFabrica = armarBorrador(lista.modelos[3], historia, "chaozhou");
    expect(conFabrica.moneda).toBe("USD");
    expect(conFabrica.lineas[0].precio).toBeNull();
  });

  it("los precios de OTRA fábrica no sirven", () => {
    const b = armarBorrador(lista.modelos[1], historia, "chaozhou");
    expect(b.lineas.every((l) => l.precio == null)).toBe(true);
    expect(b.avisos.join(" ")).toContain("nunca se le ha pedido");
  });

  it("sinónimos de color", () => {
    expect(mismoColor("BLK", "BLACK")).toBe(true);
    expect(mismoColor("M BROWN", "MBROWN")).toBe(true);
    expect(mismoColor("BLK", "BROWN")).toBe(false);
  });
});
