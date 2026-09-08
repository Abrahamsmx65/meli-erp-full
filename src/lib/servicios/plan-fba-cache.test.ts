import { describe, expect, it } from "vitest";
import { marcarTipos, revivirTipos } from "./plan-fba-cache";

/**
 * El plan de FBA guardado en `plan_fba_cache` trae Maps adentro (el en
 * camino por SKU, los sobrantes por caja). Si el viaje por JSON los pierde,
 * la pantalla de /amazon truena o enseña ceros: el aplanado tiene que ser
 * EXACTO de ida y de vuelta.
 */
describe("marcarTipos / revivirTipos", () => {
  it("las estructuras del plan sobreviven el viaje por JSON tal cual", () => {
    const original = {
      totales: { skus: 120, unidades: 3400, importe: 125000.55 },
      enCamino: {
        porSku: new Map<string, number>([
          ["GT114-LT BROWN-26", 30],
          ["GT128-23-BLK-MX", 12],
        ]),
        viejos: [{ shipmentId: "FBA123", nombre: null, estado: "SHIPPED", pares: 8 }],
        paresViejos: 8,
        enviosVigentes: 2,
      },
      desglose: {
        deMasPorCaja: new Map([["GT114-DK-25-30", [{ talla: "25", pares: 2 }]]]),
        totalDeMas: 2,
      },
      conjunto: new Set(["mitad_corrida", "solo_7_dias"]),
      generado: new Date("2026-09-07T12:34:56.000Z"),
      sinVenta: null,
      anidado: [{ interno: new Map<number, unknown>([[1, { s: new Set([3]) }]]) }],
    };

    // El mismo viaje que hace el dato: a jsonb (JSON plano) y de regreso.
    const json = JSON.parse(JSON.stringify(marcarTipos(original)));
    const revivido = revivirTipos(json);

    expect(revivido.totales).toEqual(original.totales);
    expect(revivido.enCamino.porSku).toEqual(original.enCamino.porSku);
    expect(revivido.enCamino.viejos).toEqual(original.enCamino.viejos);
    expect(revivido.desglose.deMasPorCaja).toEqual(original.desglose.deMasPorCaja);
    expect(revivido.conjunto).toEqual(original.conjunto);
    expect(revivido.generado).toEqual(original.generado);
    expect(revivido.sinVenta).toBeNull();
    expect(revivido.anidado[0].interno.get(1).s).toEqual(new Set([3]));
  });

  it("un número no finito no se vuelve null (JSON lo perdería)", () => {
    const json = JSON.parse(JSON.stringify(marcarTipos({ cobertura: Infinity })));
    expect(revivirTipos(json).cobertura).toBe(Infinity);
  });
});
