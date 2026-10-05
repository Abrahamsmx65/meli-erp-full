import { describe, expect, it } from "vitest";
import { agruparAmazon, armarCatalogoAmazon, esModeloVigente, preciosTikTokPorModelo, SIN_CATEGORIA, stockPorModelo } from "./catalogo-amazon";

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

  it("marca lo oculto y suma bodega y mar por modelo", () => {
    const stock = stockPorModelo([
      { sku: "GT135-BEIGE-23-MX", enBodega: 24, enCamino: 0 },
      { sku: "GT135-BLK-24-MX", enBodega: 6, enCamino: 120 },
      { sku: "GT128-BLK-23-MX", enBodega: -2, enCamino: 0 },
    ]);
    expect(stock.get("GT135")).toEqual({ bodega: 30, mar: 120 });
    expect(stock.get("GT128")).toEqual({ bodega: 0, mar: 0 });
    const fichas = new Map([["B2", { f: ["b.jpg"], c: null, t: null }], ["N1", { f: ["n.jpg"], c: null, t: null }]]);
    const r = armarCatalogoAmazon(agruparAmazon(filas), fichas, new Map(), new Map(), { ocultos: new Set(["GT128"]), stock });
    expect(r.map((p) => [p.modelo, p.oculto, p.bodega, p.mar])).toEqual([
      ["GT128", true, 0, 0],
      ["GT135", false, 30, 120],
    ]);
  });

  it("pone el precio de la lista de TikTok: «Mi precio» manda, si no el relámpago de MELI", () => {
    const precios = preciosTikTokPorModelo(
      [
        { modelo: "GT135", precio_relampago: 299, pares_relampago: 40, neto_relampago: 220 },
        { modelo: "GT128", precio_relampago: 399, pares_relampago: 10, neto_relampago: 300 },
      ],
      [{ modelo: "GT128", precio: 450, quitar_retencion: false }],
    );
    expect(precios.get("GT128")?.normal).toBe(450);
    const gt135 = precios.get("GT135")!;
    expect(gt135.live).toBeLessThan(gt135.normal);
    expect(gt135.campana).toBeGreaterThan(gt135.normal);
    const fichas = new Map([["B2", { f: ["b.jpg"], c: null, t: null }]]);
    const r = armarCatalogoAmazon(agruparAmazon(filas), fichas, new Map(), new Map(), { precios });
    expect(r.find((p) => p.modelo === "GT135")).toMatchObject({ precioDesde: gt135.normal, precios: gt135 });
  });
});
