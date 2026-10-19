import { describe, expect, it } from "vitest";
import { cierresDeRondas, revisarSimulacion, type SimulacionParaRevisar } from "./revision-corte";

const sim: SimulacionParaRevisar = {
  pedidos: [
    { pares: [{}], bloqueados: [], aviso: null },
    { pares: [{}], bloqueados: [{}], aviso: "Se cancela en TikTok X ×1 y se confirma el resto" },
    { pares: [], bloqueados: [{}], aviso: "Todo el pedido está bloqueado" },
    { pares: [{}], bloqueados: [], aviso: "Stock en duda de GT148-CREAM-24-MX (…)" },
    { pares: [{}], bloqueados: [], aviso: null },
  ],
  totalPares: 9,
  tandas: { urgentes: 3, resto: 2, corte: "2026-10-18" },
  porModelo: { revueltos: { pedidos: 4 } },
};

describe("revisarSimulacion", () => {
  it("todo: todos los pendientes con su defensa", () => {
    const r = revisarSimulacion(sim, "todo");
    expect(r.entran).toBe(5);
    expect(r.pares).toBe(9);
    expect(r.seCancelan).toBe(1);
    expect(r.seCancelanEnParte).toBe(1);
    expect(r.enDuda).toBe(1);
    expect(r.revueltos).toBe(4);
    expect(r.defensaDeTodoLoPendiente).toBe(false);
  });

  it("ayer: solo la primera tanda; lo de hoy se queda y no hay pares partidos", () => {
    const r = revisarSimulacion(sim, "ayer");
    expect(r.entran).toBe(3);
    expect(r.seQuedanHoy).toBe(2);
    expect(r.pares).toBeNull();
    expect(r.defensaDeTodoLoPendiente).toBe(true);
    expect(r.diaCorte).toBe("2026-10-18");
  });

  it("ayer sin pedidos de hoy: los pares sí cuadran", () => {
    const r = revisarSimulacion({ ...sim, tandas: { urgentes: 5, resto: 0, corte: "2026-10-18" } }, "ayer");
    expect(r.entran).toBe(5);
    expect(r.pares).toBe(9);
    expect(r.defensaDeTodoLoPendiente).toBe(false);
  });

  it("lunes: todo, en dos cortes", () => {
    const r = revisarSimulacion(sim, "lunes");
    expect(r.entran).toBe(5);
    expect(r.primerCorte).toBe(3);
    expect(r.segundoCorte).toBe(2);
  });
});

describe("cierresDeRondas", () => {
  it("acumula las rondas que se unen al mismo corte y salta las vacías", () => {
    expect(
      cierresDeRondas([
        { corteId: 10, numero: 57, pedidos: 300 },
        { corteId: 10, numero: 57, pedidos: 280 },
        { corteId: null, numero: null, pedidos: 0 },
        { corteId: 11, numero: 58, pedidos: 40 },
      ]),
    ).toEqual([
      { corteId: 10, numero: 57, pedidos: 580 },
      { corteId: 11, numero: 58, pedidos: 40 },
    ]);
  });
});
