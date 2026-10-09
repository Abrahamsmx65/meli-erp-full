import { describe, expect, it } from "vitest";
import { pagosDefinitivos, resumirOrdenConMeli, type CacheTarifas } from "./pagos-api";
import { leerPagoMercadoPago } from "./pagos";

const pago = (status: string) =>
  leerPagoMercadoPago(
    {
      id: 1,
      status,
      transaction_amount: 100,
      transaction_details: { net_received_amount: 80 },
      charges_details: [{ name: "meli_fee", type: "fee", amounts: { original: 20, refunded: 0 }, accounts: { from: "collector", to: "ml" } }],
    },
    "v1/payments",
  );

describe("envío resuelto sin leer /costs", () => {
  it("solo un pago definitivo cuenta como resuelto", () => {
    expect(pagosDefinitivos([pago("approved")])).toBe(true);
    expect(pagosDefinitivos([pago("approved"), pago("pending")])).toBe(false);
    expect(pagosDefinitivos([])).toBe(false);
  });

  it("un pago aprobado sin cargo de envío queda con el envío leído y sin preguntar a MELI", async () => {
    const tarifas = {
      costoEnvio: () => {
        throw new Error("no debe preguntar");
      },
    } as unknown as CacheTarifas;
    const r = await resumirOrdenConMeli({} as any, {
      pagos: [pago("approved")],
      total: 100,
      comisionOrden: 20,
      contexto: { shippingId: 5 } as any,
      renglones: [],
      tarifas,
    });
    expect(r.envioLeido).toBe(true);
    const pendiente = await resumirOrdenConMeli({} as any, {
      pagos: [pago("in_process")],
      total: 100,
      comisionOrden: 20,
      contexto: { shippingId: 5 } as any,
      renglones: [],
      tarifas,
    });
    expect(pendiente.envioLeido).toBe(false);
  });
});
