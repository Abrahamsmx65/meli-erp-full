import { describe, expect, it } from "vitest";
import { armarTikTokParaCompras, ventaDiariaTikTok } from "./tiktok-compras";

describe("TikTok para el pedido a China", () => {
  it("la venta diaria es lo vendido ÷ 30, sin corrección ni tendencia (regla del dueño)", () => {
    expect(ventaDiariaTikTok(455)).toBeCloseTo(455 / 30, 6);
    expect(ventaDiariaTikTok(0)).toBe(0);
    expect(ventaDiariaTikTok(30, 30)).toBe(1);
  });

  it("junta la venta por SKU y descuenta solo lo libre del kardex (saldo − apartado)", () => {
    const m = armarTikTokParaCompras(
      [
        { sku: "GT148-BLK-24-MX", unidades: 10 },
        { sku: "GT148-BLK-24-MX", unidades: 20 },
        { sku: "GT148-BLK-25-MX", unidades: 0 },
      ],
      [
        { sku: "GT148-BLK-24-MX", saldo: 50, apartado: 8 },
        { sku: "GT148-BLK-25-MX", saldo: 3, apartado: 5 },
        { sku: "GT999-BLK-24-MX", saldo: 12, apartado: 0 },
      ],
    );
    expect(m.get("GT148-BLK-24-MX")).toEqual({ ventaDiaria: 1, stock: 42 });
    // Sin venta y con el kardex todo apartado: no aporta nada y no entra.
    expect(m.has("GT148-BLK-25-MX")).toBe(false);
    // Con stock y sin venta SÍ entra: es inventario que no hay que volver a pedir.
    expect(m.get("GT999-BLK-24-MX")).toEqual({ ventaDiaria: 0, stock: 12 });
  });
});
