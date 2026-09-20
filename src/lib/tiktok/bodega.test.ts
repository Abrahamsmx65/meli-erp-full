import { describe, expect, it } from "vitest";
import type { CajaConstruida } from "../importar/cajas";
import {
  conciliarAcumulado,
  disponibleConEstante,
  esAlmacenTikTok,
  movimientosDesdeAcumulado,
  paresPorSkuDesdeCajas,
  REFERENCIA_INDUSTHER,
} from "./bodega";
import { aliasDesdeTikTok } from "./bodega";
import { saldosDesdeMovimientos, type Movimiento } from "./kardex";

describe("esAlmacenTikTok", () => {
  it("reconoce cómo lo escriba el 3PL", () => {
    for (const n of ["Tik Tok", "TIKTOK", "TikTok", "tik-tok", "TikTok Shop", "  Tik Tok  "]) {
      expect(esAlmacenTikTok(n)).toBe(true);
    }
  });

  it("no confunde las otras bodegas", () => {
    for (const n of ["Industher", "Caseshop", "EnvioPack", "", null, undefined]) {
      expect(esAlmacenTikTok(n)).toBe(false);
    }
  });
});

function caja(over: Partial<CajaConstruida>): CajaConstruida {
  return {
    codigo: "X",
    cajasDisponibles: 1,
    cajasApartadas: 0,
    items: [],
    almacen: "Tik Tok",
    codigoAlmacen: "TIKTOK",
    skuCaja: "P1-GT135-DK BROWN",
    pedido: "P1",
    modelo: "GT135",
    color: "DK BROWN",
    talla: "CORRIDA",
    esCorrida: true,
    paresPorCaja: 12,
    enCamino: 0,
    contenedores: [],
    detalle: [],
    ...over,
  } as CajaConstruida;
}

describe("paresPorSkuDesdeCajas", () => {
  it("multiplica la receta por las cajas FÍSICAS (disponibles + apartadas)", () => {
    const pares = paresPorSkuDesdeCajas([
      caja({
        cajasDisponibles: 2,
        cajasApartadas: 1,
        detalle: [
          { sku: "GT135-DK BROWN-25", piezas: 4, talla: "25", origen: "exacto" },
          { sku: "GT135-DK BROWN-26", piezas: 8, talla: "26", origen: "exacto" },
        ],
      }),
    ]);
    expect(pares.get("GT135-DK BROWN-25")).toBe(12);
    expect(pares.get("GT135-DK BROWN-26")).toBe(24);
  });

  it("suma el mismo SKU desde varias cajas", () => {
    const pares = paresPorSkuDesdeCajas([
      caja({ detalle: [{ sku: "A", piezas: 3, talla: "25", origen: "exacto" }] }),
      caja({ skuCaja: "otra", detalle: [{ sku: "A", piezas: 5, talla: "25", origen: "exacto" }] }),
    ]);
    expect(pares.get("A")).toBe(8);
  });
});

describe("movimientosDesdeAcumulado", () => {
  const FOTO = "2026-09-02T14:00:00.000Z";
  const ref = (f: string) => `${REFERENCIA_INDUSTHER}${f}`;

  it("la primera vez, todo lo de Industher entra como entrada", () => {
    const m = movimientosDesdeAcumulado(new Map([["A", 100]]), [], FOTO);
    expect(m).toEqual([
      { sku: "A", tipo: "entrada", cantidad: 100, referencia: ref(FOTO), motivo: "Entrada a la bodega TikTok (Industher)", fecha: FOTO },
    ]);
  });

  it("LA REGLA: vender no cambia lo que Industher reporta, y no se vuelve a sumar", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 100, referencia: ref("2026-09-01T14:00:00.000Z"), fecha: "2026-09-01T14:00:00Z" },
      { sku: "A", tipo: "salida", cantidad: 30, referencia: "5770", fecha: "2026-09-01T18:00:00Z" },
    ];
    // Industher sigue diciendo 100: no descuenta pedidos. Nada nuevo que meter.
    expect(movimientosDesdeAcumulado(new Map([["A", 100]]), movs, FOTO)).toEqual([]);
    // Y el saldo real sigue siendo 70.
    expect(saldosDesdeMovimientos(movs).get("A")).toBe(70);
  });

  it("si Industher sube, entra solo la diferencia", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 100, referencia: ref("2026-09-01T14:00:00.000Z"), fecha: "2026-09-01T14:00:00Z" },
      { sku: "A", tipo: "salida", cantidad: 30, referencia: "5770", fecha: "2026-09-01T18:00:00Z" },
    ];
    const m = movimientosDesdeAcumulado(new Map([["A", 120]]), movs, FOTO);
    expect(m).toEqual([expect.objectContaining({ sku: "A", tipo: "entrada", cantidad: 20 })]);
    expect(saldosDesdeMovimientos([...movs, m[0]]).get("A")).toBe(90);
  });

  it("si Industher baja (sacó o corrigió), se retira la diferencia", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 100, referencia: ref("2026-09-01T14:00:00.000Z"), fecha: "2026-09-01T14:00:00Z" },
    ];
    const m = movimientosDesdeAcumulado(new Map([["A", 90]]), movs, FOTO);
    expect(m).toEqual([expect.objectContaining({ sku: "A", tipo: "merma", cantidad: 10 })]);
  });

  it("las correcciones a mano no cuentan como base de Industher", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 100, referencia: ref("2026-09-01T14:00:00.000Z"), fecha: "2026-09-01T14:00:00Z" },
      // Alguien capturó una merma a mano: no es de Industher, no cambia lo que se le reconoce.
      { sku: "A", tipo: "merma", cantidad: 2, referencia: null, fecha: "2026-09-01T19:00:00Z" },
    ];
    expect(movimientosDesdeAcumulado(new Map([["A", 100]]), movs, FOTO)).toEqual([]);
    expect(saldosDesdeMovimientos(movs).get("A")).toBe(98);
  });

  it("lo que Industher ya no reporta se retira completo", () => {
    const movs: Movimiento[] = [
      { sku: "Z", tipo: "entrada", cantidad: 4, referencia: ref("2026-09-01T14:00:00.000Z"), fecha: "2026-09-01T14:00:00Z" },
    ];
    const m = movimientosDesdeAcumulado(new Map(), movs, FOTO);
    expect(m).toEqual([expect.objectContaining({ sku: "Z", tipo: "merma", cantidad: 4 })]);
  });

  it("la referencia lleva la fecha de la foto: la misma foto no se aplica dos veces", () => {
    expect(movimientosDesdeAcumulado(new Map([["A", 3]]), [], FOTO)[0].referencia).toBe(ref(FOTO));
  });
});

describe("conciliarAcumulado: cuando el 3PL descuenta lo que le mandamos", () => {
  const FOTO = "2026-09-03T14:00:00.000Z";
  const ref = (f: string) => `${REFERENCIA_INDUSTHER}${f}`;
  const entrada100: Movimiento[] = [
    { sku: "A", tipo: "entrada", cantidad: 100, referencia: ref("2026-09-01T14:00:00.000Z"), fecha: "2026-09-01T14:00:00Z" },
    { sku: "A", tipo: "salida", cantidad: 3, referencia: "5770", fecha: "2026-09-02T10:00:00Z" },
  ];
  const vacio = () => new Map<string, number>();

  it("el 3PL bajó a 97 por nuestras 3 salidas pendientes: se atribuyen, no es merma", async () => {
    const { conciliarAcumulado } = await import("./bodega");
    const r = conciliarAcumulado(new Map([["A", 97]]), entrada100, FOTO, { confirmadas: vacio(), pendientes: new Map([["A", 3]]) });
    expect(r.movimientos).toEqual([]);
    expect(r.atribuidas.get("A")).toBe(3);
  });

  it("bajó 5 con solo 3 pendientes: 3 se atribuyen y 2 son merma", async () => {
    const { conciliarAcumulado } = await import("./bodega");
    const r = conciliarAcumulado(new Map([["A", 95]]), entrada100, FOTO, { confirmadas: vacio(), pendientes: new Map([["A", 3]]) });
    expect(r.atribuidas.get("A")).toBe(3);
    expect(r.movimientos).toEqual([expect.objectContaining({ sku: "A", tipo: "merma", cantidad: 2 })]);
  });

  it("con el ack del endpoint (3 confirmadas) y el 3PL en 97, no hay nada que mover", async () => {
    const { conciliarAcumulado } = await import("./bodega");
    const r = conciliarAcumulado(new Map([["A", 97]]), entrada100, FOTO, { confirmadas: new Map([["A", 3]]), pendientes: vacio() });
    expect(r.movimientos).toEqual([]);
    expect(r.atribuidas.size).toBe(0);
  });

  it("si el 3PL todavía NO descontó (sigue en 100) y nada está confirmado, tampoco se mueve nada", async () => {
    const { conciliarAcumulado } = await import("./bodega");
    const r = conciliarAcumulado(new Map([["A", 100]]), entrada100, FOTO, { confirmadas: vacio(), pendientes: new Map([["A", 3]]) });
    expect(r.movimientos).toEqual([]);
    expect(r.atribuidas.size).toBe(0);
  });

  it("una subida sigue siendo entrada aunque haya salidas pendientes", async () => {
    const { conciliarAcumulado } = await import("./bodega");
    const r = conciliarAcumulado(new Map([["A", 120]]), entrada100, FOTO, { confirmadas: vacio(), pendientes: new Map([["A", 3]]) });
    expect(r.movimientos).toEqual([expect.objectContaining({ sku: "A", tipo: "entrada", cantidad: 20 })]);
  });
});

describe("la guarda del 20-sep: un SKU que desaparece con pares apartados no se da de baja", () => {
  const FOTO = "2026-09-20T02:45:00.000Z";
  const ref = (f: string) => `${REFERENCIA_INDUSTHER}${f}`;
  const sinSalidas = { confirmadas: new Map<string, number>(), pendientes: new Map<string, number>() };
  // El MY2304-BROWN-29: 102 entrados, 81 salidos y confirmados, 21 en el estante.
  const brown29: Movimiento[] = [
    { sku: "MY2304-BROWN-29", tipo: "entrada", cantidad: 102, referencia: ref("2026-09-08T22:15:00.000Z"), fecha: "2026-09-08T22:15:00Z" },
  ];
  const confirmadas81 = { confirmadas: new Map([["MY2304-BROWN-29", 81]]), pendientes: new Map<string, number>() };

  it("desaparece completo con 21 apartados: la baja se DETIENE, ni merma ni entrada", async () => {
    const { conciliarAcumulado } = await import("./bodega");
    const r = conciliarAcumulado(new Map(), brown29, FOTO, confirmadas81, new Map([["MY2304-BROWN-29", 21]]));
    expect(r.movimientos).toEqual([]);
    expect(r.detenidas).toEqual([{ sku: "MY2304-BROWN-29", pares: 21, apartados: 21 }]);
  });

  it("desaparece completo SIN nada apartado: sigue siendo merma, como siempre", async () => {
    const { conciliarAcumulado } = await import("./bodega");
    const r = conciliarAcumulado(new Map(), brown29, FOTO, confirmadas81, new Map());
    expect(r.movimientos).toEqual([expect.objectContaining({ sku: "MY2304-BROWN-29", tipo: "merma", cantidad: 21 })]);
    expect(r.detenidas).toEqual([]);
  });

  it("una baja PARCIAL con apartados sigue siendo merma: el 3PL corrigió a propósito", async () => {
    const { conciliarAcumulado } = await import("./bodega");
    const r = conciliarAcumulado(new Map([["MY2304-BROWN-29", 18]]), brown29, FOTO, confirmadas81, new Map([["MY2304-BROWN-29", 21]]));
    expect(r.movimientos).toEqual([expect.objectContaining({ sku: "MY2304-BROWN-29", tipo: "merma", cantidad: 3 })]);
    expect(r.detenidas).toEqual([]);
  });

  it("si la baja se explica con salidas pendientes no hay nada que detener", async () => {
    const { conciliarAcumulado } = await import("./bodega");
    const movs: Movimiento[] = [{ sku: "B", tipo: "entrada", cantidad: 2, referencia: ref("2026-09-01T00:00:00.000Z"), fecha: "2026-09-01T00:00:00Z" }];
    const r = conciliarAcumulado(new Map(), movs, FOTO, { ...sinSalidas, pendientes: new Map([["B", 2]]) }, new Map([["B", 1]]));
    expect(r.movimientos).toEqual([]);
    expect(r.detenidas).toEqual([]);
    expect(r.atribuidas.get("B")).toBe(2);
  });
});

describe("alias hacia el SKU de TikTok", () => {
  it("lo construido sin -MX que TikTok vende con -MX cae en el nombre de TikTok; lo de MELI no se toca", () => {
    const alias = aliasDesdeTikTok(["MY2304-PURPLE-23-MX", "GT134-BLK-24-MX"]);
    const cajas: any[] = [
      { cajasDisponibles: 2, cajasApartadas: 0, detalle: [{ sku: "MY2304-PURPLE-23", piezas: 3, talla: "23", origen: "sin_amarre" }] },
      { cajasDisponibles: 1, cajasApartadas: 0, detalle: [{ sku: "GT134-BLK-24", piezas: 1, talla: "24", origen: "exacto" }] },
    ];
    const pares = paresPorSkuDesdeCajas(cajas, alias);
    expect(pares.get("MY2304-PURPLE-23-MX")).toBe(6);
    expect(pares.get("MY2304-PURPLE-23")).toBeUndefined();
    expect(pares.get("GT134-BLK-24")).toBe(1);
  });
});

describe("una devolución solo vale si la bodega la confirma", () => {
  const FOTO2 = "2026-09-14T03:30:00.000Z";
  const ref2 = (f: string) => `industher:${f}`;

  /**
   * El GT102-GREY-25-MX del 14-sep-2026: 19 pares entraron de Industher, se
   * vendieron 19 y TikTok canceló 4 pedidos ya despachados. El kardex quedó
   * en 4 y se los ofreció a TikTok; la bodega tenía CERO, porque esos pares
   * nunca regresaron al estante.
   */
  it("la devolución que no volvió al estante sale como retiro", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 19, referencia: ref2("2026-09-04T22:31:00.000Z"), fecha: "2026-09-04T22:31:00Z" },
      { sku: "A", tipo: "salida", cantidad: 19, referencia: "pedidos", fecha: "2026-09-10T15:38:00Z" },
      { sku: "A", tipo: "devolucion", cantidad: 4, referencia: "pedidos", fecha: "2026-09-10T18:27:00Z" },
    ];
    const salidas = { confirmadas: new Map([["A", 19]]), pendientes: new Map<string, number>() };
    const { movimientos } = conciliarAcumulado(new Map(), movs, FOTO2, salidas);
    expect(movimientos).toEqual([
      expect.objectContaining({
        sku: "A",
        tipo: "merma",
        cantidad: 4,
        motivo: "Devolución que no volvió al estante de Industher",
      }),
    ]);
    // Con el retiro aplicado, el kardex queda en cero: lo que hay de verdad.
    expect(saldosDesdeMovimientos([...movs, { sku: "A", tipo: "merma", cantidad: 4, fecha: FOTO2 }]).get("A")).toBe(0);
  });

  it("si el par SÍ regresó y la bodega lo contó, la devolución se respeta", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 19, referencia: ref2("2026-09-04T22:31:00.000Z"), fecha: "2026-09-04T22:31:00Z" },
      { sku: "A", tipo: "salida", cantidad: 19, referencia: "pedidos", fecha: "2026-09-10T15:38:00Z" },
      { sku: "A", tipo: "devolucion", cantidad: 4, referencia: "pedidos", fecha: "2026-09-10T18:27:00Z" },
    ];
    const salidas = { confirmadas: new Map([["A", 19]]), pendientes: new Map<string, number>() };
    // Industher volvió a contar los 4 pares en el estante.
    const { movimientos } = conciliarAcumulado(new Map([["A", 4]]), movs, FOTO2, salidas);
    expect(movimientos).toEqual([]);
  });

  it("sin devoluciones nada cambia: la base sigue siendo la de siempre", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 100, referencia: ref2("2026-09-01T14:00:00.000Z"), fecha: "2026-09-01T14:00:00Z" },
      { sku: "A", tipo: "salida", cantidad: 30, referencia: "pedidos", fecha: "2026-09-02T14:00:00Z" },
    ];
    const salidas = { confirmadas: new Map<string, number>(), pendientes: new Map<string, number>() };
    expect(conciliarAcumulado(new Map([["A", 100]]), movs, FOTO2, salidas).movimientos).toEqual([]);
  });

  it("una baja mayor que las devoluciones se declara como faltante de la bodega", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 10, referencia: ref2("2026-09-01T14:00:00.000Z"), fecha: "2026-09-01T14:00:00Z" },
      { sku: "A", tipo: "salida", cantidad: 2, referencia: "pedidos", fecha: "2026-09-02T14:00:00Z" },
      { sku: "A", tipo: "devolucion", cantidad: 1, referencia: "pedidos", fecha: "2026-09-02T18:00:00Z" },
    ];
    const salidas = { confirmadas: new Map([["A", 2]]), pendientes: new Map<string, number>() };
    // Base = 10 − 2 + 1 = 9, y la bodega solo tiene 5: faltan 4, más de la devolución.
    const { movimientos } = conciliarAcumulado(new Map([["A", 5]]), movs, FOTO2, salidas);
    expect(movimientos).toEqual([
      expect.objectContaining({ tipo: "merma", cantidad: 4, motivo: "Industher reportó menos en la bodega TikTok" }),
    ]);
  });
});

describe("a TikTok se le publica el MENOR entre el kardex y el estante", () => {
  it("el caso del 14-sep: kardex 4, estante 0 → no se ofrece nada", () => {
    // GT102-GREY-25-MX ofrecía 3 pares con la bodega en cero.
    expect(disponibleConEstante(4, 1, 0)).toBe(0);
  });

  it("el estante manda cuando trae menos que el kardex", () => {
    expect(disponibleConEstante(84, 1, 83)).toBe(82); // GT102-BLK-24
    expect(disponibleConEstante(17, 3, 13)).toBe(10); // GT102-NAVY-26
  });

  it("si cuadran, se publica lo de siempre", () => {
    expect(disponibleConEstante(50, 2, 50)).toBe(48);
  });

  it("el tope solo BAJA: un estante con más pares no sube el disponible", () => {
    // Llegó mercancía que el kardex todavía no registra: se sube con su
    // entrada, no adivinando desde el estante.
    expect(disponibleConEstante(10, 0, 30)).toBe(10);
  });

  it("sin lectura del 3PL no se topa nada: un API caído no apaga la tienda", () => {
    expect(disponibleConEstante(40, 5, null)).toBe(35);
  });

  it("nunca es negativo", () => {
    expect(disponibleConEstante(2, 5, 0)).toBe(0);
    expect(disponibleConEstante(-3, 0, 0)).toBe(0);
  });
});
