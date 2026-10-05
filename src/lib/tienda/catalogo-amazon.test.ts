import { describe, expect, it } from "vitest";
import { agruparAmazon, armarCatalogoAmazon, esModeloVigente, SIN_CATEGORIA } from "./catalogo-amazon";

const filas = [
  { seller_sku: "GT135-BEIGE-23-MX", asin: "B1", estado: "Inactive", titulo: "Zueco GETAC (Beige, measurement_23)" },
  { seller_sku: "GT135-BEIGE-25-MX", asin: "B2", estado: "Active", titulo: null },
  { seller_sku: "GT135-DK BROWN-24-MX", asin: "D1", estado: "Inactive", titulo: null },
  { seller_sku: "GT128-23-BLK-MX", asin: "N1", estado: "Inactive", titulo: "Bota" },
  { seller_sku: "499-IPAD10-BLK", asin: "F1", estado: "Active", titulo: "Funda" },
  { seller_sku: "GT074-BLUE-25-MX", asin: "V1", estado: "Active", titulo: "Viejo" },
];

describe("catálogo completo desde Amazon", () => {
  it("los GT hasta el 100 son viejos; otros prefijos entran", () => {
    expect([esModeloVigente("GT100"), esModeloVigente("GT101"), esModeloVigente("GT074"), esModeloVigente("MY2304")]).toEqual([false, true, false, true]);
  });

  it("agrupa por modelo y color, activas primero, sin fundas", () => {
    const m = agruparAmazon(filas);
    expect(m.map((x) => x.modelo)).toEqual(["GT128", "GT135"]);
    const beige = m[1].colores.find((c) => c.codigo === "BEIGE")!;
    expect(beige.asins).toEqual(["B2", "B1"]);
    expect(beige.tallas).toEqual(["23", "25"]);
    expect(m[0].colores[0]).toMatchObject({ codigo: "BLK", tallas: ["23"], activo: false });
  });

  it("solo con fotos, categoría del ERP y si no la de Amazon", () => {
    const m = agruparAmazon(filas);
    const fichas = new Map([
      ["B2", { f: ["beige.jpg"], c: "Zuecos", t: null }],
      ["D1", { f: [], c: null, t: null }],
      ["N1", { f: ["negro.jpg"], c: null, t: null }],
    ]);
    const r = armarCatalogoAmazon(m, fichas, new Map([["GT135", "CORCHO"]]));
    expect(r.map((p) => [p.modelo, p.categoria])).toEqual([
      ["GT128", SIN_CATEGORIA],
      ["GT135", "CORCHO"],
    ]);
    // El café oscuro no tiene fotos: no sale.
    expect(r[1].colores.map((c) => c.color)).toEqual(["Beige"]);
    expect(r[1].titulo).toBe("Zueco GETAC");
    expect(r[1].activo).toBe(true);
    const sinErp = armarCatalogoAmazon(m, fichas, new Map());
    expect(sinErp[1].categoria).toBe("Zuecos");
  });
});
