import { describe, expect, it } from "vitest";
import { agregarDesdeReporte } from "./sync";

describe("agregarDesdeReporte: renglones por pedido", () => {
  const fila = (pedido: string, sku: string, cantidad: string, precio: string, estado = "Shipped") => ({
    "amazon-order-id": pedido,
    sku,
    "purchase-date": "2026-11-18T23:30:00+00:00",
    "item-status": estado,
    quantity: cantidad,
    "item-price": precio,
  });

  it("junta pedido + SKU, con la fecha de México, y marca los cancelados", () => {
    const { renglones } = agregarDesdeReporte(
      [
        fila("701-1", "GT114-BLK-24-MX", "1", "199.99"),
        fila("701-1", "GT114-BLK-24-MX", "1", "199.99"),
        fila("701-2", "GT148-BLK-25-MX", "1", "299", "Cancelled"),
      ],
      "cta",
    );
    const a = renglones.find((r) => r.amazon_order_id === "701-1")!;
    expect(a).toMatchObject({ seller_sku: "GT114-BLK-24-MX", fecha: "2026-11-18", unidades: 2, importe: 399.98, cancelado: false });
    expect(renglones.find((r) => r.amazon_order_id === "701-2")).toMatchObject({ cancelado: true, unidades: 0 });
  });
});
