import { describe, expect, it } from "vitest";
import { amazonParaCompras } from "./fba";

/**
 * Supabase simulado con lo mínimo que traerTodo usa: from().select() con
 * filtros encadenables, order() y range(), y el conteo estimado con head.
 * Reproduce el camino EXACTO de amazonParaCompras.
 */
function dbSimulada(tablas: Record<string, any[]>) {
  function consulta(tabla: string, conConteo: boolean) {
    const q: any = {
      _rango: [0, 999],
      gte: () => q,
      eq: () => q,
      order: () => q,
      range: (a: number, b: number) => {
        q._rango = [a, b];
        return q;
      },
      then: (res: (x: any) => void) => {
        const filas = tablas[tabla];
        if (!filas) {
          return Promise.resolve({ data: null, error: { message: `${tabla} no existe` }, count: null }).then(res);
        }
        if (conConteo) {
          return Promise.resolve({ data: null, error: null, count: filas.length }).then(res);
        }
        const [a, b] = q._rango;
        return Promise.resolve({ data: filas.slice(a, b + 1), error: null, count: null }).then(res);
      },
    };
    return q;
  }
  return {
    from: (tabla: string) => ({
      select: (_c: string, opts?: { head?: boolean }) => consulta(tabla, Boolean(opts?.head)),
    }),
  } as any;
}

describe("amazonParaCompras (con la base simulada)", () => {
  it("suma venta y stock de Amazon, con el en-camino vigente de los envíos entrantes", async () => {
    const db = dbSimulada({
      amazon_ventas_diarias: [
        { seller_sku: "GT114-LT BROWN-26-MX", unidades: 30, fecha: "2026-08-20" },
        { seller_sku: "MY2307-BLK-25-MX", unidades: 60, fecha: "2026-08-21" },
        { seller_sku: "FUNDA-999", unidades: 99, fecha: "2026-08-21" }, // no calzado
      ],
      amazon_inventario: [
        { seller_sku: "GT114-LT BROWN-26-MX", disponible: 5, en_transferencia: 30 },
      ],
      amazon_envios_entrantes: [
        // vigente: 10 pendientes; viejo: 20 que NO deben contar
        { shipment_id: "A", seller_sku: "GT114-LT BROWN-26-MX", estado: "SHIPPED", enviado: 10, recibido: 0, vigente: true },
        { shipment_id: "B", seller_sku: "GT114-LT BROWN-26-MX", estado: "RECEIVING", enviado: 20, recibido: 0, vigente: false },
      ],
    });

    const mapa = await amazonParaCompras(db);
    expect(mapa.get("GT114-LT BROWN-26-MX")).toEqual({ ventaDiaria: 1, stock: 15 });
    expect(mapa.get("MY2307-BLK-25-MX")?.ventaDiaria).toBe(2);
    expect(mapa.has("FUNDA-999")).toBe(false);
  });
});
