import { describe, expect, it } from "vitest";
import {
  hallazgoDeSincronizacion,
  hallazgosDeFuente,
  hallazgosDelMes,
  type MesDeCorte,
} from "./salud";

/**
 * Las reglas de la revisión general, probadas con lo que DE VERDAD pasó el
 * 11-sep-2026. Si alguna de estas deja de gritar, el dueño vuelve a tener
 * que cazar el problema a mano, que es justo lo que se quiso quitar.
 */
const sano: MesDeCorte = {
  periodo: "2026-07",
  generadoEn: new Date().toISOString(),
  vigente: true,
  motivo: null,
  canales: ["amazon", "meli_calzado", "meli_fundas"],
  ventaTotal: 17050196.38,
  ventaCanales: 17050196.38,
  exacto: false,
  avisos: 12,
  avisosTimeout: 0,
};

describe("un mes del corte general", () => {
  it("no dice nada de un mes completo y cuadrado", () => {
    expect(hallazgosDelMes(sano)).toEqual([]);
  });

  it("grita el canal que falta: así desapareció Amazon de julio", () => {
    const h = hallazgosDelMes({
      ...sano,
      canales: ["meli_calzado", "meli_fundas"],
      ventaCanales: 11049326.77,
      ventaTotal: 11049326.77,
      motivo: "Amazon no se pudo cargar (amazon_pagos: canceling statement due to statement timeout).",
    });
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("grave");
    expect(h[0].que).toContain("Amazon no está en el corte");
    expect(h[0].detalle).toContain("statement timeout");
  });

  it("grita el canal que falta aunque el corte no haya guardado el motivo: así desapareció fundas de mayo", () => {
    const h = hallazgosDelMes({ ...sano, periodo: "2026-05", canales: ["amazon", "meli_calzado"], motivo: null });
    expect(h).toHaveLength(1);
    expect(h[0].que).toContain("Fundas · Mercado Libre no está en el corte");
  });

  it("grita una fuente caída aunque los tres canales estén", () => {
    const h = hallazgosDelMes({ ...sano, avisosTimeout: 2 });
    expect(h.map((x) => x.severidad)).toEqual(["grave"]);
    expect(h[0].que).toContain("no respondió");
  });

  it("grita cuando el total no cuadra con la suma de sus canales", () => {
    const h = hallazgosDelMes({ ...sano, ventaCanales: 17050196.38 - 250000 });
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("grave");
    expect(h[0].detalle).toContain("sobran");
  });

  it("aguanta el redondeo de centavos sin gritar", () => {
    expect(hallazgosDelMes({ ...sano, ventaCanales: sano.ventaCanales! - 0.9 })).toEqual([]);
  });

  it("un canal que el negocio no tiene conectado no se reclama", () => {
    const h = hallazgosDelMes(
      { ...sano, canales: ["meli_calzado"] },
      ["meli_calzado"],
    );
    expect(h).toEqual([]);
  });

  it("un renglón marcado para rehacerse hace un rato no molesta; uno de ayer sí", () => {
    const hace2h = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const ayer = new Date(Date.now() - 30 * 3_600_000).toISOString();
    expect(hallazgosDelMes({ ...sano, vigente: false, generadoEn: hace2h })).toEqual([]);
    const h = hallazgosDelMes({ ...sano, vigente: false, generadoEn: ayer, motivo: "Entraron netos reales." });
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("falta");
  });
});

describe("una fuente del mes que nunca se leyó", () => {
  it("en un mes CERRADO es grave: ya no se arregla solo (la facturación de julio)", () => {
    const h = hallazgosDeFuente({
      area: "Facturación de MELI", periodo: "2026-07",
      que: "No se ha leído la facturación de MELI del mes: los gastos de Full salen en cero.",
      detalle: "x", hay: false, mesCerrado: true,
    });
    expect(h[0].severidad).toBe("grave");
  });

  it("en el mes en curso solo es una falta: todavía se está leyendo", () => {
    const h = hallazgosDeFuente({
      area: "Facturación de MELI", periodo: "2026-09", que: "q", detalle: "x", hay: false, mesCerrado: false,
    });
    expect(h[0].severidad).toBe("falta");
  });

  it("con el dato leído no dice nada", () => {
    expect(hallazgosDeFuente({
      area: "a", periodo: "2026-08", que: "q", detalle: "x", hay: true, mesCerrado: true,
    })).toEqual([]);
  });
});

describe("un trabajo de fondo que dejó de correr", () => {
  it("calla si corrió hace poco", () => {
    expect(hallazgoDeSincronizacion("Latido", new Date().toISOString(), 2)).toEqual([]);
  });

  it("grita si se pasó del tope, y si nunca corrió", () => {
    const viejo = new Date(Date.now() - 5 * 3_600_000).toISOString();
    expect(hallazgoDeSincronizacion("Latido", viejo, 2)).toHaveLength(1);
    expect(hallazgoDeSincronizacion("Latido", null, 2)[0].detalle).toContain("Nunca");
  });
});
