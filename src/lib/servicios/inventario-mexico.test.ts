import { describe, expect, it } from "vitest";
import {
  ALMACEN_CHINA,
  totalesMexicoPorSku,
  type RenglonInventario,
} from "./inventario";

function renglon(p: Partial<RenglonInventario>): RenglonInventario {
  return {
    sku: "GT128-23-BLK",
    modelo: "GT128",
    color: "BLACK",
    talla: "23",
    titulo: null,
    inventoryId: null,
    enFull: 0,
    enTransferencia: 0,
    enBodega: 0,
    enCamino: 0,
    total: 0,
    pedidos: [],
    almacenes: [],
    ...p,
  };
}

describe("totalesMexicoPorSku", () => {
  it("junta todas las bodegas de México en un solo renglón", () => {
    const [fila] = totalesMexicoPorSku([
      renglon({
        enBodega: 96,
        pedidos: [
          { pedido: "IN10128", almacen: "Caseshop", cajas: 1, pares: 48 },
          { pedido: "IN10128", almacen: "Industher", cajas: 1, pares: 48 },
        ],
      }),
    ]);

    expect(fila.cajas).toBe(2);
    expect(fila.pares).toBe(96);
  });

  it("no suma lo que sigue viniendo de China", () => {
    const [fila] = totalesMexicoPorSku([
      renglon({
        enBodega: 48,
        enCamino: 300,
        pedidos: [
          { pedido: "IN10128", almacen: "Caseshop", cajas: 1, pares: 48 },
          { pedido: "IN10200", almacen: ALMACEN_CHINA, cajas: 0, pares: 300 },
        ],
      }),
    ]);

    expect(fila.pares).toBe(48);
    expect(fila.cajas).toBe(1);
  });

  it("deja fuera los SKUs que no tienen nada aquí", () => {
    const filas = totalesMexicoPorSku([
      renglon({ sku: "GT128-23-BLK", enFull: 40 }),
      renglon({
        sku: "GT128-24-BLK",
        enCamino: 100,
        pedidos: [{ pedido: "IN10200", almacen: ALMACEN_CHINA, cajas: 0, pares: 100 }],
      }),
    ]);

    expect(filas).toEqual([]);
  });
});
