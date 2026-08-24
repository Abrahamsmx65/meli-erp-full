import { describe, expect, it } from "vitest";
import { optimizarCajas } from "../engine/boxes";
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

  it("un SKU disponible en dos bodegas NO se manda doble", () => {
    // La necesidad es GLOBAL: 48 pares. La misma caja de 24 existe en dos
    // bodegas con 5 disponibles cada una. Lo correcto son 2 cajas en total
    // (una bodega sola alcanza), jamás 2 por bodega.
    const dosBodegas = [
      { codigo: "IN-1", cajasDisponibles: 5, items: [{ sku: "GT1-BLK-25", piezas: 24 }] },
      { codigo: "EP-1", cajasDisponibles: 5, items: [{ sku: "GT1-BLK-25", piezas: 24 }] },
    ];
    const r = optimizarCajas({
      necesidad: new Map([["GT1-BLK-25", 48]]),
      prioridad: new Map(),
      cajas: dosBodegas,
      permiteUnidadesSueltas: false,
      inventarioSuelto: new Map(),
      pesoFaltante: 3,
      pesoSobrante: 1,
    });

    expect(r.enviadoPorSku.get("GT1-BLK-25")).toBe(48);
    expect(r.totalCajas).toBe(2);

    // Y tras la reasignación por bodega, ambas salen de Industher.
    const catalogo = [caja("IN-1", "Industher", 5), caja("EP-1", "EnvioPack", 5)];
    const finales = reasignarPorBodega(
      r.cajas.map((c) => ({
        codigo: c.codigo,
        nombre: null,
        cantidad: c.cantidad,
        piezasPorCaja: c.piezasPorCaja,
        aporta: [],
      })),
      catalogo,
    );
    const por = new Map(finales.map((x) => [x.codigo, x.cantidad]));
    expect(por.get("IN-1") ?? 0).toBe(2);
    expect(por.get("EP-1") ?? 0).toBe(0);
    expect(finales.reduce((a, x) => a + x.cantidad, 0)).toBe(2);
  });
});

describe("lo que viene de China no se puede enviar a Full", () => {
  it("el optimizador solo puede elegir cajas DISPONIBLES, nunca las en camino", () => {
    // Una caja con 0 disponibles y 8 en camino de China: existe en el
    // catálogo pero el plan de envíos no puede subirla al camión.
    const c = caja("IN-2", "Industher", 0);
    (c as any).enCamino = 8;
    const r = optimizarCajas({
      necesidad: new Map([["GT1-BLK-25", 240]]),
      prioridad: new Map(),
      cajas: [c],
      permiteUnidadesSueltas: false,
      inventarioSuelto: new Map(),
      pesoFaltante: 10,
      pesoSobrante: 1,
    });
    expect(r.totalCajas).toBe(0);
    expect(r.enviadoPorSku.get("GT1-BLK-25") ?? 0).toBe(0);
  });
});
