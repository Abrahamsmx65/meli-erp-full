import { describe, expect, it } from "vitest";
import { armarCatalogoInfluencers, mensajeDeSeleccion } from "./influencers";

const base = { descripcion: null, imagenes: ["https://tt/1.jpg"], bullets: ["Piel"], categoria: "Botas y Botines" };

describe("catálogo de influencers", () => {
  it("junta activos e inactivos, con fotos de Amazon por color y tallas con existencia", () => {
    const productos = [
      { ...base, product_id: "2", modelo: "GT134", titulo: "Botín", activo: false, fotos_amazon: {} as Record<string, string[]> },
      { ...base, product_id: "1", modelo: "GT102", titulo: "Bota", activo: true, fotos_amazon: { Negro: ["https://amz/n1.jpg"] } },
    ];
    const v = (product_id: string, sku_id: string, color: string, talla: string, sku: string | null, precio: number | null) => ({
      product_id, sku_id, sku_interno: sku, color, talla, precio, precio_lista: null, imagen: null,
    });
    const variantes = [
      v("1", "a", "Negro", "25", "GT102-BLK-25-MX", 799),
      v("1", "b", "Negro", "23", "GT102-BLK-23-MX", 799),
      v("2", "c", "Café", "24", null, 899),
    ];
    const r = armarCatalogoInfluencers(productos, variantes, new Map([["GT102-BLK-25-MX", 3]]));
    expect(r.map((p) => p.modelo)).toEqual(["GT102", "GT134"]);
    expect(r[0].colores[0]).toMatchObject({ color: "Negro", fotos: ["https://amz/n1.jpg"], tallas: ["23", "25"], tallasConStock: ["25"] });
    expect(r[0].pares).toBe(3);
    // Inactivo y sin amarre: se enseña igual, con las fotos de TikTok.
    expect(r[1]).toMatchObject({ activo: false, precioDesde: 899, pares: 0 });
    expect(r[1].colores[0].fotos).toEqual(["https://tt/1.jpg"]);
  });

  it("un producto sin ninguna foto no sale", () => {
    const r = armarCatalogoInfluencers(
      [{ ...base, imagenes: [], product_id: "9", modelo: "402", titulo: "Borrador", activo: false, fotos_amazon: {} as Record<string, string[]> }],
      [{ product_id: "9", sku_id: "z", sku_interno: null, color: "azul", talla: "24", precio: 399, precio_lista: null, imagen: null }],
      new Map(),
    );
    expect(r).toEqual([]);
  });

  it("arma el mensaje de la selección", () => {
    const m = mensajeDeSeleccion("@ana", [{ productId: "1", modelo: "GT102", titulo: "Bota", color: "Negro", talla: "24" }], "https://x/influencers");
    expect(m).toContain("soy @ana");
    expect(m).toContain("1. GT102 · Bota — color Negro, talla 24");
  });
});
