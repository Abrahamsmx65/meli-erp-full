import { describe, expect, it } from "vitest";
import { autoBloqueos, decidirPedido, paresFisicos, renglonesDelSku, stockEnDuda } from "./bloqueos";

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

describe("paresFisicos", () => {
  it("es el menor entre el kardex y el estante ajustado por las salidas que el 3PL no ha descontado", () => {
    expect(paresFisicos({ sku: "x", saldo: 5, estante: 8, salidasPendientes: 2, contadoDespues: false })).toBe(5);
    expect(paresFisicos({ sku: "x", saldo: 5, estante: 4, salidasPendientes: 2, contadoDespues: false })).toBe(2);
  });
  it("sin lectura del estante, o contado a mano después, manda el kardex", () => {
    expect(paresFisicos({ sku: "x", saldo: 5, estante: null, salidasPendientes: 0, contadoDespues: false })).toBe(5);
    expect(paresFisicos({ sku: "x", saldo: 5, estante: 1, salidasPendientes: 0, contadoDespues: true })).toBe(5);
  });
  it("nunca negativo", () => {
    expect(paresFisicos({ sku: "x", saldo: -1, estante: null, salidasPendientes: 0, contadoDespues: false })).toBe(0);
  });
});

describe("autoBloqueos", () => {
  const p = (lineItemId: string, orderId: string, sku: string, creadoEn: string | null, estado = "AWAITING_SHIPMENT") => ({
    lineItemId, orderId, sku, creadoEn, estado, skuId: `id-${sku}`, cantidad: 1, bloqueado: false,
  });
  const stock = (sku: string, saldo: number, estante: number | null = null) =>
    [sku, { sku, saldo, estante, salidasPendientes: 0, contadoDespues: false }] as const;

  it("con stock para todos no bloquea nada", () => {
    const r = autoBloqueos([p("1", "A", "GT1-BLK-25", "2026-09-15T10:00:00Z"), p("2", "B", "GT1-BLK-25", "2026-09-15T11:00:00Z")], new Map([stock("GT1-BLK-25", 2)]));
    expect(r).toEqual([]);
  });

  it("si piden más de lo que hay, pierden los pedidos más nuevos", () => {
    const r = autoBloqueos(
      [
        p("2", "B", "GT1-BLK-25", "2026-09-15T11:00:00Z"),
        p("1", "A", "GT1-BLK-25", "2026-09-15T10:00:00Z"),
        p("3", "C", "GT1-BLK-25", "2026-09-15T12:00:00Z"),
      ],
      new Map([stock("GT1-BLK-25", 1)]),
    );
    expect(r.map((x) => x.orderId)).toEqual(["B", "C"]);
    expect(r[0].motivo).toBe("auto: sin stock (hay 1, piden 3)");
  });

  it("el estante manda cuando es menor que el kardex (la regla de publicar el menor)", () => {
    const r = autoBloqueos([p("1", "A", "GT1-BLK-25", "2026-09-15T10:00:00Z")], new Map([stock("GT1-BLK-25", 3, 0)]));
    expect(r.map((x) => x.lineItemId)).toEqual(["1"]);
  });

  it("un SKU sin dato de stock no se toca: cancelar a ciegas también es error", () => {
    expect(autoBloqueos([p("1", "A", "RARO-1-1", "2026-09-15T10:00:00Z")], new Map())).toEqual([]);
  });

  it("solo entra lo apartado: lo ya confirmado o cancelado no se bloquea", () => {
    const r = autoBloqueos(
      [p("1", "A", "GT1-BLK-25", "2026-09-15T10:00:00Z", "AWAITING_COLLECTION"), p("2", "B", "GT1-BLK-25", "2026-09-15T11:00:00Z", "CANCELLED")],
      new Map([stock("GT1-BLK-25", 0)]),
    );
    expect(r).toEqual([]);
  });

  it("un pedido sin fecha cuenta como el más nuevo", () => {
    const r = autoBloqueos([p("1", "A", "GT1-BLK-25", null), p("2", "B", "GT1-BLK-25", "2026-09-15T10:00:00Z")], new Map([stock("GT1-BLK-25", 1)]));
    expect(r.map((x) => x.orderId)).toEqual(["A"]);
  });
});

describe("esBloqueoAutomatico", () => {
  it("reconoce el motivo automático por su prefijo; uno a mano no", async () => {
    const { esBloqueoAutomatico, PREFIJO_AUTO } = await import("./bloqueos");
    expect(esBloqueoAutomatico(`${PREFIJO_AUTO} sin stock (hay 0, piden 1)`)).toBe(true);
    expect(esBloqueoAutomatico("falla del 14-sep")).toBe(false);
    expect(esBloqueoAutomatico(null)).toBe(false);
  });
});

describe("stock en duda (la bodega dejó de reportar el SKU y el kardex aún tiene pares)", () => {
  const r = (lineItemId: string, orderId: string, creadoEn: string) => ({
    lineItemId, orderId, skuId: "s", sku: "MY2304-BROWN-29", cantidad: 1, estado: "AWAITING_SHIPMENT", bloqueado: false, creadoEn,
  });
  it("estante en cero con kardex arriba de cero es duda; un contado después no", () => {
    expect(stockEnDuda({ sku: "x", saldo: 21, estante: 0, salidasPendientes: 0, contadoDespues: false })).toBe(true);
    expect(stockEnDuda({ sku: "x", saldo: 21, estante: 0, salidasPendientes: 0, contadoDespues: true })).toBe(false);
    expect(stockEnDuda({ sku: "x", saldo: 0, estante: 0, salidasPendientes: 0, contadoDespues: false })).toBe(false);
    expect(stockEnDuda({ sku: "x", saldo: 21, estante: 2, salidasPendientes: 0, contadoDespues: false })).toBe(false);
    expect(stockEnDuda({ sku: "x", saldo: 21, estante: null, salidasPendientes: 0, contadoDespues: false })).toBe(false);
  });
  it("marca TODOS los renglones del SKU como en duda, sin bloquearlos para cancelar", () => {
    const stock = new Map([["MY2304-BROWN-29", { sku: "MY2304-BROWN-29", saldo: 21, estante: 0, salidasPendientes: 0, contadoDespues: false }]]);
    const salida = autoBloqueos([r("a", "1", "2026-09-18T00:00:00Z"), r("b", "2", "2026-09-19T00:00:00Z")], stock);
    expect(salida).toHaveLength(2);
    expect(salida.every((a) => a.enDuda)).toBe(true);
    expect(salida[0].motivo).toContain("stock en duda");
  });
  it("una baja PARCIAL sigue siendo merma y bloquea como antes", () => {
    const stock = new Map([["MY2304-BROWN-29", { sku: "MY2304-BROWN-29", saldo: 5, estante: 1, salidasPendientes: 0, contadoDespues: false }]]);
    const salida = autoBloqueos([r("a", "1", "2026-09-18T00:00:00Z"), r("b", "2", "2026-09-19T00:00:00Z")], stock);
    expect(salida.map((a) => a.lineItemId)).toEqual(["b"]);
    expect(salida[0].enDuda).toBeUndefined();
  });
});
