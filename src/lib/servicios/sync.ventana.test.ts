import { describe, expect, it } from "vitest";
import { DIAS_VENTAS_INCREMENTAL, ventanaVentas } from "./sync";

const HOY = "2026-08-28";

describe("ventana de órdenes a bajar", () => {
  it("sin historial baja los 90 días completos", () => {
    // Una cuenta recién conectada: si solo bajara 10 días, el pasado
    // quedaría vacío para siempre y el motor planearía con un mes de nada.
    expect(ventanaVentas(HOY, 90, DIAS_VENTAS_INCREMENTAL, false)).toEqual({
      desdeVentas: "2026-05-30",
      ventasCompletas: true,
    });
  });

  it("con historial baja solo la ventana corta", () => {
    // Aquí está el ahorro: ~78 mil órdenes en 1,500 llamadas encadenadas se
    // vuelven las de los últimos días. Las viejas ya están guardadas.
    expect(ventanaVentas(HOY, 90, DIAS_VENTAS_INCREMENTAL, true)).toEqual({
      desdeVentas: "2026-08-18",
      ventasCompletas: false,
    });
  });

  it("la ventana corta cubre cancelaciones y órdenes que entran tarde", () => {
    // 10 días es holgado para lo que de verdad se mueve del pasado.
    const { desdeVentas } = ventanaVentas(HOY, 90, DIAS_VENTAS_INCREMENTAL, true);
    expect(desdeVentas < "2026-08-25").toBe(true);
  });

  it("pedir la ventana completa a mano la marca como completa", () => {
    expect(ventanaVentas(HOY, 90, 90, true)).toEqual({
      desdeVentas: "2026-05-30",
      ventasCompletas: true,
    });
  });

  it("no puede pedir más días que la ventana de historia", () => {
    expect(ventanaVentas(HOY, 30, 90, true)).toEqual({
      desdeVentas: "2026-07-29",
      ventasCompletas: true,
    });
  });
});
