import { describe, expect, it } from "vitest";
import {
  correoDeSalud,
  debeAvisar,
  diasDelMes,
  hallazgoDeSincronizacion,
  hallazgosDeFacturacion,
  hallazgosDeFuentes,
  hallazgosDelMes,
  huellaDeSalud,
  mesesEntre,
  type FuentesDelMes,
  type MesDeCorte,
} from "./salud";

/**
 * Las reglas de la revisión general, probadas con lo que DE VERDAD pasó en
 * septiembre y octubre de 2026. Si alguna deja de gritar, el dueño vuelve a
 * cazar el problema a mano, que es justo lo que se quiso quitar.
 */
const HOY = "2026-10";
const HOY_FECHA = "2026-10-06";

const canal = (c: string, venta: number, cobertura: number | null, calculable = true) => ({ canal: c, venta, cobertura, calculable });

const sano: MesDeCorte = {
  periodo: "2026-07",
  generadoEn: new Date().toISOString(),
  vigente: true,
  motivo: null,
  canales: [canal("amazon", 6001114.93, null), canal("meli_calzado", 5430185.99, 1), canal("meli_fundas", 5618895.46, 0.997)],
  ventaTotal: 17050196.38,
  ventaCanales: 17050196.38,
  exacto: false,
  avisos: 12,
  avisosTimeout: 0,
};

describe("un mes del corte general", () => {
  it("no dice nada de un mes completo y cuadrado", () => {
    expect(hallazgosDelMes(sano, undefined, HOY)).toEqual([]);
  });

  it("grita el canal que falta: así desapareció Amazon de julio", () => {
    const h = hallazgosDelMes({
      ...sano,
      canales: sano.canales.filter((k) => k.canal !== "amazon"),
      ventaTotal: 11049081.45,
      ventaCanales: 11049081.45,
      motivo: "Amazon no se pudo cargar (amazon_pagos: canceling statement due to statement timeout).",
    }, undefined, HOY);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("grave");
    expect(h[0].que).toContain("Amazon no está en el corte");
    expect(h[0].detalle).toContain("statement timeout");
  });

  it("grita un canal con venta y 0 % de depósitos: la columna de ceros de mayo 2026", () => {
    const h = hallazgosDelMes({
      ...sano,
      periodo: "2026-05",
      canales: [canal("amazon", 7358757.44, null), canal("meli_calzado", 1969949.51, 0, false), canal("meli_fundas", 12830069.78, 0.858)],
      ventaTotal: 20188827.22,
      ventaCanales: 20188827.22,
    }, undefined, HOY);
    const calzado = h.find((x) => x.que.includes("Calzado"))!;
    expect(calzado.severidad).toBe("grave");
    expect(calzado.que).toContain("NO tiene ni un depósito leído");
    // Fundas al 85.8 % en un mes de hace 5 meses ya no es «falta»: es grave.
    const fundas = h.find((x) => x.que.includes("Fundas"))!;
    expect(fundas.severidad).toBe("grave");
    expect(fundas.que).toContain("86 %");
  });

  it("un mes recién cerrado con depósitos a medias es una falta, no un problema", () => {
    const h = hallazgosDelMes({
      ...sano,
      periodo: "2026-09",
      canales: [canal("meli_calzado", 1000, 0.8)],
      ventaTotal: 1000,
      ventaCanales: 1000,
    }, ["meli_calzado"], HOY);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("falta");
  });

  it("el mes en curso a medias no dice nada: se está leyendo", () => {
    const h = hallazgosDelMes({
      ...sano,
      periodo: HOY,
      canales: [canal("meli_calzado", 1000, 0.5)],
      ventaTotal: 1000,
      ventaCanales: 1000,
    }, ["meli_calzado"], HOY);
    expect(h).toEqual([]);
  });

  it("un canal sin venta no se reclama aunque no tenga cobertura", () => {
    const h = hallazgosDelMes({ ...sano, canales: [...sano.canales, canal("tiktok", 0, 0)] }, undefined, HOY);
    expect(h).toEqual([]);
  });

  it("grita una fuente caída aunque los tres canales estén", () => {
    const h = hallazgosDelMes({ ...sano, avisosTimeout: 2 }, undefined, HOY);
    expect(h.map((x) => x.severidad)).toEqual(["grave"]);
    expect(h[0].que).toContain("no respondió");
  });

  it("grita cuando el total no cuadra con la suma de sus canales calculables", () => {
    const h = hallazgosDelMes({ ...sano, ventaCanales: 17050196.38 - 250000 }, undefined, HOY);
    expect(h).toHaveLength(1);
    expect(h[0].detalle).toContain("sobran");
  });

  it("aguanta el redondeo de centavos sin gritar", () => {
    expect(hallazgosDelMes({ ...sano, ventaCanales: sano.ventaCanales! - 0.9 }, undefined, HOY)).toEqual([]);
  });

  it("un canal que el negocio no tiene conectado no se reclama", () => {
    expect(hallazgosDelMes({ ...sano, canales: [canal("meli_calzado", 10, 1)], ventaTotal: 10, ventaCanales: 10 }, ["meli_calzado"], HOY)).toEqual([]);
  });

  it("un renglón marcado para rehacerse hace un rato no molesta; uno de ayer sí", () => {
    const hace2h = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const ayer = new Date(Date.now() - 30 * 3_600_000).toISOString();
    expect(hallazgosDelMes({ ...sano, vigente: false, generadoEn: hace2h }, undefined, HOY)).toEqual([]);
    const h = hallazgosDelMes({ ...sano, vigente: false, generadoEn: ayer, motivo: "Entraron netos reales." }, undefined, HOY);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("falta");
  });
});

const fuente = (mes: string, extra: Partial<FuentesDelMes> = {}): FuentesDelMes => ({
  mes,
  ventaCalzado: 1_000_000,
  ordenesCalzado: 5000,
  ordenesRegistradas: 5000,
  ordenesConDeposito: 5000,
  cargos: 9000,
  diasPublicidad: diasDelMes(mes),
  ventaFundas: 2_000_000,
  ordenesFundas: 40000,
  fundasConDeposito: 40000,
  ventaAmazon: 5_000_000,
  eventosAmazon: 25000,
  gruposAmazonDescuadrados: 0,
  descuadreAmazon: 0,
  ...extra,
});

describe("las fuentes, un hallazgo por causa", () => {
  it("un mes completo no dice nada", () => {
    expect(hallazgosDeFuentes([fuente("2026-08"), fuente("2026-09")], HOY_FECHA)).toEqual([]);
  });

  it("la facturación de MELI que falta en mayo, junio y julio es UN hallazgo, no tres", () => {
    const h = hallazgosDeFuentes([
      fuente("2026-05", { cargos: 0 }), fuente("2026-06", { cargos: 0 }), fuente("2026-07", { cargos: 0 }),
      fuente("2026-08"), fuente("2026-09"),
    ], HOY_FECHA);
    expect(h).toHaveLength(1);
    expect(h[0].area).toBe("Facturación de MELI");
    expect(h[0].severidad).toBe("grave");
    expect(h[0].que).toContain("3 mes(es)");
    expect(h[0].detalle).toContain("2026-05, 2026-06, 2026-07");
  });

  it("la facturación del mes en curso sin leer es una falta aparte", () => {
    const h = hallazgosDeFuentes([fuente("2026-10", { cargos: 0 })], HOY_FECHA);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("falta");
    expect(h[0].periodo).toBe("2026-10");
  });

  it("un mes con venta de calzado y sin facturación NO se reclama si no vendió calzado (enero–abril)", () => {
    const h = hallazgosDeFuentes([fuente("2026-02", { ventaCalzado: 0, ordenesCalzado: 0, cargos: 0, diasPublicidad: 0 })], HOY_FECHA);
    expect(h).toEqual([]);
  });

  it("las órdenes de calzado sin registrar (mayo 2026) salen con cuántas faltan", () => {
    const h = hallazgosDeFuentes([fuente("2026-05", { ordenesRegistradas: 0 }), fuente("2026-06", { ordenesRegistradas: 1400 })], HOY_FECHA);
    const o = h.find((x) => x.area === "Órdenes de calzado")!;
    expect(o.severidad).toBe("grave");
    expect(o.detalle).toContain("2026-05 (0 de ~5,000 órdenes)");
    expect(o.detalle).toContain("2026-06 (1,400 de ~5,000 órdenes)");
  });

  it("la publicidad de MELI vieja dice que ya solo se captura a mano (ventana de 90 días)", () => {
    const h = hallazgosDeFuentes([fuente("2026-05", { diasPublicidad: 0 }), fuente("2026-09", { diasPublicidad: 20 })], HOY_FECHA);
    const p = h.find((x) => x.area === "Publicidad de MELI")!;
    expect(p.detalle).toContain("2026-05 (sin nada, ya fuera de la ventana de 90 días: solo a mano)");
    expect(p.detalle).toContain("2026-09 (20 de 30 días)");
    expect(p.detalle).not.toContain("2026-09 (20 de 30 días, ya fuera");
  });

  it("las liquidaciones de Amazon que no cuadran salen juntas, con el monto", () => {
    const h = hallazgosDeFuentes([
      fuente("2026-05", { gruposAmazonDescuadrados: 2, descuadreAmazon: 234.48 }),
      fuente("2026-08", { gruposAmazonDescuadrados: 2, descuadreAmazon: 686.23 }),
    ], HOY_FECHA);
    const a = h.find((x) => x.area === "Liquidaciones de Amazon")!;
    expect(a.que).toContain("4 liquidación(es)");
    expect(a.que).toContain("$920.71");
  });

  it("un mes con venta en Amazon y sin eventos de la Finances API es un mes a ciegas", () => {
    const h = hallazgosDeFuentes([fuente("2026-02", { ventaCalzado: 0, ordenesCalzado: 0, cargos: 0, diasPublicidad: 0, eventosAmazon: 0 })], HOY_FECHA);
    expect(h).toHaveLength(1);
    expect(h[0].area).toBe("Finanzas de Amazon");
  });
});

describe("la facturación de MELI contra lo que MELI declara", () => {
  const avance = (periodo: string, x: Partial<Parameters<typeof hallazgosDeFacturacion>[0][number]> = {}) => ({
    periodo, leidos: 70_000, total: 70_000, completo: true, leidoEn: "2026-10-06T10:00:00Z", error: null, ...x,
  });

  it("un mes leído completo después de cerrar no dice nada", () => {
    expect(hallazgosDeFacturacion([avance("2026-08")], [fuente("2026-08")], HOY_FECHA)).toEqual([]);
  });

  it("agosto 2026 en 9,900 de 74,059 renglones es grave, con el error que lo detuvo", () => {
    const h = hallazgosDeFacturacion(
      [avance("2026-08", { leidos: 9_900, total: 74_059, completo: false, error: "MELI 422: offset + limit > 10_000" })],
      [fuente("2026-08")],
      HOY_FECHA,
    );
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("grave");
    expect(h[0].que).toContain("a medias");
    expect(h[0].detalle).toContain("2026-08 (9,900 de 74,059 renglones; MELI 422");
  });

  it("el mes en curso a medias es solo una falta (se sigue leyendo)", () => {
    const h = hallazgosDeFacturacion([avance("2026-10", { leidos: 3_000, total: 12_000, completo: false })], [fuente("2026-10")], HOY_FECHA);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("falta");
  });

  it("septiembre 2026 dado por completo el 7-sep se reclama: se leyó con el mes abierto", () => {
    const h = hallazgosDeFacturacion([avance("2026-09", { leidos: 9_132, total: 9_132, leidoEn: "2026-09-07T14:33:25Z" })], [fuente("2026-09")], HOY_FECHA);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("falta");
    expect(h[0].que).toContain("con el mes todavía abierto");
    expect(h[0].detalle).toContain("2026-09 (leído el 2026-09-07, 9,132 renglones)");
  });

  it("un mes sin venta de calzado o sin lectura no se juzga aquí (eso lo dice la de fuentes)", () => {
    expect(hallazgosDeFacturacion(
      [avance("2026-02", { leidos: 10, total: 100 }), avance("2026-05", { leidos: 0, total: null, completo: false, leidoEn: null })],
      [fuente("2026-02", { ventaCalzado: 0 }), fuente("2026-05", { cargos: 0 })],
      HOY_FECHA,
    )).toEqual([]);
  });
});

describe("el correo solo sale cuando cambia", () => {
  const salud = (graves: { area: string; periodo: string | null; que: string }[]) => ({
    revisadoEn: "", meses: [], fuentes: [], errores: [], faltas: [],
    graves: graves.map((g) => ({ ...g, severidad: "grave" as const, detalle: "x" })),
  });

  it("la huella no depende del orden ni del detalle", () => {
    const a = huellaDeSalud(salud([{ area: "A", periodo: "2026-05", que: "q1" }, { area: "B", periodo: null, que: "q2" }]));
    const b = huellaDeSalud(salud([{ area: "B", periodo: null, que: "q2" }, { area: "A", periodo: "2026-05", que: "q1" }]));
    expect(a).toBe(b);
  });

  it("sin aviso previo se manda si hay algo; con el mismo hallazgo de ayer, no", () => {
    const h = huellaDeSalud(salud([{ area: "A", periodo: null, que: "q" }]));
    expect(debeAvisar(h, null)).toBe(true);
    expect(debeAvisar(h, { huella: h, enviadoEn: "", graves: 1 })).toBe(false);
    expect(debeAvisar(h + "\nB||otra", { huella: h, enviadoEn: "", graves: 1 })).toBe(true);
  });

  it("cuando se limpia, manda UN correo de «ya no hay nada» y nunca más", () => {
    const limpio = salud([]);
    expect(correoDeSalud(limpio, null)).toBeNull();
    expect(correoDeSalud(limpio, { huella: "", enviadoEn: "", graves: 0 })).toBeNull();
    expect(correoDeSalud(limpio, { huella: "A||q", enviadoEn: "", graves: 1 })?.asunto).toContain("ya no hay problemas");
    expect(debeAvisar(huellaDeSalud(limpio), { huella: "A||q", enviadoEn: "", graves: 1 })).toBe(true);
    expect(debeAvisar(huellaDeSalud(limpio), null)).toBe(false);
  });
});

describe("utilidades", () => {
  it("cuenta meses y días", () => {
    expect(mesesEntre("2026-05", "2026-10")).toBe(5);
    expect(mesesEntre("2025-12", "2026-01")).toBe(1);
    expect(diasDelMes("2026-02")).toBe(28);
    expect(diasDelMes("2026-09")).toBe(30);
  });

  it("una sincronización vieja o inexistente grita", () => {
    expect(hallazgoDeSincronizacion("Latido", new Date().toISOString(), 2)).toEqual([]);
    expect(hallazgoDeSincronizacion("Latido", null, 2)[0].detalle).toContain("Nunca");
  });
});
