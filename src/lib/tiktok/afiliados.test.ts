import { describe, expect, it } from "vitest";
import { interpretarPedidosAfiliados, resumirAfiliado } from "./afiliados";

const crudo = {
  orders: [
    {
      id: "586245005102254010",
      create_time: 1759300000,
      status: "COMPLETED",
      skus: [
        { creator_username: "zapatos.mx", product_id: "1", quantity: 1, commission_rate: "10", estimated_paid_commission: { amount: "35.50", currency: "MXN" }, content_type: "VIDEO" },
        { creator_username: "otra.creadora", product_id: "2", quantity: 2, commission_rate: "8", actual_paid_commission: { amount: "40", currency: "MXN" } },
      ],
    },
    { id: "", skus: [] },
    { id: "999", skus: [{ quantity: 1 }] },
  ],
  next_page_token: "abc",
};

describe("interpretarPedidosAfiliados", () => {
  it("lee pedido, fecha, estado y SKUs con creador y comisión; salta lo sin id", () => {
    const p = interpretarPedidosAfiliados(crudo);
    expect(p).toHaveLength(2);
    expect(p[0].orderId).toBe("586245005102254010");
    expect(p[0].creadoEn).toBe("2025-10-01T06:26:40.000Z");
    expect(p[0].estado).toBe("COMPLETED");
    expect(p[0].skus[0]).toMatchObject({ creador: "zapatos.mx", cantidad: 1, tasa: "10", comisionEstimada: 35.5, comisionPagada: null, tipoContenido: "VIDEO" });
    expect(p[0].skus[1].comisionPagada).toBe(40);
    expect(p[1].skus[0].creador).toBeNull();
  });
  it("sin forma, vacío", () => {
    expect(interpretarPedidosAfiliados(null)).toEqual([]);
    expect(interpretarPedidosAfiliados({ orders: "x" })).toEqual([]);
  });
});

describe("resumirAfiliado", () => {
  it("el creador del pedido es el que más pares trajo", () => {
    const [p] = interpretarPedidosAfiliados(crudo);
    expect(resumirAfiliado(p).creador).toBe("otra.creadora");
  });
  it("a pares iguales, el primero; sin creador nombrado, null", () => {
    expect(resumirAfiliado({ orderId: "1", creadoEn: null, estado: null, skus: [
      { creador: "a", productId: null, cantidad: 1, tasa: null, comisionEstimada: null, comisionPagada: null, tipoContenido: null },
      { creador: "b", productId: null, cantidad: 1, tasa: null, comisionEstimada: null, comisionPagada: null, tipoContenido: null },
    ] }).creador).toBe("a");
    expect(resumirAfiliado({ orderId: "1", creadoEn: null, estado: null, skus: [] }).creador).toBeNull();
  });
});
