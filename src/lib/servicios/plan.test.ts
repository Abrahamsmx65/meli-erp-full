import { describe, expect, it } from "vitest";
import { prioridadAlmacen, reasignarPorBodega } from "./plan";
import type { CajaConstruida } from "../importar/cajas";

function caja(codigo: string, almacen: string, disponibles: number): CajaConstruida {
  return {
    codigo,
    nombre: null,
    cajasDisponibles: disponibles,
    items: [{ sku: "GT1-BLK-25", piezas: 24 }],
    almacen,
    codigoAlmacen: "",
    skuCaja: "GT1-BLK",
    pedido: "P1",
    modelo: "GT1",
    color: "BLK",
    talla: "corrida",
    esCorrida: true,
    paresPorCaja: 24,
    enCamino: 0,
    contenedores: [],
    detalle: [{ sku: "GT1-BLK-25", talla: "25", piezas: 24 }],
  } as unknown as CajaConstruida;
}

describe("prioridad de bodega", () => {
  it("Industher primero, EnvioPack al final", () => {
    expect(prioridadAlmacen("Industher")).toBeLessThan(prioridadAlmacen("Caseshop"));
    expect(prioridadAlmacen("Caseshop")).toBeLessThan(prioridadAlmacen("EnvioPack"));
  });

  it("la misma caja en dos bodegas sale de la preferida", () => {
    const catalogo = [caja("EP-1", "EnvioPack", 10), caja("IN-1", "Industher", 3)];
    const elegidas = [
      { codigo: "EP-1", nombre: null, cantidad: 5, piezasPorCaja: 24, aporta: [] },
    ];

    const r = reasignarPorBodega(elegidas, catalogo);
    const por = new Map(r.map((x) => [x.codigo, x.cantidad]));

    // Industher se llena hasta su tope y EnvioPack solo carga el resto.
    expect(por.get("IN-1")).toBe(3);
    expect(por.get("EP-1")).toBe(2);
    // Ni una caja de más ni de menos.
    expect(r.reduce((a, x) => a + x.cantidad, 0)).toBe(5);
  });

  it("no toca cajas sin equivalente en otra bodega", () => {
    const catalogo = [caja("EP-1", "EnvioPack", 10)];
    const elegidas = [
      { codigo: "EP-1", nombre: null, cantidad: 4, piezasPorCaja: 24, aporta: [] },
    ];
    const r = reasignarPorBodega(elegidas, catalogo);
    expect(r).toHaveLength(1);
    expect(r[0].cantidad).toBe(4);
  });
});
