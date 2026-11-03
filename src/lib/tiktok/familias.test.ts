import { describe, expect, it } from "vitest";
import { armarFamiliasTikTok, compararFamiliasTikTok, filtrarFamiliasTikTok } from "./familias";

describe("almacén TikTok por familia", () => {
  const renglones = [
    { sku: "GT114-BEIGE-24-MX", saldo: 299, apartado: 25, disponible: 274, publicado: 274, publicable: true },
    { sku: "GT114-BEIGE-25-MX", saldo: 371, apartado: 20, disponible: 351, publicado: 351, publicable: true },
    { sku: "GT114-BLK-25-MX", saldo: 105, apartado: 29, disponible: 76, publicado: 76, publicable: true },
    { sku: "GT168-BLK-24-MX", saldo: 40, apartado: 0, disponible: 40, publicado: null, publicable: false },
    { sku: "D-GT074-BLK-24-MX", saldo: 9, apartado: 0, disponible: 9, publicable: true },
    { sku: "GT148-M BROWN-26-MX", saldo: 0, apartado: 8, disponible: 0, publicable: true },
  ];
  const ventas = [
    { sku: "GT114-BEIGE-24-MX", ventas30: 191, ventasHist: 900 },
    { sku: "GT114-BLK-25-MX", ventas30: 221, ventasHist: 1200 },
    { sku: "GT148-M BROWN-26-MX", ventas30: 30, ventasHist: 782 },
    { sku: "GT102-GREY-25-MX", ventas30: 0, ventasHist: 12 },
    { sku: "D-GT074-BLK-24-MX", ventas30: 5, ventasHist: 5 },
  ];
  const familias = armarFamiliasTikTok({ renglones, ventas });

  it("suma la familia entera y la parte por color", () => {
    const gt114 = familias.find((f) => f.modelo === "GT114")!;
    expect(gt114.skus).toBe(3);
    expect(gt114.saldo).toBe(775);
    expect(gt114.apartado).toBe(74);
    expect(gt114.disponible).toBe(701);
    expect(gt114.ventas30).toBe(412);
    expect(gt114.ventasHist).toBe(2100);
    expect(gt114.diasQueAlcanza).toBe(Math.round(701 / (412 / 30)));
    expect(gt114.colores.map((c) => c.color)).toEqual(["BEIGE", "BLK"]);
    expect(gt114.colores[0].disponible).toBe(625);
    expect(gt114.colores[1].ventasHist).toBe(1200);
  });

  it("cuenta lo que no está en línea; lo de David no entra; una familia agotada con historia sí", () => {
    expect(familias.find((f) => f.modelo === "GT168")!.sinLinea).toBe(40);
    expect(familias.some((f) => f.modelo === "GT074")).toBe(false);
    const gt102 = familias.find((f) => f.modelo === "GT102")!;
    expect(gt102.disponible).toBe(0);
    expect(gt102.ventasHist).toBe(12);
    expect(gt102.diasQueAlcanza).toBeNull();
    const gt148 = familias.find((f) => f.modelo === "GT148")!;
    expect(gt148.apartado).toBe(8);
  });

  it("ordena y filtra", () => {
    expect(familias[0].modelo).toBe("GT114");
    expect([...familias].sort(compararFamiliasTikTok("hist-desc"))[0].modelo).toBe("GT114");
    expect([...familias].sort(compararFamiliasTikTok("alcanza-asc"))[0].modelo).toBe("GT114");
    expect(filtrarFamiliasTikTok(familias, "m brown").map((f) => f.modelo)).toEqual(["GT148"]);
    expect(filtrarFamiliasTikTok(familias, "gt1").length).toBe(4);
  });
});
