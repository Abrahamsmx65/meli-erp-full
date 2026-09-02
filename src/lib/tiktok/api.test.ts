/**
 * El API de TikTok se prueba con un cliente de mentiras: lo que importa aquí
 * no es la red, sino que los pedidos se lean bien (sobre todo el estado POR
 * RENGLÓN, del que depende el descuento) y que la escritura de existencias
 * se agrupe por producto, que es como el API cobra.
 */
import { describe, expect, it, vi } from "vitest";
import { catalogo, pedidosActualizados, publicarStock } from "./api";
import type { Cliente } from "./client";

function clienteFalso(respuestas: any[], msRestantes = 100_000) {
  const llamadas: { metodo: string; ruta: string; opciones: any }[] = [];
  let i = 0;
  const c = {
    llamar: vi.fn(async (metodo: string, ruta: string, opciones: any = {}) => {
      llamadas.push({ metodo, ruta, opciones });
      return respuestas[i++] ?? null;
    }),
    msRestantes: () => msRestantes,
  };
  return { cliente: c as unknown as Cliente, llamadas, espia: c.llamar };
}

describe("pedidosActualizados", () => {
  it("lee el pedido y usa el estado DEL RENGLÓN, no el del pedido", async () => {
    const { cliente } = clienteFalso([
      {
        orders: [
          {
            id: "5770",
            status: "PARTIALLY_SHIPPING",
            create_time: 1_756_000_000,
            update_time: 1_756_100_000,
            payment: { total_amount: "1299.00", currency: "MXN" },
            line_items: [
              { id: "l1", sku_id: "s1", seller_sku: "GT128-BEIGE-24", display_status: "IN_TRANSIT", sale_price: "649.5" },
              { id: "l2", sku_id: "s2", seller_sku: "GT128-BEIGE-25", display_status: "AWAITING_SHIPMENT", sale_price: "649.5" },
            ],
          },
        ],
      },
    ]);

    const pedidos = await pedidosActualizados(cliente, 1, 2);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].estado).toBe("PARTIALLY_SHIPPING");
    expect(pedidos[0].renglones.map((r) => r.estado)).toEqual([
      "IN_TRANSIT",
      "AWAITING_SHIPMENT",
    ]);
    // Cada line_item es UNA pieza.
    expect(pedidos[0].renglones.every((r) => r.cantidad === 1)).toBe(true);
    expect(pedidos[0].creadoEn).toBe(new Date(1_756_000_000_000).toISOString());
  });

  it("sigue la paginación por token y para cuando se acaba", async () => {
    const { cliente, llamadas } = clienteFalso([
      { orders: [{ id: "1", status: "COMPLETED", line_items: [] }], next_page_token: "p2" },
      { orders: [{ id: "2", status: "COMPLETED", line_items: [] }] },
    ]);

    const pedidos = await pedidosActualizados(cliente, 1, 2);
    expect(pedidos.map((p) => p.orderId)).toEqual(["1", "2"]);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].opciones.params.page_token).toBe("p2");
  });

  it("busca por fecha de ACTUALIZACIÓN: un pedido viejo que hoy se envió tiene que salir", async () => {
    const { cliente, llamadas } = clienteFalso([{ orders: [] }]);
    await pedidosActualizados(cliente, 111, 222);
    expect(llamadas[0].opciones.cuerpo).toEqual({ update_time_ge: 111, update_time_lt: 222 });
  });
});

describe("catalogo", () => {
  it("aplana producto y SKUs, y suma el inventario de todas las bodegas", async () => {
    const { cliente } = clienteFalso([
      {
        products: [
          {
            id: "p1",
            title: "Botín GETAC GT135",
            status: "ACTIVATE",
            skus: [
              {
                id: "s1",
                seller_sku: "GT135-DK BROWN-26",
                price: { sale_price: "899" },
                sales_attributes: [{ value_name: "26" }],
                inventory: [{ quantity: 4 }, { quantity: 6 }],
              },
            ],
          },
        ],
      },
    ]);

    const lista = await catalogo(cliente);
    expect(lista).toEqual([
      {
        skuId: "s1",
        productId: "p1",
        sellerSku: "GT135-DK BROWN-26",
        titulo: "Botín GETAC GT135",
        talla: "26",
        precio: 899,
        estado: "ACTIVATE",
        disponibleEnTikTok: 10,
      },
    ]);
  });
});

describe("publicarStock", () => {
  it("junta los SKUs del mismo producto en una sola llamada", async () => {
    const { cliente, llamadas } = clienteFalso([{}, {}]);

    const r = await publicarStock(cliente, "W1", [
      { productId: "p1", skuId: "s1", cantidad: 4 },
      { productId: "p1", skuId: "s2", cantidad: 0 },
      { productId: "p2", skuId: "s3", cantidad: 7 },
    ]);

    expect(llamadas).toHaveLength(2);
    expect(llamadas[0].ruta).toBe("/product/202309/products/p1/inventory/update");
    expect(llamadas[0].opciones.cuerpo).toEqual({
      skus: [
        { id: "s1", inventory: [{ warehouse_id: "W1", quantity: 4 }] },
        { id: "s2", inventory: [{ warehouse_id: "W1", quantity: 0 }] },
      ],
    });
    expect(r).toEqual({ publicados: 3, fallidos: [] });
  });

  it("un producto que falla no detiene a los demás", async () => {
    let i = 0;
    const cliente = {
      llamar: vi.fn(async () => {
        if (i++ === 0) throw new Error("12345678 producto bloqueado");
        return {};
      }),
      msRestantes: () => 100_000,
    } as unknown as Cliente;

    const r = await publicarStock(cliente, "W1", [
      { productId: "p1", skuId: "s1", cantidad: 4 },
      { productId: "p2", skuId: "s2", cantidad: 9 },
    ]);

    expect(r.publicados).toBe(1);
    expect(r.fallidos).toEqual([{ skuId: "s1", error: "12345678 producto bloqueado" }]);
  });

  it("se detiene antes de que la función se quede sin plazo", async () => {
    const { cliente, llamadas } = clienteFalso([{}], 3_000);
    const r = await publicarStock(cliente, "W1", [{ productId: "p1", skuId: "s1", cantidad: 1 }]);
    expect(llamadas).toHaveLength(0);
    expect(r.publicados).toBe(0);
  });
});

describe("normalizarPedido: lo que hace falta para enviar desde el ERP", () => {
  it("trae el tipo de envío y los paquetes", async () => {
    const { normalizarPedido } = await import("./api");
    const p = normalizarPedido({
      id: "1",
      status: "AWAITING_SHIPMENT",
      shipping_type: "TIKTOK",
      packages: [{ id: "pk1", status: "TO_FULFILL" }],
      recipient_address: { name: "Ana", district_info: [{ address_name: "CDMX" }, { address_name: "Coyoacán" }] },
      line_items: [],
    });
    expect(p.shippingType).toBe("TIKTOK");
    expect(p.paquetes).toEqual([{ id: "pk1", estado: "TO_FULFILL" }]);
    expect(p.destinatario).toBe("Ana · CDMX, Coyoacán");
  });
});

describe("enviarPaquete", () => {
  it("con guía de TikTok solo dice cómo se entrega", async () => {
    const { enviarPaquete } = await import("./api");
    const { cliente, llamadas } = clienteFalso([{}]);
    await enviarPaquete(cliente, "pk1", { handover: "PICKUP" });
    expect(llamadas[0].ruta).toBe("/fulfillment/202309/packages/pk1/ship");
    expect(llamadas[0].opciones.cuerpo).toEqual({ handover_method: "PICKUP" });
  });

  it("con paquetería propia manda guía y proveedor", async () => {
    const { enviarPaquete } = await import("./api");
    const { cliente, llamadas } = clienteFalso([{}]);
    await enviarPaquete(cliente, "pk1", { handover: "DROP_OFF", guia: "ABC123", proveedorId: "77" });
    expect(llamadas[0].opciones.cuerpo).toEqual({
      handover_method: "DROP_OFF",
      self_shipment: { tracking_number: "ABC123", shipping_provider_id: "77" },
    });
  });
});
