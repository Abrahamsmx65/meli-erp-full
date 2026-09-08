import { beforeEach, describe, expect, it } from "vitest";
import {
  amazonParaCompras,
  limpiarCacheAmazonCompras,
  ventaDiariaCorregida,
} from "./fba";

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
  beforeEach(() => limpiarCacheAmazonCompras());

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
      // sin fotos del inventario: la corrección no aplica (corregida = real)
    });

    const { datos: mapa, advertencias } = await amazonParaCompras(db);
    expect(mapa.get("GT114-LT BROWN-26-MX")).toEqual({
      ventaDiaria: 1,
      ventaDiariaReal: 1,
      stock: 15,
    });
    expect(mapa.get("MY2307-BLK-25-MX")?.ventaDiaria).toBe(2);
    expect(mapa.has("FUNDA-999")).toBe(false);
    expect(advertencias).toEqual([
      "No se pudieron leer los días agotados de Amazon: amazon_inventario_snapshots: amazon_inventario_snapshots no existe",
    ]);
  });

  it("los días agotado (foto en cero y sin venta) no cuentan como días de venta", async () => {
    const db = dbSimulada({
      amazon_ventas_diarias: [
        { seller_sku: "GT114-BLK-25-MX", unidades: 15, fecha: "2026-08-20" },
      ],
      amazon_inventario: [
        { seller_sku: "GT114-BLK-25-MX", disponible: 0, en_transferencia: 0 },
      ],
      amazon_envios_entrantes: [],
      amazon_inventario_snapshots: [
        // 15 días con la foto en cero y sin venta: no cuentan.
        ...Array.from({ length: 15 }, (_, i) => ({
          seller_sku: "GT114-BLK-25-MX",
          fecha: `2026-08-${String(i + 1).padStart(2, "0")}`,
          disponible: 0,
        })),
        // El día que vendió la foto también decía cero (se agotó a media
        // jornada): ese día SÍ cuenta como día con stock.
        { seller_sku: "GT114-BLK-25-MX", fecha: "2026-08-20", disponible: 0 },
      ],
    });

    const { datos: mapa, advertencias } = await amazonParaCompras(db);
    const e = mapa.get("GT114-BLK-25-MX")!;
    expect(e.ventaDiariaReal).toBe(0.5); // 15 / 30
    expect(e.ventaDiaria).toBe(1); // 15 / (30 − 15) días efectivos
    expect(advertencias).toEqual([]);
  });

  it("declara una lectura parcial de envíos en vez de convertirla silenciosamente en cero", async () => {
    const db = dbSimulada({
      amazon_ventas_diarias: [
        { seller_sku: "GT114-BLK-25-MX", unidades: 30, fecha: "2026-08-20" },
      ],
      amazon_inventario: [
        { seller_sku: "GT114-BLK-25-MX", disponible: 5, en_transferencia: 7 },
      ],
      amazon_inventario_snapshots: [],
    });

    const { datos, advertencias } = await amazonParaCompras(db);

    expect(datos.get("GT114-BLK-25-MX")?.stock).toBe(12);
    expect(advertencias).toEqual([
      "No se pudieron leer los envíos entrantes de Amazon: amazon_envios_entrantes: amazon_envios_entrantes no existe",
    ]);
  });

  it("propaga la falla de una fuente obligatoria en vez de devolver un mapa vacío", async () => {
    const db = dbSimulada({
      amazon_inventario: [],
      amazon_envios_entrantes: [],
      amazon_inventario_snapshots: [],
    });

    await expect(amazonParaCompras(db)).rejects.toThrow(
      "amazon_ventas_diarias: amazon_ventas_diarias no existe",
    );
  });
});

describe("ventaDiariaCorregida (corrección por agotamiento, como MELI)", () => {
  it("sin días agotado la corregida es la observada", () => {
    expect(ventaDiariaCorregida(30, 0)).toBe(1);
  });

  it("divide entre los días con stock, no el calendario", () => {
    // 20 pares vendidos, 20 días agotado: vendía 2 al día, no 0.67.
    expect(ventaDiariaCorregida(20, 20)).toBe(2);
  });

  it("se topa en 3× lo observado para no extrapolar de más", () => {
    // 29 días agotado daría 30×; el tope la deja en 3 (= 1 × 3).
    expect(ventaDiariaCorregida(30, 29)).toBe(3);
  });

  it("sin ventas no hay nada que corregir", () => {
    expect(ventaDiariaCorregida(0, 25)).toBe(0);
  });
});
