import { describe, expect, it } from "vitest";
import { armarArchivosBodega, barcodeDeSku, codigoDeCaja, csvPackingBodega, csvProductosBodega, skuMeliDeCaja, type RenglonBodega } from "./bodega-contenedor";

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
  it("la clave de la caja junta renglones con el color del pedido, con guion donde había espacio", () => {
    expect(codigoDeCaja("IN10079", "GT221", "LT BROWN")).toBe("IN10079-GT221-LT-BROWN");
    expect(codigoDeCaja("IN10079", "GT221", "M  BROWN ")).toBe("IN10079-GT221-M-BROWN");
    expect(codigoDeCaja("IN10159", "GT134", "BLK (NEGRO)", "24")).toBe("IN10159-GT134-BLK-24");
  });

  it("el barcode es el SKU de MELI con guion donde había espacio (S268 y GT297, 22-oct-2026)", () => {
    expect(barcodeDeSku("IN10147-GT170-LT BROWN")).toBe("IN10147-GT170-LT-BROWN");
    expect(barcodeDeSku("IN10164-GT297-BLK-RED")).toBe("IN10164-GT297-BLK-RED");
    expect(barcodeDeSku("IN10176-GT161-BLK / GREY")).toBe("IN10176-GT161-BLK/GREY");
    expect(barcodeDeSku("IN10172-GT148-BLK-21.5")).toBe("IN10172-GT148-BLK-21.5");
  });

  it("el SKU es el de Mercado Libre: sin talla en la corrida, con ella en la unitalla, y sin «-MX»", () => {
    expect(skuMeliDeCaja("IN10079", "GT221", "BLACK", "", "GT221-BLK-24-MX")).toBe("IN10079-GT221-BLK");
    expect(skuMeliDeCaja("IN10079", "GT221", "LT BROWN", "", "GT221-LT BROWN-25-MX")).toBe("IN10079-GT221-LT BROWN");
    expect(skuMeliDeCaja("IN10172", "GT148", "BLACK", "24", "GT148-BLK-24-MX")).toBe("IN10172-GT148-BLK-24");
    expect(skuMeliDeCaja("IN10140", "GT104-1", "BLK", "", "GT104-1-BLK-25-MX")).toBe("IN10140-GT104-1-BLK");
    // Sin variante en MELI: el color del pedido, sin anotación.
    expect(skuMeliDeCaja("IN10079", "GT999", "BLK (NEGRO)", "", null)).toBe("IN10079-GT999-BLK");
  });

  it("PRODUCTOS calcado del archivo del dueño: SKU de MELI, el mismo como barcode, sin lo que ya viajó antes", () => {
    const a = armarArchivosBodega(
      [r({ skuMeli: "GT221-BLK-24-MX" }), r({ color: "LT BROWN", cajas: 40, skuMeli: "GT221-LT BROWN-23-MX" }), r({ color: "TAN", skuMeli: "GT221-TAN-24-MX" })],
      modelos,
      new Set(["IN10079-GT221-TAN"]),
    );
    expect(a.productos.map((p) => [p.sku, p.barcode])).toEqual([
      ["IN10079-GT221-BLK", "IN10079-GT221-BLK"],
      ["IN10079-GT221-LT BROWN", "IN10079-GT221-LT-BROWN"],
    ]);
    expect(a.yaDadosDeAlta).toEqual(["IN10079-GT221-TAN"]);
    const lineas = csvProductosBodega(a.productos).split("\r\n");
    expect(lineas[0].startsWith("Sku,Nombre,Enviar solo,Categoria,Codigo Fiscal,Valor reposicion,Barcode Producto,Barcode Paquetes,Atributos,Paquete 1 - Alto")).toBe(true);
    expect(lineas[1]).toBe(
      'IN10079-GT221-BLK,PANTUFLAS,SI,32,53111700,"4,913.28",IN10079-GT221-BLK,IN10079-GT221-BLK,24,66,56,24,8.5' + ",".repeat(28),
    );
    expect(lineas[2].startsWith("IN10079-GT221-LT BROWN,PANTUFLAS,SI,32,53111700,\"4,913.28\",IN10079-GT221-LT-BROWN,IN10079-GT221-LT-BROWN,")).toBe(true);
    // El packing list sí lleva todo, con el SKU de MELI: es lo que llega.
    expect(csvPackingBodega(a.packing).split("\r\n")).toEqual([
      "Tipo de contenedor,Numero de contenedor,Sku,Cantidad,Informacion",
      "X,1,IN10079-GT221-BLK,40,CAJA MASTER SELLADA",
      "X,2,IN10079-GT221-LT BROWN,40,CAJA MASTER SELLADA",
      "X,3,IN10079-GT221-TAN,40,CAJA MASTER SELLADA",
    ]);
  });

  it("lo que falta se avisa, no se inventa", () => {
    const a = armarArchivosBodega([r({ modelo: "GT999", largoCm: null, pesoKg: null })], new Map(), new Set());
    expect(a.productos[0].valor).toBeNull();
    expect(a.productos[0].categoria).toBe("32");
    expect(a.productos[0].nombre).toBe("CALZADO");
    expect(a.avisos.join(" ")).toMatch(/Sin costo/);
    expect(a.avisos.join(" ")).toMatch(/sin medidas/);
    expect(a.avisos.join(" ")).toMatch(/Sin variante en Mercado Libre/);
  });
});
