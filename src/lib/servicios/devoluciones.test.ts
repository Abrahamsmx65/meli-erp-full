import { describe, expect, it } from "vitest";
import { leerPago, peorEstadoPago, tocaRevision } from "./devoluciones";

describe("leerPago", () => {
  it("lee neto, reembolso y estado en las formas que devuelve Mercado Pago", () => {
    expect(leerPago({ status: "approved", net_received_amount: 120.5, transaction_amount_refunded: 0 })).toEqual({
      estado: "approved",
      neto: 120.5,
      reembolsado: 0,
    });
    expect(
      leerPago({ status: "refunded", transaction_details: { net_received_amount: "98.10" }, amount_refunded: 200 }),
    ).toEqual({ estado: "refunded", neto: 98.1, reembolsado: 200 });
    expect(leerPago({ collection: { status: "approved", net_received_amount: 5 } })).toEqual({
      estado: "approved",
      neto: 5,
      reembolsado: 0,
    });
    expect(leerPago(null)).toEqual({ estado: null, neto: null, reembolsado: 0 });
  });
});

describe("peorEstadoPago", () => {
  it("con varios pagos manda el peor", () => {
    expect(peorEstadoPago(["approved", "refunded"])).toBe("refunded");
    expect(peorEstadoPago(["approved", "rejected"])).toBe("rejected");
    expect(peorEstadoPago(["charged_back", "refunded"])).toBe("charged_back");
    expect(peorEstadoPago([null, "approved"])).toBe("approved");
    expect(peorEstadoPago([])).toBeNull();
  });
});

describe("tocaRevision", () => {
  it("revisa a los 10 y a los 40 días, o todo al hacer el corte", () => {
    expect(tocaRevision("2026-09-01", 0, "2026-09-07")).toBe(false);
    expect(tocaRevision("2026-08-25", 0, "2026-09-07")).toBe(true);
    expect(tocaRevision("2026-08-25", 1, "2026-09-07")).toBe(false);
    expect(tocaRevision("2026-07-25", 1, "2026-09-07")).toBe(true);
    expect(tocaRevision("2026-07-25", 2, "2026-09-07")).toBe(false);
    expect(tocaRevision("2026-09-06", 0, "2026-09-07", true)).toBe(true);
    expect(tocaRevision("2026-09-06", 2, "2026-09-07", true)).toBe(false);
  });
});
