import { describe, expect, it } from "vitest";
import { fechaLedger, snapshotsDesdeLedger } from "./sync";

describe("fechas del Inventory Ledger", () => {
  it("lee los tres formatos con que Amazon manda la fecha", () => {
    expect(fechaLedger("2026-08-19")).toBe("2026-08-19");
    expect(fechaLedger("8/19/2026")).toBe("2026-08-19"); // mes/día/año (US)
    expect(fechaLedger("19.08.2026")).toBe("2026-08-19"); // día.mes.año (EU)
    expect(fechaLedger("no es fecha")).toBeNull();
    expect(fechaLedger("")).toBeNull();
  });
});

describe("snapshotsDesdeLedger", () => {
  const CTA = "cuenta-1";

  it("solo el saldo SELLABLE, sumado entre ubicaciones", () => {
    const fotos = snapshotsDesdeLedger(
      [
        { date: "2026-08-10", msku: "GT114-BLK-25-MX", disposition: "SELLABLE", "ending-warehouse-balance": "30", location: "MEX1" },
        { date: "2026-08-10", msku: "GT114-BLK-25-MX", disposition: "SELLABLE", "ending-warehouse-balance": "12", location: "MEX2" },
        { date: "2026-08-10", msku: "GT114-BLK-25-MX", disposition: "DEFECTIVE", "ending-warehouse-balance": "99", location: "MEX1" },
      ],
      CTA,
      "2026-08-01",
      "2026-08-10",
    );
    expect(fotos).toEqual([
      {
        account_id: CTA,
        seller_sku: "GT114-BLK-25-MX",
        fecha: "2026-08-10",
        disponible: 42,
        en_transferencia: 0,
        reservado: 0,
        total: 42,
        origen: "ledger",
      },
    ]);
  });

  it("los días sin renglón arrastran el último saldo (incluido el cero)", () => {
    // Renglón el día 10 con saldo 5 y el 13 con saldo 0: los días 11-12
    // conservan 5, y del 13 al 15 quedan en CERO — que son justo los días
    // agotado que la corrección necesita ver.
    const fotos = snapshotsDesdeLedger(
      [
        { date: "2026-08-10", msku: "A", disposition: "SELLABLE", "ending-warehouse-balance": "5" },
        { date: "2026-08-13", msku: "A", disposition: "SELLABLE", "ending-warehouse-balance": "0" },
      ],
      CTA,
      "2026-08-01",
      "2026-08-15",
    );
    const porFecha = Object.fromEntries(fotos.map((f) => [f.fecha, f.disponible]));
    expect(porFecha).toEqual({
      "2026-08-10": 5,
      "2026-08-11": 5,
      "2026-08-12": 5,
      "2026-08-13": 0,
      "2026-08-14": 0,
      "2026-08-15": 0,
    });
  });

  it("respeta la ventana: nada antes de `desde` ni después de `hasta`", () => {
    const fotos = snapshotsDesdeLedger(
      [
        { date: "2026-07-01", msku: "A", disposition: "SELLABLE", "ending-warehouse-balance": "7" },
        { date: "2026-08-20", msku: "A", disposition: "SELLABLE", "ending-warehouse-balance": "3" },
      ],
      CTA,
      "2026-08-18",
      "2026-08-19",
    );
    // El renglón de julio no aparece, pero su saldo SÍ se arrastra a la
    // ventana; el del 20 queda fuera por `hasta`.
    expect(fotos.map((f) => [f.fecha, f.disponible])).toEqual([
      ["2026-08-18", 7],
      ["2026-08-19", 7],
    ]);
  });
});
