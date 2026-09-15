import { describe, expect, it } from "vitest";
import {
  armarFilasAmazon,
  armarFilasCalzado,
  armarFilasFundas,
  desglosarFlexible,
  indexarSkusMeli,
} from "./catalogo-skus";
import { claveOrdenada, type DatoAmazon } from "../etiquetas/resolver";
import { claveComparacion } from "../importar/sku";

describe("desglosarFlexible", () => {
  it("MODELO-COLOR-TALLA-MX (MELI)", () => {
    expect(desglosarFlexible("GT110-NAVY-26-MX")).toEqual({ modelo: "GT110", color: "NAVY", talla: "26" });
  });
  it("talla antes del color (Amazon)", () => {
    expect(desglosarFlexible("GT128-23-BLK-MX")).toEqual({ modelo: "GT128", color: "BLK", talla: "23" });
  });
  it("color con guiones y media talla", () => {
    expect(desglosarFlexible("GT135-DK-TABACO-25.5")).toEqual({
      modelo: "GT135",
      color: "DK-TABACO",
      talla: "25.5",
    });
  });
  it("sin talla", () => {
    expect(desglosarFlexible("GT104-4-BLK")).toEqual({ modelo: "GT104", color: "4-BLK", talla: null });
    expect(desglosarFlexible("GT104")).toEqual({ modelo: "GT104", color: null, talla: null });
  });
});

describe("armarFilasCalzado", () => {
  it("usa lo desglosado en la tabla, amarra Amazon por piezas ordenadas y ordena por talla", () => {
    const amazon = new Map<string, DatoAmazon>();
    const dato: DatoAmazon = { fnsku: "X00ABC", sku: "GT128-23-BLK-MX", titulo: "Bota", asin: "B0ASIN" };
    amazon.set(claveComparacion(dato.sku), dato);
    amazon.set(claveOrdenada(dato.sku), dato);

    const filas = armarFilasCalzado(
      [
        {
          sku: "GT128-BLK-25-MX",
          item_id: "MLM2",
          variation_id: "v2",
          inventory_id: "FULL25",
          user_product_id: null,
          titulo: "Bota GT128",
          modelo: "GT128",
          color: "BLK",
          talla: "25",
          estado: "active",
          precio: "899.00",
          activo: true,
        },
        {
          sku: "GT128-BLK-23-MX",
          item_id: "MLM1",
          variation_id: "v1",
          inventory_id: "FULL23",
          user_product_id: "UP1",
          titulo: "Bota GT128",
          modelo: null,
          color: null,
          talla: null,
          estado: "active",
          precio: 899,
          activo: false,
        },
      ],
      amazon,
    );

    expect(filas.map((f) => f.sku)).toEqual(["GT128-BLK-23-MX", "GT128-BLK-25-MX"]);
    expect(filas[0]).toMatchObject({
      modelo: "GT128",
      color: "BLK",
      talla: "23",
      codigoFull: "FULL23",
      estado: "retirado",
      precio: 899,
      fnsku: "X00ABC",
      asin: "B0ASIN",
      skuAmazon: "GT128-23-BLK-MX",
    });
    expect(filas[1]).toMatchObject({ fnsku: null, asin: null, skuAmazon: null, precio: 899 });
  });
});

describe("armarFilasFundas", () => {
  it("ordena por diseño y modelo del celular", () => {
    const base = {
      item_id: null,
      variation_id: null,
      inventory_id: null,
      user_product_id: null,
      titulo: null,
      estado: "active",
      precio: null,
    };
    const filas = armarFilasFundas([
      { ...base, sku: "501-iPhone15-BLK", diseno: "501", modelo: "iPhone15", color: "BLK" },
      { ...base, sku: "499-A06", diseno: "499", modelo: "A06", color: null },
      { ...base, sku: "499-A05", diseno: "499", modelo: "A05", color: null },
    ]);
    expect(filas.map((f) => f.sku)).toEqual(["499-A05", "499-A06", "501-iPhone15-BLK"]);
  });
});

describe("armarFilasAmazon", () => {
  it("une catálogo, vendidos e inventario; el FNSKU manda el inventario y el SKU MELI se amarra por piezas", () => {
    const filas = armarFilasAmazon(
      [
        { seller_sku: "GT128-23-BLK-MX", asin: "B0A", fnsku: "X00LISTING", titulo: "Bota", estado: "Active", canal: "AMAZON_NA", precio: "1299", cantidad: 3 },
        { seller_sku: "GT128-24-BLK-MX", asin: "B0B", fnsku: null, titulo: "Bota", estado: "Inactive", canal: "DEFAULT", precio: null, cantidad: 0 },
      ],
      [{ seller_sku: "GT128-23-BLK-MX", asin: null, fnsku: "VIEJO", titulo: "Otro título", estado: "x", precio: 1 }],
      [{ seller_sku: "GT128-23-BLK-MX", asin: "B0A", fnsku: "X00NUEVO", disponible: 7, total: 9 },
       { seller_sku: "GT200-BLK-22", asin: "B0C", fnsku: "X00C", disponible: 0, total: 0 }],
      indexarSkusMeli(["GT128-BLK-23-MX", "GT200-BLK-22-MX"]),
    );

    expect(filas.map((f) => f.sku)).toEqual(["GT128-23-BLK-MX", "GT128-24-BLK-MX", "GT200-BLK-22"]);
    expect(filas[0]).toMatchObject({
      asin: "B0A",
      fnsku: "X00NUEVO",
      titulo: "Bota",
      estado: "Active",
      logistica: "FBA",
      precio: 1299,
      disponibleFba: 7,
      talla: "23",
      color: "BLK",
      skuMeli: "GT128-BLK-23-MX",
    });
    expect(filas[1]).toMatchObject({ fnsku: null, logistica: "Envío propio", disponibleFba: null, skuMeli: null });
    // Solo en el inventario: igual sale, como FBA.
    expect(filas[2]).toMatchObject({ asin: "B0C", fnsku: "X00C", logistica: "FBA", skuMeli: "GT200-BLK-22-MX" });
  });
});
