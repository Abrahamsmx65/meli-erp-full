import { describe, expect, it } from "vitest";
import { columnasDeReclamos, destinoDeRevision, interpretarReclamo, skuDesdeOrdenCruda } from "./reclamos";

// Sonda real: orden 2000018121101480 (25-ago-2026), devolución parcial de 1 de 2 pares.
const RECLAMO = { id: 5566891373, resource_id: 2000018121101480, status: "closed", type: "returns", stage: "claim", reason_id: "PDD9939", quantity_type: "partial", claimed_quantity: 1, resolution: { reason: "warehouse_decision", benefited: ["complainant"], closed_by: "mediator", applied_coverage: true } };
const RETORNO = { id: 157986832, status: "delivered", status_money: "refunded", subtype: "return_partial", claim_id: 5566891373, orders: [{ order_id: 2000018121101480, item_id: "MLM4777832446", context_type: "partial", total_quantity: "2.0", return_quantity: "1.0", variation_id: 190434500144 }], shipments: [{ shipment_id: 47866153517, status: "delivered", destination: { name: "warehouse" }, type: "return" }] };
const ORDEN = { order_items: [{ item: { id: "MLM4777832446", variation_id: 190434500144, seller_sku: "GT114-BLK-29-MX" }, quantity: 2 }] };

describe("reclamos y devoluciones de MELI", () => {
  it("lee el reclamo y el retorno: 1 par de GT114-BLK-29-MX devuelto, dinero reembolsado, sin revisión leída → no recupera costo", () => {
    const r = interpretarReclamo(RECLAMO, RETORNO, null, skuDesdeOrdenCruda(ORDEN));
    expect(r).toMatchObject({ reclamoId: 5566891373, tipo: "returns", estado: "closed", razon: "PDD9939", beneficiado: ["complainant"], devolucionEstado: "delivered", devolucionDinero: "refunded", destino: "sin_revision" });
    expect(r.devolucionRenglones).toEqual([{ sku: "GT114-BLK-29-MX", unidades: 1, itemId: "MLM4777832446", variationId: 190434500144 }]);
    const cols = columnasDeReclamos([r]);
    expect(cols).toMatchObject({ reclamo_id: 5566891373, devolucion_destino: "sin_revision", devolucion_renglones: [{ sku: "GT114-BLK-29-MX", unidades: 1 }] });
  });

  it("el destino sale de la revisión del almacén; un retorno cancelado es no devuelto", () => {
    expect(destinoDeRevision({ status: "sellable" }, RETORNO)).toBe("a_la_venta");
    expect(destinoDeRevision({ status: "discarded" }, RETORNO)).toBe("descartado");
    expect(destinoDeRevision(null, { ...RETORNO, status: "cancelled" })).toBe("no_devuelto");
    expect(destinoDeRevision({ error: "404" }, RETORNO)).toBe("sin_revision");
  });

  it("sin reclamos deja constancia de la lectura y ningún destino", () => {
    expect(columnasDeReclamos([])).toMatchObject({ reclamo_id: null, devolucion_destino: null, reclamo_crudo: [] });
  });
});
