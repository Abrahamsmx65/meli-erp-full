import { describe, expect, it } from "vitest";
import type { CajaConstruida } from "../importar/cajas";
import {
  esAlmacenTikTok,
  movimientosDesdeAcumulado,
  paresPorSkuDesdeCajas,
  REFERENCIA_INDUSTHER,
} from "./bodega";
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
