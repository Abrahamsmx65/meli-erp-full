import { describe, expect, it } from "vitest";
import {
  coincideBusqueda,
  contarPorGrupo,
  diasDesde,
  grupoDeDevolucion,
  movimientosDeDecision,
  normalizarDevolucion,
  ordenarDevoluciones,
  porVencer,
  type Devolucion,
} from "./devoluciones";

const crudo = {
  return_id: "7001",
  order_id: "586377833013938023",
  return_status: "BUYER_SHIPPED_ITEM",
  return_type: "RETURN_AND_REFUND",
  return_tracking_number: "CNMEX-1061 099644",
  return_provider_name: "Cainiao MX",
  return_reason: "size_not_fit",
  return_reason_text: "No me quedó",
  refund_amount: { currency: "MXN", refund_total: "169.99", refund_subtotal: "169.99" },
  seller_next_action_response: { action: "SELLER_RESPOND_RECEIVE_PACKAGE", deadline: 1791600000 },
  create_time: 1791400000,
  update_time: 1791500000,
  return_line_items: [
    { return_line_item_id: "r1", order_line_item_id: "l1", sku_id: "s1", seller_sku: "GT148-M BROWN-RED-25-MX", product_name: "Botín GT148", refund_amount: { refund_total: "169.99" } },
    { return_line_item_id: "r2", order_line_item_id: "l2", sku_id: "s2", seller_sku: "GT148-BLK-24-MX", product_name: "Botín GT148" },
  ],
};

function base(extra: Partial<Devolucion> = {}): Devolucion {
  return {
    returnId: "1",
    orderId: "586",
    estado: "BUYER_SHIPPED_ITEM",
    tipo: "RETURN_AND_REFUND",
    siguienteAccion: null,
    plazo: null,
    guia: null,
    paqueteria: null,
    motivo: null,
    motivoTexto: null,
    reembolso: null,
    moneda: null,
    renglones: [],
    creadaEn: null,
    actualizadaEn: null,
    ...extra,
  };
}

describe("normalizarDevolucion", () => {
  it("lee la devolución de TikTok y amarra cada par al SKU del ERP por el renglón del pedido", () => {
    const d = normalizarDevolucion(crudo, new Map([["l1", "GT148-M BROWN-RED-25-MX"]]));
    expect(d.returnId).toBe("7001");
    expect(d.orderId).toBe("586377833013938023");
    expect(d.estado).toBe("BUYER_SHIPPED_ITEM");
    expect(d.siguienteAccion).toBe("SELLER_RESPOND_RECEIVE_PACKAGE");
    expect(d.plazo).toBe(new Date(1791600000 * 1000).toISOString());
    expect(d.guia).toBe("CNMEX-1061 099644");
    expect(d.reembolso).toBe(169.99);
    expect(d.moneda).toBe("MXN");
    expect(d.renglones).toHaveLength(2);
    expect(d.renglones[0].sku).toBe("GT148-M BROWN-RED-25-MX");
    expect(d.renglones[0].reembolso).toBe(169.99);
    // el segundo renglón no amarró: se declara, no se adivina por el seller_sku
    expect(d.renglones[1].sku).toBeNull();
    expect(d.renglones[1].sellerSku).toBe("GT148-BLK-24-MX");
  });
});

describe("grupoDeDevolucion", () => {
  it("el cliente ya la mandó → por recibir", () => {
    expect(grupoDeDevolucion(base())).toBe("por_recibir");
    expect(grupoDeDevolucion(base({ estado: "AWAITING_BUYER_SHIP", siguienteAccion: "SELLER_RESPOND_RECEIVE_PACKAGE" }))).toBe("por_recibir");
  });
  it("aprobada sin mandar, solicitada, terminada y cerrada", () => {
    expect(grupoDeDevolucion(base({ estado: "AWAITING_BUYER_SHIP" }))).toBe("esperando_cliente");
    expect(grupoDeDevolucion(base({ estado: "RETURN_OR_REFUND_REQUEST_PENDING" }))).toBe("pendiente_tiktok");
    expect(grupoDeDevolucion(base({ estado: "RETURN_OR_REFUND_REQUEST_SUCCESS" }))).toBe("recibida");
    expect(grupoDeDevolucion(base({ estado: "RETURN_OR_REFUND_REQUEST_COMPLETE" }))).toBe("recibida");
    expect(grupoDeDevolucion(base({ estado: "REFUND_OR_RETURN_REQUEST_REJECT" }))).toBe("cerrada");
    expect(grupoDeDevolucion(base({ estado: "RETURN_OR_REFUND_REQUEST_CANCEL" }))).toBe("cerrada");
  });
  it("un reembolso sin paquete de regreso nunca es una devolución recibida", () => {
    expect(grupoDeDevolucion(base({ estado: "RETURN_OR_REFUND_REQUEST_SUCCESS", tipo: "REFUND" }))).toBe("cerrada");
  });
});

describe("coincideBusqueda", () => {
  const d = base({
    guia: "CNMEX-1061 099644",
    orderId: "586377833013938023",
    returnId: "7001",
    renglones: [{ returnLineItemId: "r1", orderLineItemId: "l1", skuId: null, sellerSku: null, sku: "GT148-BLK-24-MX", producto: null, reembolso: null }],
  });
  it("encuentra por guía escaneada aunque traiga guiones o espacios", () => {
    expect(coincideBusqueda(d, "cnmex1061099644")).toBe(true);
    expect(coincideBusqueda(d, "1061 099")).toBe(true);
  });
  it("encuentra por pedido y por SKU", () => {
    expect(coincideBusqueda(d, "586377833013938023")).toBe(true);
    expect(coincideBusqueda(d, "gt148 blk 24")).toBe(true);
  });
  it("con menos de 4 caracteres no busca nada", () => {
    expect(coincideBusqueda(d, "58")).toBe(false);
    expect(coincideBusqueda(d, "")).toBe(false);
  });
});

describe("movimientosDeDecision", () => {
  const d = base({
    orderId: "586",
    returnId: "7001",
    renglones: [
      { returnLineItemId: "r1", orderLineItemId: "l1", skuId: null, sellerSku: null, sku: "GT148-BLK-24-MX", producto: null, reembolso: null },
      { returnLineItemId: "r2", orderLineItemId: "l2", skuId: null, sellerSku: null, sku: "GT148-BLK-24-MX", producto: null, reembolso: null },
      { returnLineItemId: "r3", orderLineItemId: "l3", skuId: null, sellerSku: null, sku: "GT148-BLK-25-MX", producto: null, reembolso: null },
    ],
  });
  it("al stock: una devolución por SKU, con los pares juntos y el pedido de referencia", () => {
    const r = movimientosDeDecision(d, [{ returnLineItemId: "r1", destino: "stock" }, { returnLineItemId: "r2", destino: "stock" }, { returnLineItemId: "r3", destino: "stock" }], "2026-10-09T00:00:00Z");
    expect(r.sinSku).toEqual([]);
    expect(r.sinDecision).toEqual([]);
    expect(r.movimientos).toEqual([
      expect.objectContaining({ sku: "GT148-BLK-24-MX", tipo: "devolucion", cantidad: 2, referencia: "586" }),
      expect.objectContaining({ sku: "GT148-BLK-25-MX", tipo: "devolucion", cantidad: 1, referencia: "586" }),
    ]);
  });
  it("a la basura: la devolución entra y sale como merma, para que quede constancia", () => {
    const r = movimientosDeDecision(d, [{ returnLineItemId: "r1", destino: "basura" }, { returnLineItemId: "r2", destino: "stock" }, { returnLineItemId: "r3", destino: "basura" }], "2026-10-09T00:00:00Z");
    expect(r.movimientos.map((m) => `${m.tipo}|${m.sku}|${m.cantidad}`)).toEqual([
      "devolucion|GT148-BLK-24-MX|2",
      "devolucion|GT148-BLK-25-MX|1",
      "merma|GT148-BLK-24-MX|1",
      "merma|GT148-BLK-25-MX|1",
    ]);
  });
  it("un par sin SKU del ERP o sin decisión no mueve nada y se declara", () => {
    const sinSku = base({ renglones: [{ ...d.renglones[0], sku: null }, d.renglones[2]] });
    const r = movimientosDeDecision(sinSku, [{ returnLineItemId: "r1", destino: "stock" }], "2026-10-09T00:00:00Z");
    expect(r.sinSku.map((x) => x.returnLineItemId)).toEqual(["r1"]);
    expect(r.sinDecision.map((x) => x.returnLineItemId)).toEqual(["r3"]);
    expect(r.movimientos).toEqual([]);
  });
});

describe("orden, conteo y plazo", () => {
  const ahora = Date.parse("2026-10-09T12:00:00Z");
  const lista = [
    base({ returnId: "cerrada", estado: "RETURN_OR_REFUND_REQUEST_CANCEL", creadaEn: "2026-10-08T00:00:00Z" }),
    base({ returnId: "tarde", plazo: "2026-10-12T00:00:00Z", creadaEn: "2026-10-01T00:00:00Z" }),
    base({ returnId: "urgente", plazo: "2026-10-10T00:00:00Z", creadaEn: "2026-10-05T00:00:00Z" }),
    base({ returnId: "espera", estado: "AWAITING_BUYER_SHIP", creadaEn: "2026-10-07T00:00:00Z" }),
    base({ returnId: "hecha", estado: "RETURN_OR_REFUND_REQUEST_SUCCESS", creadaEn: "2026-10-06T00:00:00Z" }),
  ];
  it("primero lo que hay que recibir por plazo, luego en camino, solicitadas, recibidas y cerradas", () => {
    expect(ordenarDevoluciones(lista).map((d) => d.returnId)).toEqual(["urgente", "tarde", "espera", "hecha", "cerrada"]);
  });
  it("cuenta por grupo y detecta las que vencen en 48 horas", () => {
    expect(contarPorGrupo(lista)).toEqual({ por_recibir: 2, esperando_cliente: 1, pendiente_tiktok: 0, recibida: 1, cerrada: 1 });
    expect(porVencer(lista, ahora).map((d) => d.returnId)).toEqual(["urgente"]);
    expect(diasDesde("2026-10-05T00:00:00Z", ahora)).toBe(4);
    expect(diasDesde(null, ahora)).toBeNull();
  });
});
