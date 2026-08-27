import { describe, expect, it } from "vitest";
import { planFbaConCajas } from "./fba-plan";
import { indexarCatalogo } from "../etiquetas/resolver";
import { normalizarParametros } from "../engine/params";
import type { CajaConstruida } from "../importar/cajas";
import type { RenglonAmazon } from "./amazon";

const parametros = normalizarParametros({});

function renglon(sku: string, unidades: number, disponible: number): RenglonAmazon {
  return {
    sku,
    titulo: null,
    asin: null,
    unidades,
    ordenes: unidades,
    importe: 0,
    disponible,
    enTransferencia: 0,
    totalFba: disponible,
    cobertura: null,
  };
}

function cajaCorrida(codigo: string, disponibles: number, skus: [string, string, number][]): CajaConstruida {
  return {
    codigo,
    cajasDisponibles: disponibles,
    items: skus.map(([sku, , piezas]) => ({ sku, piezas })),
    almacen: "Industher",
    codigoAlmacen: "IND",
    skuCaja: codigo,
    pedido: "IN10100",
    modelo: "GT1",
    color: "BLK",
    talla: "CORRIDA",
    esCorrida: true,
    paresPorCaja: skus.reduce((a, [, , p]) => a + p, 0),
    enCamino: 0,
    cajasApartadas: 0,
    contenedores: [],
    detalle: skus.map(([sku, talla, piezas]) => ({ sku, talla, piezas, origen: "exacto" as const })),
  } satisfies CajaConstruida;
}

const catalogoMeli = indexarCatalogo([{ sku: "GT1-BLK-23" }, { sku: "GT1-BLK-24" }]);

describe("plan FBA con el motor de cajas de bodega", () => {
  it("amarra el SKU de Amazon (talla antes del color) y elige cajas reales", () => {
    // Vende 4/día la 23 y 4/día la 24, nada en FBA. El objetivo cubre 30
    // días MÁS los 7 que el envío tarda en volverse vendible en Amazon:
    // 4 × 37 = 148 por talla (296 en total). La caja trae 12 y 12: salen 13
    // cajas (312 pares) — los 8 pares de sobra cuestan menos que dejar 2
    // días de venta descubiertos.
    const plan = planFbaConCajas({
      renglones: [renglon("GT1-23-BLK-MX", 120, 0), renglon("GT1-24-BLK-MX", 120, 0)],
      dias: 30,
      catalogo: [cajaCorrida("CAJA-GT1", 50, [["GT1-BLK-23", "23", 12], ["GT1-BLK-24", "24", 12]])],
      indiceMeli: catalogoMeli,
      parametros,
    });

    expect(plan.sinAmarre).toHaveLength(0);
    expect(plan.paresSugeridos).toBe(296);
    expect(plan.cajas).toHaveLength(1);
    expect(plan.cajas[0].cantidad).toBe(13);
    expect(plan.cajas[0].paresTotales).toBe(312);
  });

  it("un SKU de Amazon que no amarra con MELI se reporta, no se inventa", () => {
    const plan = planFbaConCajas({
      renglones: [renglon("ZAPATO-RARO-9", 60, 0)],
      dias: 30,
      catalogo: [],
      indiceMeli: catalogoMeli,
      parametros,
    });
    // No es calzado (no empieza con GT/MY/YH/G650): ni amarre ni plan.
    expect(plan.cajas).toHaveLength(0);

    const plan2 = planFbaConCajas({
      renglones: [renglon("GT9-99-XXX-MX", 60, 0)],
      dias: 30,
      catalogo: [],
      indiceMeli: catalogoMeli,
      parametros,
    });
    expect(plan2.sinAmarre).toHaveLength(1);
    expect(plan2.sinAmarre[0].sku).toBe("GT9-99-XXX-MX");
  });

  it("con FBA lleno no propone cajas", () => {
    const plan = planFbaConCajas({
      renglones: [renglon("GT1-23-BLK-MX", 60, 500)],
      dias: 30,
      catalogo: [cajaCorrida("CAJA-GT1", 50, [["GT1-BLK-23", "23", 24]])],
      indiceMeli: catalogoMeli,
      parametros,
    });
    expect(plan.paresSugeridos).toBe(0);
    expect(plan.cajas).toHaveLength(0);
  });

  it("el faltante que la bodega no puede tapar se reporta como sin caja", () => {
    const plan = planFbaConCajas({
      renglones: [renglon("GT1-24-BLK-MX", 120, 0)],
      dias: 30,
      catalogo: [cajaCorrida("CAJA-23", 10, [["GT1-BLK-23", "23", 24]])],
      indiceMeli: catalogoMeli,
      parametros,
    });
    expect(plan.cajas).toHaveLength(0);
    // 4/día × (30 + 7 de riesgo) = 148 pares que ninguna caja puede tapar.
    expect(plan.sinCajaEnBodega).toEqual([{ sku: "GT1-BLK-24", pares: 148 }]);
  });
});
