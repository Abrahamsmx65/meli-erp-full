import { describe, expect, it } from "vitest";
import { precioPagadoPorModelo } from "./tiktok-precios";

describe("precioPagadoPorModelo", () => {
  it("suma precio × pares por modelo y deja fuera cancelados, sin pagar y muestras", () => {
    const m = precioPagadoPorModelo({
      ordenes: [
        { orderId: "1", estado: "COMPLETED" },
        { orderId: "2", estado: "CANCELLED" },
        { orderId: "3", estado: "UNPAID" },
        { orderId: "4", estado: "DELIVERED", esMuestra: true },
      ],
      renglones: [
        { orderId: "1", skuInterno: "GT148-BLK-24-MX", precio: 150, cantidad: 2 },
        { orderId: "1", sellerSku: "GT148-CREAM-25-MX", precio: 120, cantidad: 1 },
        { orderId: "1", skuInterno: "GT114-BLK-24-MX", precio: 200, cantidad: 1, estado: "CANCEL" },
        { orderId: "2", skuInterno: "GT148-BLK-24-MX", precio: 999, cantidad: 1 },
        { orderId: "3", skuInterno: "GT148-BLK-24-MX", precio: 999, cantidad: 1 },
        { orderId: "4", skuInterno: "GT148-BLK-24-MX", precio: 0, cantidad: 1 },
      ],
    });
    expect(m.get("GT148")).toEqual({ suma: 420, pares: 3 });
    expect(m.has("GT114")).toBe(false);
  });

  it("sin datos, vacío", () => {
    expect(precioPagadoPorModelo(null).size).toBe(0);
  });
});
