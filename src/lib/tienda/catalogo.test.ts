import { describe, expect, it } from "vitest";
import { colorYTalla, compararTallas, descripcionEnTexto, emparejarAmazon, interpretarProducto, seVende } from "./catalogo";

const amarres = {
  porSkuId: new Map<string, string>([["s1", "GT134-BLK-24-MX"]]),
  porSellerSku: new Map<string, string>([["GT134-BLK-25-MX", "GT134-BLK-25-MX"]]),
};

const producto = {
  id: "1729",
  title: " Botín GT134 ",
  status: "ACTIVATE",
  description: "<p>Piel <b>sintética</b></p><ul><li>Suela antiderrapante</li></ul><script>alert(1)</script>",
  main_images: [{ urls: ["https://img/1.jpg"] }, { urls: ["https://img/2.jpg"] }, { urls: ["https://img/1.jpg"] }],
  skus: [
    {
      id: "s1",
      seller_sku: "GT134-BLK-24-MX",
      price: { sale_price: "799.00" },
      sales_attributes: [
        { name: "Color", value_name: "Negro", sku_img: { urls: ["https://img/negro.jpg"] } },
        { name: "Talla", value_name: "24" },
      ],
    },
    {
      id: "s2",
      seller_sku: "GT134-BLK-25-MX",
      price: { sale_price: "799" },
      sales_attributes: [{ name: "Colour", value_name: "Negro" }, { name: "Size", value_name: "25" }],
    },
    { id: "s3", seller_sku: "SIN-AMARRE", price: { sale_price: "799" }, sales_attributes: [] },
  ],
};

describe("catálogo de la tienda desde TikTok", () => {
  it("toma título, fotos sin repetir, descripción en texto y variantes amarradas", () => {
    const p = interpretarProducto(producto, amarres)!;
    expect(p.titulo).toBe("Botín GT134");
    expect(p.modelo).toBe("GT134");
    expect(p.imagenes).toEqual(["https://img/1.jpg", "https://img/2.jpg"]);
    expect(p.descripcion).toBe("Piel sintética\n• Suela antiderrapante");
    expect(p.variantes[0]).toMatchObject({ skuInterno: "GT134-BLK-24-MX", color: "Negro", talla: "24", precio: 799, imagen: "https://img/negro.jpg" });
    expect(p.variantes[1]).toMatchObject({ skuInterno: "GT134-BLK-25-MX", talla: "25" });
    // Sin amarre al kardex no hay de dónde apartar: no se vende.
    expect(p.variantes[2].skuInterno).toBeNull();
    expect(seVende(p)).toBe(true);
  });

  it("un producto que no está activo en TikTok no se vende", () => {
    const p = interpretarProducto({ ...producto, status: "SELLER_DEACTIVATED" }, amarres)!;
    expect(seVende(p)).toBe(false);
  });

  it("sin nombre reconocible, el valor numérico es la talla", () => {
    expect(colorYTalla([{ name: "Variante", value_name: "Café" }, { name: "Otra", value_name: "26.5" }])).toMatchObject({
      color: "Café",
      talla: "26.5",
    });
  });

  it("ordena tallas como números", () => {
    expect(["25", "9", "22.5", "Única"].sort(compararTallas)).toEqual(["9", "22.5", "25", "Única"]);
  });

  it("descripción vacía es null", () => {
    expect(descripcionEnTexto("<p> </p>")).toBeNull();
  });
});

describe("emparejar con Amazon", () => {
  it("encuentra el color aunque Amazon ponga la talla antes del color o pegue el color", () => {
    const m = emparejarAmazon(
      [
        { productId: "p1", color: "Negro", skuInterno: "GT128-BLK-23-MX" },
        { productId: "p1", color: "Negro", skuInterno: "GT128-BLK-24-MX" },
        { productId: "p1", color: "Negro", skuInterno: "GT128-BLK-25-MX" },
        { productId: "p1", color: "Verde", skuInterno: "GT110-MILITARY GREEN-26-MX" },
        { productId: "p1", color: "Rojo", skuInterno: "GT128-RED-23-MX" },
      ],
      ["GT128-23-BLK-MX", "GT128-24-BLK-MX", "GT128-25-BLK-MX", "GT110-MILITARYGREEN-26-MX"],
    );
    expect(m.get("p1")?.get("Negro")).toEqual(["GT128-23-BLK-MX", "GT128-24-BLK-MX"]);
    expect(m.get("p1")?.get("Verde")).toEqual(["GT110-MILITARYGREEN-26-MX"]);
    expect(m.get("p1")?.has("Rojo")).toBe(false);
  });
});

describe("precio de TikTok", () => {
  it("lee sale_price, amount o tax_exclusive_price", () => {
    const p = interpretarProducto(
      { id: "1", title: "x", skus: [{ id: "s1", price: { amount: "899.00", currency: "MXN" }, sales_attributes: [] }] },
      { porSkuId: new Map([["s1", "GT1-BLK-24-MX"]]), porSellerSku: new Map() },
    )!;
    expect(p.variantes[0].precio).toBe(899);
  });
});
