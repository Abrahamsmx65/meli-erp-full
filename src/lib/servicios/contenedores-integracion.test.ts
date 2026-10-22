import { describe, expect, it } from "vitest";
import { armarArchivosBodega, type RenglonBodega } from "./bodega-contenedor";
import { COLUMNAS_CONTENEDOR, contenedorParaIndusther, esContenedorVivo, type FilaContenedor } from "./contenedores-integracion";

const renglon = (color: string, cajas: number, skuMeli: string | null, talla = ""): RenglonBodega => ({
  pedido: "IN10079",
  modelo: "GT217",
  color,
  talla,
  paresPorCaja: 24,
  cajas,
  largoCm: 66,
  anchoCm: 56,
  altoCm: 24,
  pesoKg: 11,
  skuMeli,
});

const fila: FilaContenedor = {
  id: "c1",
  numero: "S260-2026",
  numero_naviera: "MIEU3920536",
  naviera: null,
  estado: "en_transito",
  fecha_salida: null,
  fecha_llegada_est: "2026-11-05",
  cajas_bl: 611,
  otros: [{ cajas: 35, color: "WHITE", pedido: null, piezas: 55000, descripcion: "POLYBAG" }],
};

// Costo por par 51.18 → valor de reposición de la caja = 2 × 51.18 × 24 = 2,456.64 (S260: 2,456.6 con su costo de entonces).
const modelos = new Map([["GT217", { titulo: "Pantufla", categoriaMeli: "Pantuflas", costoMxn: 51.18 }]]);

describe("contenedorParaIndusther", () => {
  it("calca el S260.xlsx: PARES POR CAJA | Cantidad | NUMERO DE CONTENEDOR | Sku | PRECIO | TITULO", () => {
    const armado = armarArchivosBodega(
      [renglon("TAN", 31, "GT217-TAN-23-MX"), renglon("BLACK", 30, "GT217-BLK-23-MX"), renglon("BLACK", 20, "GT217-BLK-23-MX")],
      modelos,
      new Set(),
    );
    const c = contenedorParaIndusther(fila, armado);
    expect(c.tabla.columnas).toEqual(COLUMNAS_CONTENEDOR);
    expect(c.tabla.filas).toEqual([
      { "PARES POR CAJA": 24, Cantidad: 50, "NUMERO DE CONTENEDOR": "S260", Sku: "IN10079-GT217-BLK", PRECIO: 2456.64, TITULO: "PANTUFLAS" },
      { "PARES POR CAJA": 24, Cantidad: 31, "NUMERO DE CONTENEDOR": "S260", Sku: "IN10079-GT217-TAN", PRECIO: 2456.64, TITULO: "PANTUFLAS" },
    ]);
    expect(c).toMatchObject({ numero: "S260", estadoErp: "en_transito", cajas: 81, pares: 1944, cajasBl: 611 });
    expect(c.otros).toEqual([{ descripcion: "POLYBAG", color: "WHITE", cajas: 35, piezas: 55000 }]);
  });

  it("la caja de una talla lleva la talla en el Sku; sin costo, PRECIO vacío", () => {
    const armado = armarArchivosBodega([renglon("TAN", 3, "GT217-TAN-25-MX", "25")], new Map(), new Set());
    const c = contenedorParaIndusther(fila, armado);
    expect(c.tabla.filas[0]).toMatchObject({ Sku: "IN10079-GT217-TAN-25", PRECIO: null, Cantidad: 3 });
    expect(c.avisos.some((a) => a.includes("Sin costo"))).toBe(true);
  });

  it("los DUPLICADO no viajan", () => {
    expect(esContenedorVivo("DUPLICADO S263-2026")).toBe(false);
    expect(esContenedorVivo("S263-2026")).toBe(true);
  });
});
