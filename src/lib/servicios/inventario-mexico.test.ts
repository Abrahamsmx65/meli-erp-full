import { describe, expect, it } from "vitest";
import { ALMACEN_CHINA, familiasMexico, type RenglonInventario } from "./inventario";

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

describe("familiasMexico", () => {
  it("junta todas las tallas y colores de la familia en un renglón", () => {
    const [gt128] = familiasMexico(
      [
        renglon({ sku: "GT128-23-BLK", talla: "23", enBodega: 48 }),
        renglon({ sku: "GT128-24-BLK", talla: "24", enBodega: 36 }),
        renglon({ sku: "GT128-23-NVY", talla: "23", color: "NAVY", enBodega: 12 }),
      ],
      { GT128: 4 },
    );

    expect(gt128.modelo).toBe("GT128");
    expect(gt128.pares).toBe(96);
    expect(gt128.colores).toBe(2);
    expect(gt128.detalle).toHaveLength(3);
  });

  it("cuenta las cajas una sola vez, no una por talla", () => {
    // Una caja de corrida con tres tallas: son 3 renglones pero 1 caja.
    const [gt114] = familiasMexico(
      [
        renglon({ sku: "GT114-23", modelo: "GT114", talla: "23", enBodega: 16,
          pedidos: [{ pedido: "IN10128", almacen: "Caseshop", cajas: 1, pares: 16 }] }),
        renglon({ sku: "GT114-24", modelo: "GT114", talla: "24", enBodega: 16,
          pedidos: [{ pedido: "IN10128", almacen: "Caseshop", cajas: 1, pares: 16 }] }),
        renglon({ sku: "GT114-25", modelo: "GT114", talla: "25", enBodega: 16,
          pedidos: [{ pedido: "IN10128", almacen: "Caseshop", cajas: 1, pares: 16 }] }),
      ],
      { GT114: 1 },
    );

    expect(gt114.cajas).toBe(1);
    expect(gt114.pares).toBe(48);
  });

  it("no cuenta lo que sigue viniendo de China", () => {
    const familias = familiasMexico(
      [
        renglon({ sku: "GT128-23-BLK", enBodega: 48 }),
        renglon({
          sku: "GT200-23-BLK",
          modelo: "GT200",
          enCamino: 300,
          pedidos: [{ pedido: "IN10200", almacen: ALMACEN_CHINA, cajas: 0, pares: 300 }],
        }),
      ],
      { GT128: 1, GT200: 0 },
    );

    expect(familias.map((f) => f.modelo)).toEqual(["GT128"]);
    expect(familias[0].pares).toBe(48);
  });

  it("ordena el desglose por color y luego por talla numérica", () => {
    const [f] = familiasMexico(
      [
        renglon({ sku: "GT128-25-NVY", color: "NAVY", talla: "25", enBodega: 1 }),
        renglon({ sku: "GT128-9-BLK", talla: "9", enBodega: 1 }),
        renglon({ sku: "GT128-23-BLK", talla: "23", enBodega: 1 }),
      ],
      { GT128: 1 },
    );

    expect(f.detalle.map((d) => `${d.color}-${d.talla}`)).toEqual([
      "BLACK-9",
      "BLACK-23",
      "NAVY-25",
    ]);
  });
});
