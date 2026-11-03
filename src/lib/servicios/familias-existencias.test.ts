import { describe, expect, it } from "vitest";
import { armarFamiliasExistencias, colorDeSku, compararFamilias, filtrarFamilias, type FilaVentaSku } from "./familias-existencias";

describe("existencias por familia", () => {
  const skus = [
    { sku: "GT114-BEIGE-24-MX", modelo: "GT114", color: "BEIGE", enBodega: 1704, enBarco: 600, enFabrica: 360, enFull: 120 },
    { sku: "GT114-BEIGE-25-MX", modelo: "GT114", color: "BEIGE", enBodega: 1896, enFull: 80 },
    { sku: "GT114-BLK-25-MX", modelo: "GT114", color: "BLK", enBodega: 1056, enFull: 30.4 },
    { sku: "GT114-BLK-25-MX", enTikTok: 105 },
    { sku: "GT114-23-BLK-MX", enFba: 40 },
    { sku: "GT148-CREAM-23-MX", modelo: "GT148", color: "CREAM", enBodega: 0 },
    { sku: "D-GT074-BLK-24-MX", enTikTok: 9 },
    { sku: "499-IPAD10-BLK", enFba: 50 },
  ];
  const ventas30: FilaVentaSku[] = [
    ["meli_calzado", "GT114-BEIGE-24-MX", 191, 50000],
    ["tiktok", "GT114-BLK-25-MX", 221, 44000],
    ["amazon", "GT114-23-BLK-MX", 10, 3000],
    ["tiktok", "D-GT074-BLK-24-MX", 5, 900],
    ["meli_fundas", "499-IPAD10-BLK", 7, 1000],
    ["meli_calzado", "GT148-CREAM-23-MX", 3, 600],
  ];
  const ventasHist: FilaVentaSku[] = [
    ["meli_calzado", "GT114-BEIGE-24-MX", 2000, 500000],
    ["tiktok", "GT114-BLK-25-MX", 900, 180000],
    ["amazon", "GT114-23-BLK-MX", 300, 90000],
    ["meli_calzado", "GT148-CREAM-23-MX", 120, 24000],
  ];
  const familias = armarFamiliasExistencias({ skus, cajasPorModelo: { GT114: 300 }, ventas30, ventasHist });

  it("junta la familia entera: todos los colores, todos los lugares, sin la fábrica en el total", () => {
    const gt114 = familias.find((f) => f.modelo === "GT114")!;
    expect(gt114.cajas).toBe(300);
    expect(gt114.enBodega).toBe(4656);
    expect(gt114.enBarco).toBe(600);
    expect(gt114.enFabrica).toBe(360);
    expect(gt114.enFull).toBe(230);
    expect(gt114.enFba).toBe(40);
    expect(gt114.enTikTok).toBe(105);
    expect(gt114.total).toBe(4656 + 600 + 230 + 40 + 105);
  });

  it("y las ventas por canal, de 30 días y de toda la historia", () => {
    const gt114 = familias.find((f) => f.modelo === "GT114")!;
    expect(gt114.ventas30).toEqual({ meli: 191, amazon: 10, tiktok: 221, total: 422 });
    expect(gt114.ventasHist).toEqual({ meli: 2000, amazon: 300, tiktok: 900, total: 3200 });
    // 5,631 pares a 422 / 30 al día.
    expect(gt114.diasQueAlcanza).toBe(Math.round(5631 / (422 / 30)));
  });

  it("desglosa por color; a un SKU de Amazon con la talla antes del color se le quita la talla", () => {
    const gt114 = familias.find((f) => f.modelo === "GT114")!;
    expect(gt114.colores.map((c) => c.color)).toEqual(["BEIGE", "BLK"]);
    const beige = gt114.colores[0];
    expect(beige.enBodega).toBe(3600);
    expect(beige.enBarco).toBe(600);
    expect(beige.enFull).toBe(200);
    expect(beige.ventas30.meli).toBe(191);
    const blk = gt114.colores[1];
    expect(blk.enTikTok).toBe(105);
    expect(blk.enFba).toBe(40);
    expect(blk.ventas30.tiktok).toBe(221);
    expect(blk.ventas30.amazon).toBe(10);
    expect(colorDeSku("GT114-23-BLK-MX")).toBe("BLK");
    expect(colorDeSku("GT114-23-MX")).toBeNull();
    expect(colorDeSku("GT134-NAVY-RED-28-MX")).toBe("NAVY-RED");
  });

  it("una familia sin stock pero con venta sí sale; lo de David y lo que no es calzado no", () => {
    const gt148 = familias.find((f) => f.modelo === "GT148")!;
    expect(gt148.total).toBe(0);
    expect(gt148.ventasHist.meli).toBe(120);
    expect(gt148.diasQueAlcanza).toBeNull();
    expect(familias.some((f) => f.modelo.startsWith("D-") || f.modelo === "GT074")).toBe(false);
    expect(familias.some((f) => f.modelo === "499")).toBe(false);
  });

  it("se ordena y se filtra", () => {
    expect([...familias].sort(compararFamilias("ventas30-desc"))[0].modelo).toBe("GT114");
    expect([...familias].sort(compararFamilias("alcanza-asc")).at(-1)!.modelo).toBe("GT148");
    expect(filtrarFamilias(familias, "cream").map((f) => f.modelo)).toEqual(["GT148"]);
    expect(filtrarFamilias(familias, "gt114 blk").map((f) => f.modelo)).toEqual(["GT114"]);
    expect(filtrarFamilias(familias, "").length).toBe(2);
  });
});
