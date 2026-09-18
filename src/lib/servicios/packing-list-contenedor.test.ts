import { describe, expect, it } from "vitest";
import { armarPackingListContenedor, codigoFiscalDeCategoria, type DatosModelo, type RenglonContenedor } from "./packing-list-contenedor";

describe("codigoFiscalDeCategoria: la tabla del dueño", () => {
  it("cada categoría de MELI cae en su fracción", () => {
    expect(codigoFiscalDeCategoria("Botas y Botines")).toBe("53111500");
    expect(codigoFiscalDeCategoria("Alpargatas")).toBe("53111600");
    expect(codigoFiscalDeCategoria("Mocasines y Oxfords")).toBe("53111600");
    expect(codigoFiscalDeCategoria("Flats")).toBe("53111600");
    expect(codigoFiscalDeCategoria("Zapatillas y Tacones")).toBe("53111600");
    expect(codigoFiscalDeCategoria("Calzado Industrial")).toBe("53111600");
    expect(codigoFiscalDeCategoria("Pantuflas")).toBe("53111700");
    expect(codigoFiscalDeCategoria("Sandalias y Chanclas")).toBe("53111800");
    expect(codigoFiscalDeCategoria("Tenis")).toBe("53111900");
  });
  it("sin categoría o una desconocida no adivina", () => {
    expect(codigoFiscalDeCategoria(null)).toBeNull();
    expect(codigoFiscalDeCategoria("Ropa")).toBeNull();
  });
});

const renglon = (x: Partial<RenglonContenedor>): RenglonContenedor => ({
  pedido: "IN10126",
  modelo: "GT142",
  color: "CREAM",
  talla: "",
  paresPorCaja: 24,
  cajas: 40,
  largoCm: 66,
  anchoCm: 56,
  altoCm: 24,
  pesoKg: 9.5,
  ...x,
});

const modelos = new Map<string, DatosModelo>([
  ["GT142", { titulo: "Sandalias de Mujer GT142", categoriaMeli: "Sandalias y Chanclas", costoMxn: 36.56 }],
  ["GT250", { titulo: "Tenis GT250", categoriaMeli: "Tenis", costoMxn: null }],
]);

describe("armarPackingListContenedor", () => {
  it("un renglón por pedido-modelo-color, con el valor de la caja = costo × pares", () => {
    const p = armarPackingListContenedor([renglon({})], modelos);
    expect(p.filas).toHaveLength(1);
    const f = p.filas[0];
    expect(f.sku).toBe("IN10126-GT142-CREAM");
    expect(f.pares).toBe(24);
    expect(f.cajas).toBe(40);
    expect([f.largoCm, f.altoCm, f.anchoCm, f.pesoKg]).toEqual([66, 24, 56, 9.5]);
    expect(f.precio).toBe(877.44);
    expect(f.nombre).toBe("Sandalias de Mujer GT142");
    expect(f.codigoFiscal).toBe("53111800");
    expect(p.totales).toEqual({ cajas: 40, pares: 960, valor: 35097.6 });
    expect(p.avisos).toEqual([]);
  });

  it("la caja unitalla lleva la talla en el SKU", () => {
    const p = armarPackingListContenedor([renglon({ talla: "25", paresPorCaja: 12 })], modelos);
    expect(p.filas[0].sku).toBe("IN10126-GT142-CREAM-25");
    expect(p.filas[0].precio).toBe(438.72);
  });

  it("lo que falta se deja en blanco y se declara", () => {
    const p = armarPackingListContenedor(
      [
        renglon({}),
        renglon({ modelo: "GT250", color: "BLK", largoCm: null, anchoCm: null, altoCm: null, pesoKg: null }),
        renglon({ modelo: "GT999", color: "TAN" }),
      ],
      modelos,
    );
    const gt250 = p.filas.find((f) => f.modelo === "GT250")!;
    expect(gt250.precio).toBeNull();
    expect(gt250.codigoFiscal).toBe("53111900");
    expect(gt250.largoCm).toBeNull();
    const gt999 = p.filas.find((f) => f.modelo === "GT999")!;
    expect(gt999.codigoFiscal).toBe("");
    expect(gt999.nombre).toBe("");
    expect(p.avisos).toEqual([
      "Sin costo en Productos y costos (PRECIO en blanco): GT250, GT999.",
      "1 renglones sin medidas o peso de la caja: el contenedor se cargó sin el packing list de la fábrica. Súbelo en Contenedores y vuelve a descargar.",
      "Sin categoría de MELI reconocida (CODIGO FISCAL en blanco): GT999.",
      "Sin publicación en MELI (NOMBRE en blanco): GT999.",
    ]);
  });

  it("ordena por pedido, modelo y color con números naturales", () => {
    const p = armarPackingListContenedor(
      [
        renglon({ pedido: "IN10130", modelo: "GT142" }),
        renglon({ pedido: "IN10126", modelo: "GT250", color: "BLK" }),
        renglon({ pedido: "IN10126", modelo: "GT142", color: "TAN" }),
        renglon({ pedido: "IN10126", modelo: "GT142", color: "CREAM" }),
      ],
      modelos,
    );
    expect(p.filas.map((f) => f.sku)).toEqual([
      "IN10126-GT142-CREAM",
      "IN10126-GT142-TAN",
      "IN10126-GT250-BLK",
      "IN10130-GT142-CREAM",
    ]);
  });
});
