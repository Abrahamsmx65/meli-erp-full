import { describe, expect, it } from "vitest";
import type { CajaConstruida } from "../importar/cajas";
import { ajustesDesdeFoto, esAlmacenTikTok, paresPorSkuDesdeCajas } from "./bodega";
import type { Movimiento } from "./kardex";

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

  it("una caja sin existencia no aporta", () => {
    const pares = paresPorSkuDesdeCajas([
      caja({ cajasDisponibles: 0, detalle: [{ sku: "A", piezas: 3, talla: "25", origen: "exacto" }] }),
    ]);
    expect(pares.has("A")).toBe(false);
  });
});

describe("ajustesDesdeFoto", () => {
  const FOTO = "2026-09-02T14:00:00.000Z";

  it("escribe un ajuste solo donde la bodega y el kardex difieren", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 10, fecha: "2026-09-01T10:00:00Z" },
      { sku: "B", tipo: "entrada", cantidad: 5, fecha: "2026-09-01T10:00:00Z" },
    ];
    const ajustes = ajustesDesdeFoto(new Map([["A", 10], ["B", 7]]), movs, FOTO);
    expect(ajustes).toEqual([
      {
        sku: "B",
        tipo: "ajuste",
        cantidad: 7,
        referencia: `industher:${FOTO}`,
        motivo: "Foto de la bodega TikTok en Industher",
        fecha: FOTO,
      },
    ]);
  });

  it("compara contra el saldo A LA HORA DE LA FOTO: una salida posterior no borra la diferencia", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 10, fecha: "2026-09-01T10:00:00Z" },
      // Se confirmó un envío DESPUÉS de la foto: el kardex dice 9 ahora,
      // pero a la hora de la foto decía 10, igual que la bodega. Sin ajuste.
      { sku: "A", tipo: "salida", cantidad: 1, fecha: "2026-09-02T15:00:00Z" },
    ];
    expect(ajustesDesdeFoto(new Map([["A", 10]]), movs, FOTO)).toEqual([]);
  });

  it("una salida ANTES de la foto ya viene descontada en la bodega: tampoco ajusta", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 10, fecha: "2026-09-01T10:00:00Z" },
      { sku: "A", tipo: "salida", cantidad: 1, fecha: "2026-09-02T13:50:00Z" },
    ];
    // La bodega ya empacó ese par: reporta 9. El kardex a las 14:00 dice 9.
    expect(ajustesDesdeFoto(new Map([["A", 9]]), movs, FOTO)).toEqual([]);
  });

  it("lo que la bodega ya no reporta baja a cero", () => {
    const movs: Movimiento[] = [{ sku: "Z", tipo: "entrada", cantidad: 4, fecha: "2026-09-01T10:00:00Z" }];
    const ajustes = ajustesDesdeFoto(new Map(), movs, FOTO);
    expect(ajustes).toHaveLength(1);
    expect(ajustes[0]).toMatchObject({ sku: "Z", cantidad: 0 });
  });

  it("la referencia identifica la foto: la misma foto no se aplica dos veces", () => {
    const a = ajustesDesdeFoto(new Map([["A", 3]]), [], FOTO);
    expect(a[0].referencia).toBe(`industher:${FOTO}`);
  });
});
