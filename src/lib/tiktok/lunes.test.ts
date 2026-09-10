import { describe, expect, it } from "vitest";
import { esLunesMx, partirEnTandas } from "./lunes";

/** Lunes 14 de septiembre de 2026, 9 de la mañana en México (UTC-6). */
const LUNES_9AM = new Date("2026-09-14T15:00:00Z");

function pedido(orderId: string, creadoEn: string | null) {
  return { orderId, estado: "AWAITING_SHIPMENT", creadoEn };
}

describe("el corte del lunes parte en dos tandas", () => {
  it("viernes y sábado en el primero; domingo y lunes en el segundo", () => {
    const { urgentes, resto, corte } = partirEnTandas(
      [
        pedido("viernes-tarde", "2026-09-11T23:30:00Z"), // viernes 17:30 MX
        pedido("sabado-manana", "2026-09-12T16:00:00Z"), // sábado 10:00 MX
        pedido("sabado-noche", "2026-09-13T05:00:00Z"), // sábado 23:00 MX
        pedido("domingo", "2026-09-13T18:00:00Z"), // domingo 12:00 MX
        pedido("lunes", "2026-09-14T14:00:00Z"), // lunes 8:00 MX
      ],
      LUNES_9AM,
    );
    expect(corte).toBe("2026-09-12"); // sábado
    expect(urgentes.map((p) => p.orderId)).toEqual(["viernes-tarde", "sabado-manana", "sabado-noche"]);
    expect(resto.map((p) => p.orderId)).toEqual(["domingo", "lunes"]);
  });

  it("lo más viejo que el viernes también corre prisa", () => {
    const { urgentes } = partirEnTandas([pedido("jueves", "2026-09-10T20:00:00Z")], LUNES_9AM);
    expect(urgentes.map((p) => p.orderId)).toEqual(["jueves"]);
  });

  it("un pedido sin fecha se va con los urgentes: se despacha antes, no después", () => {
    const { urgentes, resto } = partirEnTandas([pedido("sin-fecha", null), pedido("basura", "no es fecha")], LUNES_9AM);
    expect(urgentes).toHaveLength(2);
    expect(resto).toHaveLength(0);
  });

  it("cualquier otro día se porta igual: lo de hace dos días o más, primero", () => {
    const miercoles = new Date("2026-09-16T15:00:00Z");
    const { urgentes, resto } = partirEnTandas(
      [pedido("domingo", "2026-09-13T18:00:00Z"), pedido("lunes", "2026-09-14T18:00:00Z"), pedido("martes", "2026-09-15T18:00:00Z")],
      miercoles,
    );
    expect(urgentes.map((p) => p.orderId)).toEqual(["domingo", "lunes"]);
    expect(resto.map((p) => p.orderId)).toEqual(["martes"]);
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
