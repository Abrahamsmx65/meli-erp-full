/**
 * El API de TikTok se prueba con un cliente de mentiras: lo que importa aquí
 * no es la red, sino que los pedidos se lean bien (sobre todo el estado POR
 * RENGLÓN, del que depende el descuento) y que la escritura de existencias
 * se agrupe por producto, que es como el API cobra.
 */
import { describe, expect, it, vi } from "vitest";
import { catalogo, pedidosActualizados, publicarStock } from "./api";
import { interpretarLiquidacion, cancelarRenglones, MOTIVOS_SIN_STOCK, esErrorDeMotivo, cancelacionAceptada, motivosDeCancelacion, motivoSinStock, nombresDeMotivo, esErrorDeParcial, motivosUsadosEnCancelaciones, motivosDeVendedor } from "./api";
import { ErrorTikTok, type Cliente } from "./client";

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

describe("interpretarLiquidacion", () => {
  it("usa el total de arriba si viene, si no suma las transacciones; nada usable = null", () => {
    expect(interpretarLiquidacion({ settlement_amount: "412.30", revenue_amount: "500", fee_amount: "-87.7", currency: "MXN", statement_id: "s1" })).toMatchObject({ neto: 412.3, ingreso: 500, comisiones: -87.7, moneda: "MXN", statementId: "s1" });
    expect(interpretarLiquidacion({ transactions: [{ settlement_amount: "100", currency: "MXN" }, { settlement_amount: "-20" }] })).toMatchObject({ neto: 80, moneda: "MXN" });
    expect(interpretarLiquidacion({ transactions: [] })).toBeNull();
    expect(interpretarLiquidacion(null)).toBeNull();
  });
});

describe("cancelarRenglones (defensa del corte)", () => {

  function clienteQue(respuestas: (any | Error)[]) {
    const llamadas: { metodo: string; ruta: string; cuerpo: any }[] = [];
    let i = 0;
    const c = {
      llamar: vi.fn(async (metodo: string, ruta: string, opciones: any = {}) => {
        llamadas.push({ metodo, ruta, cuerpo: opciones.cuerpo });
        const r = respuestas[i++];
        if (r instanceof Error) throw r;
        return r ?? null;
      }),
      msRestantes: () => 100_000,
    };
    return { cliente: c as unknown as Cliente, llamadas };
  }

  it("cancela por la ruta del vendedor de 202309, con el pedido, los SKUs y el motivo de sin stock", async () => {
    const { cliente, llamadas } = clienteQue([{ cancel_id: "9", cancel_status: "CANCELLATION_REQUEST_SUCCESS" }]);
    const r = await cancelarRenglones(cliente, "586", MOTIVOS_SIN_STOCK, [{ skuId: "s1", cantidad: 2 }]);
    expect(llamadas).toEqual([
      {
        metodo: "POST",
        ruta: "/return_refund/202309/cancellations",
        cuerpo: { order_id: "586", cancel_reason: "ecom_order_to_ship_canceled_reason_out_of_stock", skus: [{ sku_id: "s1", quantity: 2 }] },
      },
    ]);
    expect(r).toEqual({ cancelId: "9", estado: "CANCELLATION_REQUEST_SUCCESS", motivo: MOTIVOS_SIN_STOCK[0], aceptada: true });
  });

  it("sin SKUs cancela el pedido completo (sin `skus` en el cuerpo)", async () => {
    const { cliente, llamadas } = clienteQue([{}]);
    const r = await cancelarRenglones(cliente, "586", ["m1"]);
    expect(llamadas[0].cuerpo).toEqual({ order_id: "586", cancel_reason: "m1" });
    expect(r.aceptada).toBe(true);
  });

  it("si TikTok rechaza EL MOTIVO prueba el siguiente y se queda con el que aceptó", async () => {
    const { cliente, llamadas } = clienteQue([
      new ErrorTikTok(25001021, "/return_refund/202309/cancellations", "Reason not match order status"),
      { cancel_id: "10" },
    ]);
    const r = await cancelarRenglones(cliente, "586", ["malo", "bueno"]);
    expect(llamadas.map((l) => l.cuerpo.cancel_reason)).toEqual(["malo", "bueno"]);
    expect(r.motivo).toBe("bueno");
  });

  it("cualquier otro error se lanza tal cual, sin probar más motivos", async () => {
    const { cliente, llamadas } = clienteQue([new ErrorTikTok(21001001, "/return_refund/202309/cancellations", "order already shipped")]);
    await expect(cancelarRenglones(cliente, "586", ["a", "b"])).rejects.toThrow(/already shipped/);
    expect(llamadas).toHaveLength(1);
  });

  it("si ningún motivo entra, el error dice qué contestó TikTok a CADA uno", async () => {
    const { cliente } = clienteQue([
      new ErrorTikTok(25001021, "/x", "Reason not match order status"),
      new ErrorTikTok(25001014, "/x", "invalid cancel_reason"),
    ]);
    await expect(cancelarRenglones(cliente, "586", ["a", "b"])).rejects.toThrow(/«a» → 25001021 Reason not match order status \| «b» → 25001014 invalid cancel_reason/);
  });

  it("una cancelación PENDIENTE no cuenta como aceptada", async () => {
    const { cliente } = clienteQue([{ cancel_id: "11", cancel_status: "CANCELLATION_REQUEST_PENDING" }]);
    const r = await cancelarRenglones(cliente, "586", ["a"]);
    expect(r.aceptada).toBe(false);
    expect(cancelacionAceptada("CANCELLATION_REQUEST_COMPLETE")).toBe(true);
    expect(cancelacionAceptada(null)).toBe(true);
  });

  it("reconoce el error de motivo por código o por mensaje", () => {
    expect(esErrorDeMotivo(new ErrorTikTok(25001021, "/x", "x"))).toBe(true);
    expect(esErrorDeMotivo(new Error("TikTok Shop 12345 en /x: invalid reason"))).toBe(true);
    expect(esErrorDeMotivo(new Error("TikTok Shop 12345 en /x: order already shipped"))).toBe(false);
  });
});

describe("motivosDeCancelacion (aftersale eligibility)", () => {
  it("pregunta como vendedor por el pedido y junta los available_reason_names a cualquier profundidad", async () => {
    const llamadas: any[] = [];
    const cliente = {
      llamar: vi.fn(async (metodo: string, ruta: string, opciones: any) => {
        llamadas.push({ metodo, ruta, opciones });
        return {
          sku_eligibility: [
            { sku_id: "1", line_item_eligibility: [{ request_type: "CANCEL", eligible: true, available_reason_names: ["ecom_x_out_of_stock", "ecom_x_pricing_error"] }] },
            { sku_id: "2", line_item_eligibility: [{ request_type: "CANCEL", eligible: true, available_reason_names: ["ecom_x_pricing_error"] }] },
          ],
        };
      }),
      msRestantes: () => 100_000,
    } as unknown as Cliente;
    const r = await motivosDeCancelacion(cliente, "586");
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({ metodo: "GET", ruta: "/return_refund/202309/orders/586/aftersale_eligibility", opciones: { params: { initiate_aftersale_user: "SELLER" } } });
    expect(r.motivos).toEqual(["ecom_x_out_of_stock", "ecom_x_pricing_error"]);
    expect(motivoSinStock(r.motivos)).toBe("ecom_x_out_of_stock");
  });

  it("si la 202309 no trae motivos (como el 18-sep-2026), prueba las versiones nuevas y se queda con la que sí", async () => {
    const llamadas: string[] = [];
    const cliente = {
      llamar: vi.fn(async (_m: string, ruta: string) => {
        llamadas.push(ruta);
        if (ruta.includes("/202309/")) return { sku_eligibility: [{ sku_id: "1", line_item_eligibility: [{ request_type: "CANCEL", eligible: true, order_line_items_ids: ["9"] }] }] };
        if (ruta.includes("/202505/")) throw new Error("TikTok Shop 404 en x: not found");
        return { sku_eligibility: [{ sku_id: "1", line_item_eligibility: [{ request_type: "CANCEL", eligible: true, available_reason_names: ["ecom_y_out_of_stock"] }] }] };
      }),
      msRestantes: () => 100_000,
    } as unknown as Cliente;
    const r = await motivosDeCancelacion(cliente, "586");
    // La 202309 se prueba dos veces (con y sin request_type=CANCEL) y luego las versiones en orden.
    expect(llamadas.map((l) => l.split("/")[2])).toEqual(["202309", "202309", "202310"]);
    expect(r.motivos).toEqual(["ecom_y_out_of_stock"]);
    expect((r.crudo as any[]).map((x) => x.version)).toEqual(["202309", "202309", "202310"]);
    expect((r.crudo as any[])[1].params).toMatchObject({ initiate_aftersale_user: "SELLER", request_type: "CANCEL" });
  });

  it("acepta la forma con objetos y elige el primero si ninguno habla de stock", () => {
    expect(nombresDeMotivo({ a: { available_reasons: [{ name: "r1" }, { reason_name: "r2" }] } })).toEqual(["r1", "r2"]);
    expect(motivoSinStock(["r1", "r2"])).toBe("r1");
    expect(motivoSinStock([])).toBeNull();
    expect(nombresDeMotivo(null)).toEqual([]);
  });
});

describe("esErrorDeParcial", () => {
  it("reconoce el 11050001 de TikTok MX por código o por mensaje", () => {
    expect(esErrorDeParcial(new ErrorTikTok(11050001, "/x", "Operation Not Allowed. Cannot partially cancel this order"))).toBe(true);
    expect(esErrorDeParcial(new Error("TikTok Shop 11050001 en /x: Cannot partially cancel this order"))).toBe(true);
    expect(esErrorDeParcial(new Error("TikTok Shop 25001014 en /x: Invalid Parameter"))).toBe(false);
  });
});

describe("motivosUsadosEnCancelaciones: la lista real del mercado sale de lo que TikTok ya aceptó", () => {
  it("junta cancel_reason por rol, cuenta repeticiones, pagina y deja al vendedor con lo de stock primero", async () => {
    const llamadas: any[] = [];
    const cliente = {
      llamar: vi.fn(async (metodo: string, ruta: string, opciones: any) => {
        llamadas.push({ metodo, ruta, opciones });
        if (!opciones.params.page_token) {
          return {
            cancellations: [
              { order_id: "1", role: "BUYER", cancel_reason: "ecom_buyer_change_mind", cancel_reason_text: "Cambié de opinión" },
              { order_id: "2", role: "SELLER", cancel_reason: "ecom_seller_other", cancel_reason_text: "Otro" },
              { order_id: "3", role: "SELLER", cancel_reason: "ecom_seller_out_of_stock", cancel_reason_text: "Sin existencias" },
            ],
            next_page_token: "p2",
          };
        }
        return { cancellations: [{ order_id: "4", role: "seller", cancel_reason: "ecom_seller_out_of_stock" }, { order_id: "5", role: "SYSTEM", cancel_reason: "" }] };
      }),
      msRestantes: () => 100_000,
    } as unknown as Cliente;
    const usados = await motivosUsadosEnCancelaciones(cliente, { dias: 30 });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]).toMatchObject({ metodo: "POST", ruta: "/return_refund/202309/cancellations/search" });
    expect(llamadas[0].opciones.cuerpo).toMatchObject({ cancel_types: ["CANCEL"], locale: "es-MX" });
    expect(llamadas[1].opciones.params.page_token).toBe("p2");
    expect(usados.map((u) => `${u.rol}:${u.motivo}:${u.veces}`)).toEqual([
      "SELLER:ecom_seller_out_of_stock:2",
      "BUYER:ecom_buyer_change_mind:1",
      "SELLER:ecom_seller_other:1",
    ]);
    expect(motivosDeVendedor(usados)).toEqual(["ecom_seller_out_of_stock", "ecom_seller_other"]);
  });

  it("sin cancelaciones del vendedor no inventa nada", async () => {
    const cliente = { llamar: vi.fn(async () => ({ cancellations: [{ role: "BUYER", cancel_reason: "x" }] })), msRestantes: () => 1 } as unknown as Cliente;
    expect(motivosDeVendedor(await motivosUsadosEnCancelaciones(cliente))).toEqual([]);
  });
});
