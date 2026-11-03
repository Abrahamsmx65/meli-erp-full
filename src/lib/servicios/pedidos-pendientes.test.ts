import { describe, expect, it } from "vitest";
import { claveMedida, resumirPendientes, type LineaBase, type PedidoBase } from "./pedidos-pendientes";

const ped = (o: Partial<PedidoBase>): PedidoBase => ({
  id: "p1", pedido: "IN10184", proveedor: "Huaian Tengchuang Footwear Co., Ltd.", moneda: "USD",
  importe: null, estado: "creado", origen: "sistema", fecha: "2026-10-01", ...o,
});
const lin = (o: Partial<LineaBase>): LineaBase => ({
  id: "l1", pedidoId: "p1", modelo: "GT179", color: "BROWN", talla: "26", tallas: { "26": 264 },
  paresPorCaja: 12, cajas: 22, pares: 264, precio: 7.5, preciosTalla: null, cbmCaja: null, ...o,
});

describe("resumirPendientes: lo que falta por subir a un contenedor", () => {
  it("dinero y CBM de lo pendiente; lo que ya está en contenedor sale", () => {
    const r = resumirPendientes(
      [ped({}), ped({ id: "p2", pedido: "IN10160", proveedor: "JINJIANG HANDSOME SHOE CO.,LTD", moneda: "RMB", importe: 1100 })],
      [
        lin({}),
        lin({ id: "l2", talla: "27", cajas: 10, pares: 120, cbmCaja: 0.05 }),
        // corrida de JINJIANG: el importe de la proforma (1100) manda sobre precio × pares (1000)
        lin({ id: "l3", pedidoId: "p2", modelo: "GT161", talla: "", tallas: { "23": 5, "24": 5 }, paresPorCaja: 10, cajas: 10, pares: 100, precio: 10 }),
      ],
      new Map([["l2", 4], ["l3", 5]]),
      new Map([[claveMedida("GT179", 12), 0.1]]),
      Date.parse("2026-10-11"),
    );
    const a = r.pedidos.find((p) => p.pedido === "IN10184")!;
    expect(a.cajasPendientes).toBe(28);
    expect(a.paresPendientes).toBe(264 + 72);
    expect(a.dineroPendiente).toBeCloseTo(336 * 7.5, 2);
    expect(a.cbmPendiente).toBeCloseTo(22 * 0.1 + 6 * 0.05, 3);
    expect(a.dias).toBe(10);
    const b = r.pedidos.find((p) => p.pedido === "IN10160")!;
    expect(b.cajasPendientes).toBe(5);
    expect(b.dineroPendiente).toBeCloseTo(550, 2);
    expect(b.cajasSinMedida).toBe(5);
    expect(r.totales).toMatchObject({ pedidos: 2, cajas: 33, usd: 2520, rmb: 550, cajasSinMedida: 5 });
  });

  it("un pedido que ya subió completo a contenedores no aparece", () => {
    const r = resumirPendientes([ped({})], [lin({})], new Map([["l1", 22]]), new Map());
    expect(r.pedidos).toEqual([]);
  });
});
