import { describe, expect, it } from "vitest";
import { MOTIVO_RETIRO, planRetiro, referenciaDeRetiro } from "./retiro";

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
