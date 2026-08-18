/**
 * Amarre contra los SKUs REALES de la cuenta (fixtures/skus-full-meli.txt).
 * Es la prueba que faltaba: verifica que lo que se arma desde las corridas
 * empate con lo que de verdad está publicado en Mercado Libre.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importarCorridas, importarExistencias } from "./excel";
import { construirCajas } from "./cajas";
import { amarrarSku, claveComparacion, construirIndice, construirSkuMeli } from "./sku";
import { desglosarSku } from "../servicios/sync";

const dir = join(process.cwd(), "fixtures");
const skusMeli = readFileSync(join(dir, "skus-full-meli.txt"), "utf8")
  .split("\n").map((s) => s.trim()).filter(Boolean);

describe("sufijo de sitio", () => {
  it("ignora el -MX al comparar", () => {
    expect(claveComparacion("GT110-NAVY-26-MX")).toBe("GT110-NAVY-26");
    expect(claveComparacion("GT110-NAVY-26")).toBe("GT110-NAVY-26");
  });

  it("empata colores con espacio y con diagonal", () => {
    expect(claveComparacion("GT110-MILITARY GREEN-26-MX"))
      .toBe(claveComparacion(construirSkuMeli("GT110", "MILITARY GREEN", 26)));
    expect(claveComparacion("GT204-BLK/WHITE-25-MX"))
      .toBe(claveComparacion(construirSkuMeli("GT204", "BLK/WHITE", 25)));
    expect(claveComparacion("GT135-TABACO BROWN-23-MX"))
      .toBe(claveComparacion(construirSkuMeli("GT135", "TABACO BROWN", "23")));
  });

  it("no se come un sufijo que sí es parte del SKU", () => {
    // Un modelo de dos segmentos no debe perder el segundo.
    expect(claveComparacion("GT104-4-NAVY-26")).toBe("GT104-4-NAVY-26");
  });
});

describe("amarre contra el catálogo real de la cuenta", () => {
  const indice = construirIndice(skusMeli);

  it("reconoce los 272 SKUs publicados en Full", () => {
    for (const s of skusMeli) {
      expect(indice.canonicos.get(claveComparacion(s))).toBe(s);
    }
  });

  it("las corridas producen SKUs que sí existen en Mercado Libre", async () => {
    const corr = await importarCorridas(readFileSync(join(dir, "CORRIDAS_BASE.xlsx")));
    const exist = await importarExistencias(readFileSync(join(dir, "ExistenciasGlobales.xlsx")));
    const r = construirCajas(exist.filas, corr.corridas, { indice });

    // De los modelos que sí están publicados, el amarre tiene que ser total.
    const modelosPublicados = new Set(skusMeli.map((s) => s.split("-")[0]));
    const cajasDeEsosModelos = r.cajas.filter((c) =>
      modelosPublicados.has(c.modelo.toUpperCase()),
    );
    expect(cajasDeEsosModelos.length).toBeGreaterThan(0);

    const sinAmarrar = cajasDeEsosModelos.flatMap((c) =>
      c.detalle.filter((d) => d.origen === "sin_amarre").map((d) => d.sku),
    );
    // Puede quedar alguna talla que ese modelo no publique; el grueso debe amarrar.
    const total = cajasDeEsosModelos.reduce((a, c) => a + c.detalle.length, 0);
    expect(sinAmarrar.length / total).toBeLessThan(0.25);
  });
});

describe("desglose del SKU de MELI", () => {
  it("separa modelo, color y talla ignorando el sufijo de país", () => {
    expect(desglosarSku("GT110-NAVY-26-MX")).toEqual({
      modelo: "GT110", color: "NAVY", talla: "26",
    });
    expect(desglosarSku("GT110-MILITARY GREEN-30-MX")).toEqual({
      modelo: "GT110", color: "MILITARY GREEN", talla: "30",
    });
    expect(desglosarSku("GT204-BLK/WHITE-25-MX")).toEqual({
      modelo: "GT204", color: "BLK/WHITE", talla: "25",
    });
  });

  it("funciona igual sin sufijo", () => {
    expect(desglosarSku("YH817-DK BROWN-29")).toEqual({
      modelo: "YH817", color: "DK BROWN", talla: "29",
    });
  });
});

describe("amarre por forma aplastada", () => {
  it("empata M BROWN de bodega con MBROWN de la publicación", () => {
    const indice = construirIndice(["GT152-MBROWN-25-MX"]);
    const r = amarrarSku("GT152", "M BROWN", 25, indice);
    expect(r.skuMeli).toBe("GT152-MBROWN-25-MX");
    expect(r.origen).toBe("aplastado");
  });

  it("no inventa amarres cuando la talla no coincide", () => {
    const indice = construirIndice(["GT152-MBROWN-25-MX"]);
    expect(amarrarSku("GT152", "M BROWN", 26, indice).skuMeli).toBeNull();
  });

  it("no inventa amarres cuando el modelo no coincide", () => {
    const indice = construirIndice(["GT152-MBROWN-25-MX"]);
    expect(amarrarSku("GT153", "M BROWN", 25, indice).skuMeli).toBeNull();
  });
});
