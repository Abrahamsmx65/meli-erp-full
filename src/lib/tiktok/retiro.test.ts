import { describe, expect, it } from "vitest";
import { MOTIVO_DESCUENTO, MOTIVO_RETIRO, planRetiro, referenciaDeRetiro } from "./retiro";

describe("retirar del almacén TikTok", () => {
  const fecha = "2026-10-20T14:35:12.345Z";

  it("retira lo DISPONIBLE y deja lo apartado en pedidos", () => {
    const p = planRetiro(
      [
        { sku: "GT148-M BROWN-26-MX", saldo: 13, apartado: 8 },
        { sku: "GT168-BLK-24-MX", saldo: 40, apartado: 0 },
      ],
      fecha,
    );
    expect(p.referencia).toBe("RETIRO-20261020T143512");
    expect(p.movimientos).toEqual([
      { sku: "GT148-M BROWN-26-MX", tipo: "salida", cantidad: 5, referencia: "RETIRO-20261020T143512", motivo: MOTIVO_RETIRO, fecha },
      { sku: "GT168-BLK-24-MX", tipo: "salida", cantidad: 40, referencia: "RETIRO-20261020T143512", motivo: MOTIVO_RETIRO, fecha },
    ]);
    expect(p.salidas3pl).toEqual([
      { orderId: "RETIRO-20261020T143512", sku: "GT148-M BROWN-26-MX", pares: 5 },
      { orderId: "RETIRO-20261020T143512", sku: "GT168-BLK-24-MX", pares: 40 },
    ]);
    expect(p.detalle).toEqual([
      { sku: "GT148-M BROWN-26-MX", retirados: 5, apartados: 8 },
      { sku: "GT168-BLK-24-MX", retirados: 40, apartados: 0 },
    ]);
    expect(p.sinDisponible).toEqual([]);
  });

  it("un SKU sin disponible (todo apartado, en cero o en rojo) no genera nada y se declara", () => {
    const p = planRetiro(
      [
        { sku: "A", saldo: 3, apartado: 3 },
        { sku: "B", saldo: 0, apartado: 0 },
        { sku: "C", saldo: -2, apartado: 0 },
        { sku: "A", saldo: 3, apartado: 3 },
      ],
      fecha,
    );
    expect(p.movimientos).toEqual([]);
    expect(p.sinDisponible).toEqual(["A", "B", "C"]);
  });

  it("la referencia es única por segundo y no lleva signos que Industher rechace", () => {
    expect(referenciaDeRetiro("2026-10-20T00:00:01.000Z")).toBe("RETIRO-20261020T000001");
    expect(referenciaDeRetiro("2026-10-20T00:00:01.000Z")).not.toBe(referenciaDeRetiro("2026-10-20T00:00:02.000Z"));
  });
});

describe("descontar una CANTIDAD del almacén TikTok", () => {
  const fecha = "2026-10-22T15:00:00.000Z";

  it("descuenta los pares tecleados y los topa a lo disponible, sin tocar lo apartado", () => {
    const p = planRetiro(
      [
        { sku: "GT100-BLK-24-MX", saldo: 50, apartado: 5, cantidad: 10 },
        { sku: "GT143-BLK-25-MX", saldo: 12, apartado: 4, cantidad: 20 },
      ],
      fecha,
    );
    expect(p.movimientos).toEqual([
      { sku: "GT100-BLK-24-MX", tipo: "salida", cantidad: 10, referencia: "RETIRO-20261022T150000", motivo: `${MOTIVO_DESCUENTO} (10 pares)`, fecha },
      { sku: "GT143-BLK-25-MX", tipo: "salida", cantidad: 8, referencia: "RETIRO-20261022T150000", motivo: `${MOTIVO_DESCUENTO} (20 pares)`, fecha },
    ]);
    expect(p.salidas3pl.map((x) => x.pares)).toEqual([10, 8]);
    expect(p.detalle).toEqual([
      { sku: "GT100-BLK-24-MX", retirados: 10, apartados: 5 },
      { sku: "GT143-BLK-25-MX", retirados: 8, apartados: 4, recortados: 12 },
    ]);
  });

  it("una cantidad en cero o inválida no mueve nada; sin cantidad sigue retirando todo", () => {
    const p = planRetiro(
      [
        { sku: "A", saldo: 9, apartado: 0, cantidad: 0 },
        { sku: "B", saldo: 9, apartado: 0, cantidad: Number.NaN },
        { sku: "C", saldo: 9, apartado: 2 },
      ],
      fecha,
    );
    expect(p.movimientos.map((m) => [m.sku, m.cantidad, m.motivo])).toEqual([["C", 7, MOTIVO_RETIRO]]);
    expect(p.sinDisponible).toEqual([]);
  });
});
