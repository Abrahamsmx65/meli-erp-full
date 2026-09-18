import { describe, expect, it } from "vitest";
import {
  apartadosPorSku,
  cambiosAPublicar,
  disponibleParaCompradores,
  efectoDeEstado,
  estaComprometido,
  movimientosPendientes,
  saldosDesdeMovimientos,
  type Movimiento,
  type RenglonPedido,
  frenarSubidasSinCausa,
} from "./kardex";

describe("efectoDeEstado", () => {
  it("aparta lo pagado que sigue en el almacén", () => {
    expect(efectoDeEstado("AWAITING_SHIPMENT")).toBe("apartado");
    expect(efectoDeEstado("PARTIALLY_SHIPPING")).toBe("apartado");
    expect(efectoDeEstado("ON_HOLD")).toBe("apartado");
  });

  it("descuenta desde que el envío se confirma, no cuando lo recogen", () => {
    expect(efectoDeEstado("AWAITING_COLLECTION")).toBe("salida");
    expect(efectoDeEstado("IN_TRANSIT")).toBe("salida");
    expect(efectoDeEstado("DELIVERED")).toBe("salida");
    expect(efectoDeEstado("COMPLETED")).toBe("salida");
  });

  it("lo creado sin pagar está EN ESPERA: TikTok ya lo apartó, no se vuelve a ofrecer", () => {
    expect(efectoDeEstado("UNPAID")).toBe("espera");
    expect(estaComprometido("UNPAID")).toBe(true);
    expect(estaComprometido("AWAITING_SHIPMENT")).toBe(true);
    expect(estaComprometido("CANCELLED")).toBe(false);
    expect(estaComprometido("IN_TRANSIT")).toBe(false);
  });

  it("lo que no dice nada del inventario es nada", () => {
    expect(efectoDeEstado(null)).toBe("nada");
    expect(efectoDeEstado("LO_QUE_SEA")).toBe("nada");
  });

  it("no se cae por mayúsculas ni espacios", () => {
    expect(efectoDeEstado(" in_transit ")).toBe("salida");
  });
});

describe("saldosDesdeMovimientos", () => {
  it("suma entradas y resta salidas", () => {
    const movs: Movimiento[] = [
      { sku: "GT135-NEGRO-26", tipo: "entrada", cantidad: 40, fecha: "2026-08-01T10:00:00Z" },
      { sku: "GT135-NEGRO-26", tipo: "salida", cantidad: 3, fecha: "2026-08-02T10:00:00Z" },
      { sku: "GT135-NEGRO-26", tipo: "devolucion", cantidad: 1, fecha: "2026-08-03T10:00:00Z" },
      { sku: "GT135-NEGRO-26", tipo: "merma", cantidad: 2, fecha: "2026-08-04T10:00:00Z" },
    ];
    expect(saldosDesdeMovimientos(movs).get("GT135-NEGRO-26")).toBe(36);
  });

  it("el ajuste pisa el saldo: el conteo físico siempre gana", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 100, fecha: "2026-08-01T00:00:00Z" },
      { sku: "A", tipo: "ajuste", cantidad: 12, fecha: "2026-08-05T00:00:00Z" },
      { sku: "A", tipo: "salida", cantidad: 2, fecha: "2026-08-06T00:00:00Z" },
    ];
    expect(saldosDesdeMovimientos(movs).get("A")).toBe(10);
  });

  it("aplica en orden de fecha aunque lleguen revueltos", () => {
    const movs: Movimiento[] = [
      { sku: "A", tipo: "entrada", cantidad: 5, fecha: "2026-08-09T00:00:00Z" },
      { sku: "A", tipo: "ajuste", cantidad: 30, fecha: "2026-08-02T00:00:00Z" },
      { sku: "A", tipo: "entrada", cantidad: 10, fecha: "2026-08-01T00:00:00Z" },
    ];
    // El ajuste del día 2 pisa la entrada del día 1; la del día 9 sí suma.
    expect(saldosDesdeMovimientos(movs).get("A")).toBe(35);
  });

  it("separa por SKU", () => {
    const saldos = saldosDesdeMovimientos([
      { sku: "A", tipo: "entrada", cantidad: 4 },
      { sku: "B", tipo: "entrada", cantidad: 7 },
    ]);
    expect(saldos.get("A")).toBe(4);
    expect(saldos.get("B")).toBe(7);
  });
});

describe("movimientosPendientes", () => {
  const enviado = (over: Partial<RenglonPedido> = {}): RenglonPedido => ({
    orderId: "5770",
    skuInterno: "GT128-BEIGE-24",
    cantidad: 1,
    estado: "AWAITING_COLLECTION",
    fecha: "2026-08-20T18:00:00Z",
    ...over,
  });

  it("un envío confirmado genera su salida", () => {
    const { movimientos } = movimientosPendientes([enviado()], new Set());
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({
      sku: "GT128-BEIGE-24",
      tipo: "salida",
      cantidad: 1,
      referencia: "5770",
    });
  });

  it("NO descuenta dos veces el mismo pedido", () => {
    const ya = new Set(["salida|5770|GT128-BEIGE-24"]);
    expect(movimientosPendientes([enviado()], ya).movimientos).toHaveLength(0);
  });

  it("lo pagado sin enviar no descuenta: solo aparta", () => {
    const r = enviado({ estado: "AWAITING_SHIPMENT" });
    expect(movimientosPendientes([r], new Set()).movimientos).toHaveLength(0);
    expect(apartadosPorSku([r]).get("GT128-BEIGE-24")).toBe(1);
  });

  it("un pedido SIN PAGAR también aparta (así se sobrevendió el MINT-24 el 15-sep-2026), y no mueve el kardex", () => {
    const sinPagar: RenglonPedido = { orderId: "5771", skuInterno: "GT128-BEIGE-24", cantidad: 2, estado: "UNPAID" };
    expect(apartadosPorSku([sinPagar]).get("GT128-BEIGE-24")).toBe(2);
    expect(movimientosPendientes([sinPagar], new Set()).movimientos).toHaveLength(0);
  });

  it("junta dos renglones del mismo SKU en un solo movimiento", () => {
    const { movimientos } = movimientosPendientes(
      [enviado({ cantidad: 2 }), enviado({ cantidad: 3 })],
      new Set(),
    );
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].cantidad).toBe(5);
  });

  it("una cancelación de algo que YA salió regresa el par", () => {
    const ya = new Set(["salida|5770|GT128-BEIGE-24"]);
    const { movimientos } = movimientosPendientes([enviado({ estado: "RETURNED" })], ya);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ tipo: "devolucion", cantidad: 1 });
  });

  it("una cancelación de algo que NUNCA salió no mueve el saldo", () => {
    const { movimientos } = movimientosPendientes([enviado({ estado: "CANCELLED" })], new Set());
    expect(movimientos).toHaveLength(0);
  });

  it("no devuelve dos veces el mismo pedido", () => {
    const ya = new Set(["salida|5770|GT128-BEIGE-24", "devolucion|5770|GT128-BEIGE-24"]);
    expect(movimientosPendientes([enviado({ estado: "RETURNED" })], ya).movimientos).toHaveLength(0);
  });

  it("un renglón sin SKU amarrado no adivina: se reporta", () => {
    const { movimientos, sinAmarre } = movimientosPendientes(
      [enviado({ skuInterno: null })],
      new Set(),
    );
    expect(movimientos).toHaveLength(0);
    expect(sinAmarre).toHaveLength(1);
  });
});

describe("disponibleParaCompradores", () => {
  it("resta lo apartado", () => {
    expect(disponibleParaCompradores(40, 6)).toBe(34);
  });

  it("nunca publica un número negativo", () => {
    expect(disponibleParaCompradores(2, 5)).toBe(0);
    expect(disponibleParaCompradores(-3, 0)).toBe(0);
  });
});

describe("cambiosAPublicar", () => {
  it("solo manda lo que cambió", () => {
    const cambios = cambiosAPublicar([
      { sku: "A", saldo: 10, apartado: 0, disponible: 10, publicado: 10 },
      { sku: "B", saldo: 10, apartado: 2, disponible: 8, publicado: 10 },
      { sku: "C", saldo: 5, apartado: 0, disponible: 5, publicado: null },
    ]);
    expect(cambios).toEqual([
      { sku: "B", de: 10, a: 8 },
      { sku: "C", de: null, a: 5 },
    ]);
  });

  it("un SKU agotado sí se manda, para cerrar la publicación", () => {
    const cambios = cambiosAPublicar([
      { sku: "A", saldo: 0, apartado: 0, disponible: 0, publicado: 3 },
    ]);
    expect(cambios).toEqual([{ sku: "A", de: 3, a: 0 }]);
  });
});

describe("escriturasContraTikTok", () => {
  it("escribe solo donde TikTok dice otra cosa que el kardex", async () => {
    const { escriturasContraTikTok } = await import("./kardex");
    const e = escriturasContraTikTok(
      [
        { skuId: "s1", productId: "p", skuInterno: "A", cantidadTikTok: 5 },
        { skuId: "s2", productId: "p", skuInterno: "B", cantidadTikTok: 3 },
        { skuId: "s3", productId: "p", skuInterno: "C", cantidadTikTok: null },
      ],
      new Map([["A", 5], ["B", 7], ["C", 0]]),
    );
    expect(e).toEqual([
      { skuId: "s2", productId: "p", skuInterno: "B", de: 3, a: 7 },
      { skuId: "s3", productId: "p", skuInterno: "C", de: null, a: 0 },
    ]);
  });

  it("si alguien editó el stock en el Seller Center, lo corrige", async () => {
    const { escriturasContraTikTok } = await import("./kardex");
    const e = escriturasContraTikTok(
      [{ skuId: "s1", productId: "p", skuInterno: "A", cantidadTikTok: 99 }],
      new Map([["A", 4]]),
    );
    expect(e).toEqual([{ skuId: "s1", productId: "p", skuInterno: "A", de: 99, a: 4 }]);
  });

  it("un SKU que el kardex no conoce no se toca", async () => {
    const { escriturasContraTikTok } = await import("./kardex");
    expect(
      escriturasContraTikTok(
        [{ skuId: "s1", productId: "p", skuInterno: "Z", cantidadTikTok: 12 }],
        new Map(),
      ),
    ).toEqual([]);
  });
});

describe("frenarSubidasSinCausa", () => {
  const e = (sku: string, de: number | null, a: number) => ({ skuId: sku, productId: "p", skuInterno: sku, de, a });
  it("bajar siempre pasa; subir solo con causa o cuando se leyeron todos los pedidos", () => {
    const escrituras = [e("A", 5, 3), e("B", 2, 6), e("C", 1, 4), e("D", null, 9)];
    const r = frenarSubidasSinCausa(escrituras, new Set(["C"]), false);
    expect(r.permitidas.map((x) => x.skuInterno)).toEqual(["A", "C", "D"]);
    expect(r.frenadas.map((x) => x.skuInterno)).toEqual(["B"]);
    expect(frenarSubidasSinCausa(escrituras, new Set(), true).frenadas).toEqual([]);
  });
});
