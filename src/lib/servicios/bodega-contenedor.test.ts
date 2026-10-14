import { describe, expect, it } from "vitest";
import { armarArchivosBodega, codigoDeCaja, csvPackingBodega, csvProductosBodega, type RenglonBodega } from "./bodega-contenedor";

const r = (x: Partial<RenglonBodega>): RenglonBodega => ({
  pedido: "IN10079",
  modelo: "GT221",
  color: "BLACK",
  talla: "",
  paresPorCaja: 24,
  cajas: 40,
  largoCm: 66,
  anchoCm: 56,
  altoCm: 24,
  pesoKg: 8.5,
  ...x,
});
const modelos = new Map([["GT221", { titulo: "Pantuflas", categoriaMeli: "Pantuflas", costoMxn: 102.36 }]]);

describe("archivos de bodega del contenedor", () => {
  it("el SKU es el texto del BOX LABEL (sin espacios ni anotación; con talla si es unitalla)", () => {
    expect(codigoDeCaja("IN10079", "GT221", "M BROWN")).toBe("IN10079-GT221-MBROWN");
    expect(codigoDeCaja("IN10159", "GT134", "BLK (NEGRO)", "24")).toBe("IN10159-GT134-BLK-24");
  });

  it("PRODUCTOS calcado del archivo del dueño y sin lo que ya viajó antes", () => {
    const a = armarArchivosBodega([r({}), r({ color: "TAN", cajas: 40 })], modelos, new Set(["IN10079-GT221-TAN"]));
    expect(a.productos.map((p) => p.sku)).toEqual(["IN10079-GT221-BLACK"]);
    expect(a.yaDadosDeAlta).toEqual(["IN10079-GT221-TAN"]);
    const lineas = csvProductosBodega(a.productos).split("\r\n");
    expect(lineas[0].startsWith("Sku,Nombre,Enviar solo,Categoria,Codigo Fiscal,Valor reposicion,Barcode Producto,Barcode Paquetes,Atributos,Paquete 1 - Alto")).toBe(true);
    expect(lineas[1]).toBe(
      'IN10079-GT221-BLACK,PANTUFLAS,SI,32,53111700,"4,913.28",IN10079-GT221-BLACK,IN10079-GT221-BLACK,24,66,56,24,8.5' + ",".repeat(28),
    );
    // El packing list sí lleva los dos: es lo que llega.
    expect(csvPackingBodega(a.packing).split("\r\n")).toEqual([
      "Tipo de contenedor,Numero de contenedor,Sku,Cantidad,Informacion",
      "X,1,IN10079-GT221-BLACK,40,CAJA MASTER SELLADA",
      "X,2,IN10079-GT221-TAN,40,CAJA MASTER SELLADA",
    ]);
  });

  it("lo que falta se avisa, no se inventa", () => {
    const a = armarArchivosBodega([r({ modelo: "GT999", largoCm: null, pesoKg: null })], new Map(), new Set());
    expect(a.productos[0].valor).toBeNull();
    expect(a.productos[0].categoria).toBe("32");
    expect(a.productos[0].nombre).toBe("CALZADO");
    expect(a.avisos.join(" ")).toMatch(/Sin costo/);
    expect(a.avisos.join(" ")).toMatch(/sin medidas/);
  });
});
