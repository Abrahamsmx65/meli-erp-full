import { describe, expect, it } from "vitest";
import { agruparPublicacionesParaVideos } from "./videos-publicaciones";

describe("agruparPublicacionesParaVideos", () => {
  it("una entrada por publicación con sus SKUs, en orden por título", () => {
    const pubs = agruparPublicacionesParaVideos([
      { sku: "GT148-BLK-24-MX", item_id: "MLM2", titulo: "Tenis", modelo: "GT148", color: "BLK" },
      { sku: "GT148-BLK-25-MX", item_id: "MLM2", titulo: "Tenis", modelo: "GT148", color: "BLK" },
      { sku: null, item_id: "MLM1", titulo: "Botas", modelo: "GT114", color: null },
      { sku: "X", item_id: "MLM3", titulo: null, modelo: null, color: null },
    ]);
    expect(pubs.map((p) => p.itemId)).toEqual(["MLM1", "MLM3", "MLM2"]);
    expect(pubs[2].skus).toEqual(["GT148-BLK-24-MX", "GT148-BLK-25-MX"]);
    expect(pubs[0]).toEqual({ itemId: "MLM1", titulo: "Botas", modelo: "GT114", color: "", skus: [] });
    expect(pubs[1].titulo).toBe("MLM3");
  });
});
