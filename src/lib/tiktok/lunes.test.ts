import { describe, expect, it } from "vitest";
import { contarSinTiempo, corteQueContinua, ERROR_SIN_TIEMPO, erroresAlUnir, esLunesMx, ordenarPorAntiguedad, partirEnTandas } from "./lunes";

/** Lunes 14 de septiembre de 2026, 9 de la mañana en México (UTC-6). */
const LUNES_9AM = new Date("2026-09-14T15:00:00Z");

function pedido(orderId: string, creadoEn: string | null) {
  return { orderId, estado: "AWAITING_SHIPMENT", creadoEn };
}

describe("el corte del lunes parte en dos tandas", () => {
  it("viernes, sábado y domingo en el primero; solo lo del lunes en el segundo", () => {
    const { urgentes, resto, corte } = partirEnTandas(
      [
        pedido("viernes-tarde", "2026-09-11T23:30:00Z"), // viernes 17:30 MX
        pedido("sabado-manana", "2026-09-12T16:00:00Z"), // sábado 10:00 MX
        pedido("sabado-noche", "2026-09-13T05:00:00Z"), // sábado 23:00 MX
        pedido("domingo", "2026-09-13T18:00:00Z"), // domingo 12:00 MX
        pedido("domingo-2359", "2026-09-14T05:59:00Z"), // domingo 23:59 MX (ya es lunes en UTC)
        pedido("lunes-0001", "2026-09-14T06:01:00Z"), // lunes 00:01 MX
        pedido("lunes", "2026-09-14T14:00:00Z"), // lunes 8:00 MX
      ],
      LUNES_9AM,
    );
    expect(corte).toBe("2026-09-13"); // domingo
    expect(urgentes.map((p) => p.orderId)).toEqual(["viernes-tarde", "sabado-manana", "sabado-noche", "domingo", "domingo-2359"]);
    expect(resto.map((p) => p.orderId)).toEqual(["lunes-0001", "lunes"]);
  });

  it("el día se decide en hora de MÉXICO, no en UTC: las 23:59 del domingo son domingo", () => {
    // A las 05:59Z ya es lunes en UTC; en México son las 23:59 del domingo.
    const { urgentes, resto } = partirEnTandas([pedido("domingo-2359", "2026-09-14T05:59:59Z")], LUNES_9AM);
    expect(urgentes.map((p) => p.orderId)).toEqual(["domingo-2359"]);
    expect(resto).toHaveLength(0);
  });

  it("lo más viejo que el viernes también corre prisa", () => {
    const { urgentes } = partirEnTandas([pedido("jueves", "2026-09-10T20:00:00Z"), pedido("martes-pasado", "2026-09-08T20:00:00Z")], LUNES_9AM);
    expect(urgentes.map((p) => p.orderId)).toEqual(["jueves", "martes-pasado"]);
  });

  it("un pedido sin fecha se va con los urgentes: se despacha antes, no después", () => {
    const { urgentes, resto } = partirEnTandas([pedido("sin-fecha", null), pedido("basura", "no es fecha")], LUNES_9AM);
    expect(urgentes).toHaveLength(2);
    expect(resto).toHaveLength(0);
  });

  it("cualquier otro día se porta igual: lo de ayer y antes primero, lo de hoy después", () => {
    const miercoles = new Date("2026-09-16T15:00:00Z");
    const { urgentes, resto } = partirEnTandas(
      [pedido("domingo", "2026-09-13T18:00:00Z"), pedido("lunes", "2026-09-14T18:00:00Z"), pedido("martes", "2026-09-15T18:00:00Z"), pedido("miercoles", "2026-09-16T14:00:00Z")],
      miercoles,
    );
    expect(urgentes.map((p) => p.orderId)).toEqual(["domingo", "lunes", "martes"]);
    expect(resto.map((p) => p.orderId)).toEqual(["miercoles"]);
  });
});

describe("qué día es hoy en México", () => {
  it("el lunes a las 9 de la mañana sí es lunes", () => {
    expect(esLunesMx(LUNES_9AM)).toBe(true);
  });
  it("el lunes a las 23:00 de México (martes en UTC) sigue siendo lunes", () => {
    expect(esLunesMx(new Date("2026-09-15T05:00:00Z"))).toBe(true);
  });
  it("el domingo a las 20:00 de México todavía no", () => {
    expect(esLunesMx(new Date("2026-09-14T02:00:00Z"))).toBe(false);
  });
});

describe("lo que se quedó por tiempo y el orden del corte", () => {
  it("cuenta solo los pedidos que no alcanzaron por tiempo, no los bloqueados ni las notas", () => {
    expect(
      contarSinTiempo([
        { orderId: "a", error: ERROR_SIN_TIEMPO },
        { orderId: "b", error: ERROR_SIN_TIEMPO },
        { orderId: "c", error: "Bloqueado y TikTok no aceptó cancelarlo" },
        { orderId: "", error: ERROR_SIN_TIEMPO },
      ]),
    ).toBe(2);
    expect(contarSinTiempo([])).toBe(0);
  });

  it("el corte toma lo más viejo primero; lo sin fecha va al frente", () => {
    const r = ordenarPorAntiguedad([
      pedido("hoy", "2026-09-21T15:00:00Z"),
      pedido("sabado", "2026-09-19T15:00:00Z"),
      pedido("sin-fecha", null),
      pedido("domingo", "2026-09-20T15:00:00Z"),
    ]);
    expect(r.map((p) => p.orderId)).toEqual(["sin-fecha", "sabado", "domingo", "hoy"]);
  });
});

describe("un corte que continúa otro se le une", () => {
  const ahora = new Date("2026-09-22T19:30:00Z"); // martes 22-sep 13:30 MX
  const sinTiempo = (ids: string[]) => ids.map((orderId) => ({ orderId, error: ERROR_SIN_TIEMPO }));
  it("se une al corte de HOY que dejó por tiempo alguno de los pedidos que se van a cortar", () => {
    const cortes = [{ id: 68, creadoEn: "2026-09-22T19:07:00Z", errores: sinTiempo(["a", "b"]), preparados: 0 }];
    expect(corteQueContinua(cortes, ["b", "z"], ahora)).toBe(68);
  });
  it("no se une si ninguno de los pedidos venía de ese corte (lo de hoy en el corte lunes abre otro)", () => {
    const cortes = [{ id: 68, creadoEn: "2026-09-22T19:07:00Z", errores: sinTiempo(["a", "b"]), preparados: 0 }];
    expect(corteQueContinua(cortes, ["z"], ahora)).toBeNull();
  });
  it("no se une a un corte de AYER (México) ni a uno con paquetes ya preparados", () => {
    const ayer = [{ id: 67, creadoEn: "2026-09-22T02:03:00Z", errores: sinTiempo(["a"]), preparados: 0 }]; // 21-sep 20:03 MX
    expect(corteQueContinua(ayer, ["a"], ahora)).toBeNull();
    const enUso = [{ id: 68, creadoEn: "2026-09-22T19:07:00Z", errores: sinTiempo(["a"]), preparados: 3 }];
    expect(corteQueContinua(enUso, ["a"], ahora)).toBeNull();
  });
  it("con varios candidatos, el más reciente", () => {
    const cortes = [
      { id: 68, creadoEn: "2026-09-22T15:00:00Z", errores: sinTiempo(["a"]), preparados: 0 },
      { id: 69, creadoEn: "2026-09-22T17:00:00Z", errores: sinTiempo(["a"]), preparados: 0 },
    ];
    expect(corteQueContinua(cortes, ["a"], ahora)).toBe(69);
  });
  it("al unir, los «sin tiempo» de los pedidos que se intentaron se quitan y lo nuevo se agrega", () => {
    const viejos = [...sinTiempo(["a", "b"]), { orderId: "", error: "nota" }, { orderId: "c", error: "otro error" }];
    const nuevos = [{ orderId: "b", error: "TikTok lo rechazó" }];
    expect(erroresAlUnir(viejos, nuevos, ["a", "b"])).toEqual([
      { orderId: "", error: "nota" },
      { orderId: "c", error: "otro error" },
      { orderId: "b", error: "TikTok lo rechazó" },
    ]);
  });
});
