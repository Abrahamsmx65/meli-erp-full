import { describe, expect, it } from "vitest";
import { decidirPedido, renglonesDelSku } from "./bloqueos";

const r = (lineItemId: string, sku: string, opts: Partial<{ skuId: string | null; estado: string; bloqueado: boolean; cantidad: number }> = {}) => ({
  lineItemId,
  skuId: opts.skuId === undefined ? `id-${sku}` : opts.skuId,
  sku,
  cantidad: opts.cantidad ?? 1,
  estado: opts.estado ?? "AWAITING_SHIPMENT",
  bloqueado: opts.bloqueado ?? false,
});

describe("decidirPedido", () => {
  it("sin bloqueos: nada que cancelar, todo se confirma", () => {
    const d = decidirPedido([r("1", "GT114-BLK-25-MX"), r("2", "GT150-CAMEL-27-MX")]);
    expect(d.cancelar).toEqual([]);
    expect(d.quedan.map((x) => x.lineItemId)).toEqual(["1", "2"]);
    expect(d.todoBloqueado).toBe(false);
  });

  it("un SKU bloqueado en un pedido grande: se cancela ese y se confirma el resto", () => {
    const d = decidirPedido([
      r("1", "GT114-BLK-25-MX", { bloqueado: true }),
      r("2", "GT114-BLK-25-MX", { bloqueado: true }),
      r("3", "GT150-CAMEL-27-MX"),
    ]);
    expect(d.cancelar).toEqual([{ skuId: "id-GT114-BLK-25-MX", sku: "GT114-BLK-25-MX", cantidad: 2, lineItemIds: ["1", "2"] }]);
    expect(d.quedan.map((x) => x.lineItemId)).toEqual(["3"]);
    expect(d.todoBloqueado).toBe(false);
  });

  it("todo bloqueado: el pedido se cancela completo y no se confirma nada", () => {
    const d = decidirPedido([r("1", "GT114-BLK-25-MX", { bloqueado: true })]);
    expect(d.todoBloqueado).toBe(true);
    expect(d.quedan).toEqual([]);
  });

  it("lo ya cancelado en TikTok no cuenta: ni se cancela ni se confirma", () => {
    const d = decidirPedido([
      r("1", "GT114-BLK-25-MX", { estado: "CANCELLED", bloqueado: true }),
      r("2", "GT150-CAMEL-27-MX"),
    ]);
    expect(d.cancelar).toEqual([]);
    expect(d.quedan.map((x) => x.lineItemId)).toEqual(["2"]);
    expect(d.todoBloqueado).toBe(false);
  });

  it("un bloqueado sin sku_id se declara: TikTok no lo puede cancelar por SKU", () => {
    const d = decidirPedido([r("1", "RARO", { skuId: null, bloqueado: true }), r("2", "GT150-CAMEL-27-MX")]);
    expect(d.sinSkuId.map((x) => x.lineItemId)).toEqual(["1"]);
    expect(d.cancelar).toEqual([]);
  });
});

describe("renglonesDelSku", () => {
  it("toma los renglones vivos y no bloqueados de ese SKU, sin importar mayúsculas", () => {
    const lista = [
      r("1", "GT114-BLK-25-MX"),
      r("2", "gt114-blk-25-mx"),
      r("3", "GT114-BLK-25-MX", { bloqueado: true }),
      r("4", "GT114-BLK-25-MX", { estado: "CANCELLED" }),
      r("5", "GT150-CAMEL-27-MX"),
    ];
    expect(renglonesDelSku(lista, "GT114-BLK-25-MX").map((x) => x.lineItemId)).toEqual(["1", "2"]);
  });
});
