import { describe, expect, it } from "vitest";
import { cualesAvisar, desfasesPeligrosos, HORAS_PARA_AVISAR } from "./alarma";

describe("qué desfase merece despertar a alguien", () => {
  it("el kardex ARRIBA del estante es la alarma: se ofrece lo que no hay", () => {
    // El GT102-GREY-25-MX del 14-sep: kardex 4, bodega 0.
    const r = desfasesPeligrosos([{ sku: "GT102-GREY-25-MX", saldo: 4, estante: 0 }]);
    expect(r).toHaveLength(1);
    expect(r[0].deMas).toBe(4);
    expect(r[0].motivo).toContain("4 pares que no existen");
  });

  it("el kardex ABAJO del estante NO suena: cuesta ventas, no pedidos", () => {
    // Los 16 SKUs sanos del 14-sep, con 449 pares sin ofrecer.
    expect(desfasesPeligrosos([{ sku: "A", saldo: 10, estante: 40 }])).toEqual([]);
  });

  it("un kardex negativo suena aunque el estante no diga nada", () => {
    const r = desfasesPeligrosos([{ sku: "B", saldo: -2, estante: null }]);
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toContain("negativo");
  });

  it("las salidas que el 3PL aún no descuenta no son desfase", () => {
    // Recién hecho el corte: el kardex ya restó 5, el 3PL todavía no.
    expect(desfasesPeligrosos([{ sku: "C", saldo: 10, estante: 15, salidasPendientes: 5 }])).toEqual([]);
    // Pero si además falta un par de verdad, sí suena.
    const r = desfasesPeligrosos([{ sku: "C", saldo: 11, estante: 15, salidasPendientes: 5 }]);
    expect(r[0].deMas).toBe(1);
  });

  it("un SKU que el 3PL no reporta no se juzga", () => {
    expect(desfasesPeligrosos([{ sku: "D", saldo: 5, estante: null }])).toEqual([]);
  });

  it("lo peor primero", () => {
    const r = desfasesPeligrosos([
      { sku: "chico", saldo: 2, estante: 1 },
      { sku: "grande", saldo: 30, estante: 0 },
    ]);
    expect(r.map((x) => x.sku)).toEqual(["grande", "chico"]);
  });
});

describe("a quién se le avisa y cuándo", () => {
  const ahora = new Date("2026-09-14T18:00:00Z");
  const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000).toISOString();

  it("un desfase recién nacido no despierta a nadie: casi siempre es un parpadeo", () => {
    expect(cualesAvisar([{ sku: "A", desde: hace(1), avisadoEn: null }], ahora)).toEqual([]);
  });

  it("el que aguanta las horas sí se avisa", () => {
    const r = cualesAvisar([{ sku: "A", desde: hace(HORAS_PARA_AVISAR + 1), avisadoEn: null }], ahora);
    expect(r.map((x) => x.sku)).toEqual(["A"]);
  });

  it("no se avisa dos veces del mismo: una alarma repetida deja de leerse", () => {
    expect(cualesAvisar([{ sku: "A", desde: hace(48), avisadoEn: hace(40) }], ahora)).toEqual([]);
  });
});

describe("la guarda del 20-sep: desaparecido del estante con pedidos vendidos", () => {
  it("estante en cero, kardex con pares y apartados: es urgente y lo dice", () => {
    // El MY2304-BROWN-29: Industher dejó de traerlo con 21 en el kardex y 21 apartados.
    const r = desfasesPeligrosos([{ sku: "MY2304-BROWN-29", saldo: 21, estante: 0, apartado: 21 }]);
    expect(r).toHaveLength(1);
    expect(r[0].urgente).toBe(true);
    expect(r[0].motivo).toContain("dejó de reportarlo");
    expect(r[0].motivo).toContain("21 pares vendidos");
  });

  it("sin nada apartado es el desfase de siempre: espera sus horas", () => {
    const r = desfasesPeligrosos([{ sku: "A", saldo: 4, estante: 0, apartado: 0 }]);
    expect(r[0].urgente).toBeUndefined();
  });

  it("lo urgente se avisa en el acto, y una sola vez", () => {
    const ahora = new Date("2026-09-20T03:00:00Z");
    const recien = { sku: "MY2304-BROWN-29", desde: "2026-09-20T02:45:00Z", avisadoEn: null, urgente: true };
    expect(cualesAvisar([recien], ahora)).toEqual([recien]);
    expect(cualesAvisar([{ ...recien, avisadoEn: "2026-09-20T02:50:00Z" }], ahora)).toEqual([]);
    expect(cualesAvisar([{ ...recien, urgente: false }], ahora)).toEqual([]);
  });
});
