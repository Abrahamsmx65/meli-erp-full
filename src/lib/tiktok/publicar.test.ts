import { describe, expect, it } from "vitest";
import {
  agruparProductosAmazon,
  armarCuerpoProducto,
  atributosDeVentaDeCategoria,
  descripcionDesdeAmazon,
  elegirImagenesPrincipales,
  indexarSkusMeli,
  interpretarRespuestaCreacion,
  partirSkuAmazon,
  plantillaDesdeProducto,
  skuParaTikTok,
  tituloLimpio,
  tituloParaTikTok,
} from "./publicar";

const fila = (sellerSku: string, estado = "Active", extra: Partial<{ asin: string; titulo: string; precio: number; imagenUrl: string }> = {}) => ({
  sellerSku,
  asin: extra.asin ?? null,
  titulo: extra.titulo ?? null,
  estado,
  precio: extra.precio ?? null,
  imagenUrl: extra.imagenUrl ?? null,
});

describe("partirSkuAmazon", () => {
  it("MODELO-COLOR-TALLA-MX normal", () => {
    expect(partirSkuAmazon("GT134-DK BROWN-24-MX")).toEqual({ modelo: "GT134", color: "DK BROWN", talla: "24" });
  });
  it("talla antes del color (GT128-23-BLK-MX)", () => {
    expect(partirSkuAmazon("GT128-23-BLK-MX")).toEqual({ modelo: "GT128", color: "BLK", talla: "23" });
  });
  it("color con diagonal y sin sufijo", () => {
    expect(partirSkuAmazon("GT134-BLK/RED-25")).toEqual({ modelo: "GT134", color: "BLK/RED", talla: "25" });
  });
  it("lo que no es calzado se descarta", () => {
    expect(partirSkuAmazon("FUNDA-499-IPHONE")).toBeNull();
    expect(partirSkuAmazon("GT134-BLK")).toBeNull();
  });
});

describe("tituloLimpio", () => {
  it("quita la variante entre paréntesis que Amazon pega al final", () => {
    expect(
      tituloLimpio(
        "GETAC Chanclas Sandalias para Niñas (Fucsia, jp_footwear_size_system, toddler, women, measurement, measurement_10_point_0_centimeters)",
      ),
    ).toBe("GETAC Chanclas Sandalias para Niñas");
  });
  it("respeta un paréntesis normal", () => {
    expect(tituloLimpio("Sandalias (2 pares) cómodas")).toBe("Sandalias (2 pares) cómodas");
  });
  it("corta a 255 en una palabra", () => {
    const largo = Array(60).fill("palabra").join(" ");
    const t = tituloParaTikTok(largo);
    expect(t.length).toBeLessThanOrEqual(255);
    expect(t.endsWith("palabra")).toBe(true);
  });
});

describe("skuParaTikTok", () => {
  it("MODELO-COLOR-TALLA-MX por omisión, reordenando lo de Amazon", () => {
    expect(skuParaTikTok("GT128", "BLK", "23")).toBe("GT128-BLK-23-MX");
  });
  it("usa el nombre exacto de MELI cuando existe", () => {
    const meli = indexarSkusMeli(["GT128-BLK-23-MX", "GT134-NAVY / RED-28-MX"]);
    expect(skuParaTikTok("GT128", "BLK", "23", meli)).toBe("GT128-BLK-23-MX");
    expect(skuParaTikTok("GT134", "NAVY/RED", "28", meli)).toBe("GT134-NAVY / RED-28-MX");
  });
});

describe("agruparProductosAmazon", () => {
  const filas = [
    fila("GT134-BLK-24-MX", "Active", { asin: "A1", titulo: "GETAC Sandalias GT134 (Negro, size_system, x)", precio: 499, imagenUrl: "img-blk" }),
    fila("GT134-BLK-25-MX", "Active", { asin: "A2", precio: 499 }),
    fila("GT134-BLK-25", "Inactive", { asin: "A9", precio: 450 }),
    fila("GT134-25-RED-MX", "Inactive", { asin: "A3", precio: 499, imagenUrl: "img-red" }),
    fila("GT134-RED-26-MX", "Active", { asin: "A4", precio: 549 }),
    fila("GT150-CAMEL-23-MX", "Active", { asin: "A5", titulo: "GT150 Botas", precio: 699 }),
    fila("GT150-GREY-23-MX", "Inactive", { asin: "A6", precio: 699 }),
    fila("499-IPHONE15", "Active"),
  ];

  it("agrupa modelo → color → talla, con tallas ordenadas y precio de referencia", () => {
    const p = agruparProductosAmazon(filas, { padres: new Map([["A1", { titulo: "GETAC Sandalias GT134 Mujer", imagenUrl: null }]]) });
    expect(p.map((x) => x.modelo)).toEqual(["GT134", "GT150"]);
    const gt134 = p[0];
    expect(gt134.titulo).toBe("GETAC Sandalias GT134 Mujer");
    expect(gt134.colores.map((c) => c.color)).toEqual(["BLK", "RED"]);
    expect(gt134.colores[0].tallas.map((t) => t.talla)).toEqual(["24", "25"]);
    // la talla 25 Active gana a la Inactive con el mismo número
    expect(gt134.colores[0].tallas[1].sellerSku).toBe("GT134-BLK-25-MX");
    expect(gt134.colores[1].tallas.map((t) => t.skuTikTok)).toEqual(["GT134-RED-25-MX", "GT134-RED-26-MX"]);
    expect(gt134.precioAmazon).toBe(499);
    expect(gt134.imagenUrl).toBe("img-blk");
    expect(gt134.coloresPorPublicar).toEqual(["BLK", "RED"]);
    expect(gt134.coloresActivosPorPublicar).toEqual(["BLK", "RED"]);
    expect(gt134.activas).toBe(3);
  });

  it("marca los colores que TikTok ya vende, con alias de color", () => {
    const p = agruparProductosAmazon(filas, {
      enTikTok: [
        { sellerSku: "GT134-BLK-24-MX", skuInterno: "GT134-BLK-24-MX", productId: "P1", estado: "ACTIVATE" },
        { sellerSku: "GT150-BROWN-23-MX", skuInterno: "GT150-BROWN-23-MX", productId: "P2", estado: "ACTIVATE" },
        { sellerSku: "GT134-RED-26-MX", skuInterno: null, productId: "P3", estado: "DELETED" },
      ],
      alias: [{ modelo: "GT150", colorTikTok: "BROWN", colorAmazon: "CAMEL" }],
    });
    expect(p[0].coloresEnTikTok).toEqual(["BLK"]);
    expect(p[0].coloresPorPublicar).toEqual(["RED"]);
    expect(p[0].colores[0].enTikTok).toEqual(["GT134-BLK-24-MX"]);
    expect(p[1].coloresEnTikTok).toEqual(["CAMEL"]);
    // GREY solo tiene tallas apagadas: se puede publicar a propósito, no por omisión.
    expect(p[1].coloresPorPublicar).toEqual(["GREY"]);
    expect(p[1].coloresActivosPorPublicar).toEqual([]);
  });
});

const productoCrudo = {
  id: "1737291478677554393",
  title: "GETAC Sandalias",
  category_chains: [
    { id: "1", parent_id: "0", local_name: "Calzado", is_leaf: false },
    { id: "9001", parent_id: "1", local_name: "Sandalias", is_leaf: true },
  ],
  brand: { id: "B7", name: "GETAC" },
  product_attributes: [{ id: "100", name: "Material", values: [{ id: "1001", name: "EVA" }] }],
  package_weight: { value: "0.6", unit: "KILOGRAM" },
  package_dimensions: { length: "30", width: "20", height: "10", unit: "CENTIMETER" },
  is_cod_allowed: true,
  skus: [
    { id: "s1", seller_sku: "GT134-BLK-24-MX", sales_attributes: [{ id: "c1", name: "Color", value_id: "v1", value_name: "BLK" }, { id: "t1", name: "Talla", value_id: "v24", value_name: "24" }] },
    { id: "s2", seller_sku: "GT134-BLK-25-MX", sales_attributes: [{ id: "c1", name: "Color", value_id: "v1", value_name: "BLK" }, { id: "t1", name: "Talla", value_id: "v25", value_name: "25" }] },
  ],
};

describe("plantillaDesdeProducto", () => {
  it("copia categoría hoja, marca, atributos, peso, medidas y reconoce Color y Talla", () => {
    const p = plantillaDesdeProducto(productoCrudo);
    expect(p.categoryId).toBe("9001");
    expect(p.brandId).toBe("B7");
    expect(p.productAttributes).toEqual([{ id: "100", values: [{ id: "1001", name: "EVA" }] }]);
    expect(p.packageWeight).toEqual({ value: "0.6", unit: "KILOGRAM" });
    expect(p.packageDimensions?.length).toBe("30");
    expect(p.atributoTalla).toEqual({ id: "t1", name: "Talla" });
    expect(p.atributoColor).toEqual({ id: "c1", name: "Color" });
    expect(p.isCodAllowed).toBe(true);
  });
  it("sin peso usa el de respaldo", () => {
    const p = plantillaDesdeProducto({ ...productoCrudo, package_weight: null, package_dimensions: null });
    expect(p.packageWeight).toEqual({ value: "0.8", unit: "KILOGRAM" });
    expect(p.packageDimensions).toBeNull();
  });
  it("de los atributos de la categoría saca Color y Talla", () => {
    const r = atributosDeVentaDeCategoria([
      { id: "a", name: "Material", type: "PRODUCT_PROPERTY" },
      { id: "b", name: "Color", type: "SALES_PROPERTY" },
      { id: "c", name: "Talla de calzado", type: "SALES_PROPERTY" },
    ]);
    expect(r).toEqual({ color: { id: "b", name: "Color" }, talla: { id: "c", name: "Talla de calzado" } });
  });
});

describe("armarCuerpoProducto", () => {
  const plantilla = plantillaDesdeProducto(productoCrudo);
  const datos = {
    titulo: "GETAC Sandalias GT134 Mujer",
    descripcionHtml: "<p>Cómodas</p>",
    precio: 399,
    moneda: "MXN",
    warehouseId: "W1",
    imagenesUri: ["u-main", "u-2"],
    colores: [
      { color: "BLK", imagenUri: "u-main", tallas: [{ talla: "24", sellerSku: "GT134-BLK-24-MX", cantidad: 3 }, { talla: "25", sellerSku: "GT134-BLK-25-MX", cantidad: 0 }] },
      { color: "RED", imagenUri: null, tallas: [{ talla: "26", sellerSku: "GT134-RED-26-MX", cantidad: 1 }] },
    ],
    borrador: false,
  };

  it("arma el cuerpo con una variante por color y talla, precio igual y bodega", () => {
    const c = armarCuerpoProducto(datos, plantilla) as any;
    expect(c.title).toBe("GETAC Sandalias GT134 Mujer");
    expect(c.category_id).toBe("9001");
    expect(c.brand_id).toBe("B7");
    expect(c.save_mode).toBe("LISTING");
    expect(c.main_images).toEqual([{ uri: "u-main" }, { uri: "u-2" }]);
    expect(c.skus).toHaveLength(3);
    expect(c.skus[0]).toEqual({
      sales_attributes: [
        { id: "c1", name: "Color", value_name: "BLK", sku_img: { uri: "u-main" } },
        { id: "t1", name: "Talla", value_name: "24" },
      ],
      seller_sku: "GT134-BLK-24-MX",
      price: { amount: "399.00", currency: "MXN" },
      inventory: [{ warehouse_id: "W1", quantity: 3 }],
    });
    expect(c.skus[2].sales_attributes[0]).toEqual({ id: "c1", name: "Color", value_name: "RED" });
    expect(c.package_weight).toEqual({ value: "0.6", unit: "KILOGRAM" });
    expect(c.is_cod_allowed).toBe(true);
  });

  it("como borrador manda DRAFT", () => {
    expect((armarCuerpoProducto({ ...datos, borrador: true }, plantilla) as any).save_mode).toBe("DRAFT");
  });

  it("sin imágenes, sin precio o sin talla no se publica", () => {
    expect(() => armarCuerpoProducto({ ...datos, imagenesUri: [] }, plantilla)).toThrow(/imagen/);
    expect(() => armarCuerpoProducto({ ...datos, precio: 0 }, plantilla)).toThrow(/precio/);
    expect(() => armarCuerpoProducto(datos, { ...plantilla, atributoTalla: null })).toThrow(/talla/);
    expect(() => armarCuerpoProducto(datos, { ...plantilla, atributoColor: null })).toThrow(/color/);
  });

  it("un solo color sin atributo de color en la plantilla sí se publica, solo con talla", () => {
    const c = armarCuerpoProducto({ ...datos, colores: [datos.colores[0]] }, { ...plantilla, atributoColor: null }) as any;
    expect(c.skus[0].sales_attributes).toEqual([{ id: "t1", name: "Talla", value_name: "24" }]);
  });
});

describe("imágenes y descripción", () => {
  it("la primera foto de cada color y luego las demás, hasta 9 sin repetir", () => {
    const r = elegirImagenesPrincipales([
      ["a1", "a2", "a3"],
      ["b1", "a2"],
      ["c1"],
    ]);
    expect(r).toEqual(["a1", "b1", "c1", "a2", "a3"]);
    expect(elegirImagenesPrincipales([Array.from({ length: 12 }, (_, i) => `x${i}`)])).toHaveLength(9);
  });
  it("la descripción junta puntos clave y descripción; sin nada, el título", () => {
    expect(descripcionDesdeAmazon({ bullets: ["Suela <EVA>", " "], descripcion: "Larga", titulo: "T" })).toBe("<p>Suela &lt;EVA&gt;</p><p>Larga</p>");
    expect(descripcionDesdeAmazon({ bullets: [], descripcion: null, titulo: "T" })).toBe("<p>T</p>");
  });
  it("interpreta la respuesta de creación", () => {
    const r = interpretarRespuestaCreacion({ product_id: "P", skus: [{ id: "S", seller_sku: "GT1-BLK-24-MX" }], warnings: [{ message: "ojo" }] });
    expect(r).toEqual({ productId: "P", skus: [{ skuId: "S", sellerSku: "GT1-BLK-24-MX" }], avisos: ["ojo"] });
    expect(() => interpretarRespuestaCreacion({})).toThrow();
  });
});
