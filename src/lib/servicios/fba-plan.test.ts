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

/**
 * Las mismas tres reglas de producto que el plan de Full, decididas por el
 * dueño en sep-2026, aplicadas a FBA: un producto que nunca ha vendido en
 * Amazon no tenía faltante y nunca salía en el envío ("no me sale para
 * mandar los productos nuevos").
 */
describe("plan FBA: reglas de producto NUEVO y SIN VENTA", () => {
  const catalogoMeli2 = indexarCatalogo([
    { sku: "GT1-BLK-23" },
    { sku: "GT1-BLK-24" },
    { sku: "GT2-RED-23" },
    { sku: "GT2-RED-24" },
  ]);
  const cajaGt2 = () => ({
    ...cajaCorrida("CAJA-GT2", 10, [["GT2-RED-23", "23", 12], ["GT2-RED-24", "24", 12]]),
    modelo: "GT2",
    color: "RED",
    producto: "GT2|RED",
  });
  const hoy = "2026-09-14";

  it("producto SIN VENTA con caja en bodega y publicación: viajan 2 cajas firmes", () => {
    const plan = planFbaConCajas({
      renglones: [renglon("GT2-23-RED-MX", 0, 0), renglon("GT2-24-RED-MX", 0, 0)],
      dias: 30,
      catalogo: [cajaGt2()],
      indiceMeli: catalogoMeli2,
      parametros,
      historia: new Map(),
      skusListados: new Set(["GT2-23-RED-MX"]),
      hoy,
    });
    expect(plan.avisos).toHaveLength(0);
    expect(plan.sinEstreno).toEqual([
      { producto: "GT2|RED", enPosicion: 0, cajas: 2, codigos: ["CAJA-GT2"] },
    ]);
    expect(plan.cajas).toHaveLength(1);
    expect(plan.cajas[0].cantidad).toBe(2);
    expect(plan.cajas[0].cantidadOpcional).toBe(0);
  });

  it("lo que ya tiene en FBA o en camino descuenta de la posición mínima", () => {
    const plan = planFbaConCajas({
      // 24 pares en FBA = una caja completa ya en posición: falta UNA.
      renglones: [renglon("GT2-23-RED-MX", 0, 12), renglon("GT2-24-RED-MX", 0, 12)],
      dias: 30,
      catalogo: [cajaGt2()],
      indiceMeli: catalogoMeli2,
      parametros,
      historia: new Map(),
      skusListados: new Set(["GT2-23-RED-MX"]),
      hoy,
    });
    expect(plan.sinEstreno[0]).toMatchObject({ enPosicion: 1, cajas: 1 });
    expect(plan.cajas[0].cantidad).toBe(1);
  });

  it("sin publicación en Amazon no hay a dónde mandarlo: nada", () => {
    const plan = planFbaConCajas({
      renglones: [renglon("GT2-23-RED-MX", 0, 0)],
      dias: 30,
      catalogo: [cajaGt2()],
      indiceMeli: catalogoMeli2,
      parametros,
      historia: new Map(),
      skusListados: new Set(),
      hoy,
    });
    expect(plan.sinEstreno).toHaveLength(0);
    expect(plan.cajas).toHaveLength(0);
  });

  it("si alguna talla vendió alguna vez en la historia, no es producto sin venta", () => {
    const plan = planFbaConCajas({
      renglones: [renglon("GT2-23-RED-MX", 0, 0), renglon("GT2-24-RED-MX", 0, 0)],
      dias: 30,
      catalogo: [cajaGt2()],
      indiceMeli: catalogoMeli2,
      parametros,
      historia: new Map([
        ["GT2-24-RED-MX", { unidades: 3, primeraVenta: "2025-10-01", primeraFoto: null }],
      ]),
      skusListados: new Set(["GT2-23-RED-MX"]),
      hoy,
    });
    expect(plan.sinEstreno).toHaveLength(0);
    expect(plan.cajas).toHaveLength(0);
  });

  it("sin historia de Amazon las reglas se apagan y el plan lo avisa", () => {
    const plan = planFbaConCajas({
      renglones: [renglon("GT2-23-RED-MX", 0, 0)],
      dias: 30,
      catalogo: [cajaGt2()],
      indiceMeli: catalogoMeli2,
      parametros,
      skusListados: new Set(["GT2-23-RED-MX"]),
      hoy,
    });
    expect(plan.avisos).toHaveLength(1);
    expect(plan.sinEstreno).toHaveLength(0);
    expect(plan.cajas).toHaveLength(0);
  });

  it("producto NUEVO: un faltante chico fuerza su caja, firme; uno viejo espera", () => {
    // 10 pares en 30 días por talla = 0.33/día → 13 pares para 37 días. La
    // caja trae 12 y 12: falta 1 par por talla, menos que la tolerancia de
    // rescate de 7 días (~2 pares) → un producto viejo se queda con 1 caja.
    const renglones = [renglon("GT1-23-BLK-MX", 10, 0), renglon("GT1-24-BLK-MX", 10, 0)];
    const catalogo = [
      { ...cajaCorrida("CAJA-GT1", 50, [["GT1-BLK-23", "23", 12], ["GT1-BLK-24", "24", 12]]), producto: "GT1|BLK" },
    ];
    const viejo = planFbaConCajas({
      renglones,
      dias: 30,
      catalogo,
      indiceMeli: catalogoMeli2,
      parametros,
      historia: new Map([
        ["GT1-23-BLK-MX", { unidades: 300, primeraVenta: "2025-09-01", primeraFoto: null }],
      ]),
      hoy,
    });
    expect(viejo.productosNuevos).toHaveLength(0);
    expect(viejo.cajas[0].cantidad).toBe(1);

    // El mismo producto estrenado hace 10 días: cualquier faltante fuerza
    // la segunda caja y va firme, nunca opcional.
    const nuevo = planFbaConCajas({
      renglones,
      dias: 30,
      catalogo,
      indiceMeli: catalogoMeli2,
      parametros,
      historia: new Map([
        ["GT1-23-BLK-MX", { unidades: 10, primeraVenta: "2026-09-04", primeraFoto: null }],
        ["GT1-24-BLK-MX", { unidades: 10, primeraVenta: "2026-09-05", primeraFoto: null }],
      ]),
      hoy,
    });
    expect(nuevo.productosNuevos).toEqual([
      { producto: "GT1|BLK", edad: 10, skus: ["GT1-BLK-23", "GT1-BLK-24"] },
    ]);
    expect(nuevo.cajas[0].cantidad).toBe(2);
    expect(nuevo.cajas[0].cantidadOpcional).toBe(0);
  });
});
