import { describe, expect, it } from "vitest";
import { generarDatosDemo, SKUS_DEMO } from "../demo";
import { generarPlan } from "./index";
import { optimizarCajas } from "./boxes";
import { calcularFraccionesConStock, reconstruirStockDiario } from "./stockHistory";
import { aISO, proximoEnvio, sumarDias } from "./fechas";
import type { Caja, DiaStock } from "./types";

const HOY = "2026-08-17";

function dia(p: Partial<DiaStock> & { fecha: string }): DiaStock {
  return {
    inicio: 0,
    fin: 0,
    unidades: 0,
    fraccionConStock: 0,
    origen: "snapshot",
    ...p,
  };
}

// ---------------------------------------------------------------------------
describe("fracciones de día con stock", () => {
  it("cuenta completo un día que nunca se quedó sin nada", () => {
    const dias = [dia({ fecha: "2026-01-01", inicio: 100, fin: 90, unidades: 10 })];
    calcularFraccionesConStock(dias);
    expect(dias[0].fraccionConStock).toBe(1);
  });

  it("cuenta cero un día completamente agotado", () => {
    const dias = [
      dia({ fecha: "2026-01-01", inicio: 20, fin: 0, unidades: 20 }),
      dia({ fecha: "2026-01-02", inicio: 0, fin: 0, unidades: 0 }),
    ];
    calcularFraccionesConStock(dias);
    expect(dias[1].fraccionConStock).toBe(0);
  });

  it("cuenta parcial un día que arrancó con poco y se agotó", () => {
    // 9 días vendiendo 20/día + 1 día que arrancó con 2 piezas.
    const dias: DiaStock[] = [];
    for (let i = 0; i < 9; i++) {
      dias.push(dia({ fecha: `2026-01-0${i + 1}`, inicio: 100, fin: 80, unidades: 20 }));
    }
    dias.push(dia({ fecha: "2026-01-10", inicio: 2, fin: 0, unidades: 2 }));

    calcularFraccionesConStock(dias);
    const ultimo = dias[9];
    // Con 2 piezas y una tasa ~20/día, ese día valió como ~0.1 de día.
    expect(ultimo.fraccionConStock).toBeGreaterThan(0.03);
    expect(ultimo.fraccionConStock).toBeLessThan(0.35);
  });
});

// ---------------------------------------------------------------------------
describe("corrección de demanda por agotamiento", () => {
  it("recupera la demanda real de un SKU que estuvo agotado un tercio del periodo", () => {
    // 60 días vendiendo 10/día, luego 30 días en cero por falta de stock.
    const dias: DiaStock[] = [];
    for (let i = 0; i < 60; i++) {
      dias.push(
        dia({ fecha: sumarDias("2026-05-19", i), inicio: 500, fin: 490, unidades: 10 }),
      );
    }
    for (let i = 0; i < 30; i++) {
      dias.push(dia({ fecha: sumarDias("2026-07-18", i), inicio: 0, fin: 0, unidades: 0 }));
    }

    const tasa = calcularFraccionesConStock(dias);
    // Sin corregir daría 600/90 = 6.67. Corregido debe dar ~10.
    expect(tasa).toBeGreaterThan(9.5);
    expect(tasa).toBeLessThan(10.5);
  });
});

// ---------------------------------------------------------------------------
describe("plan completo sobre datos sintéticos", () => {
  const datos = generarDatosDemo({ hoy: HOY, dias: 90, seed: 42 });
  const plan = generarPlan({
    ...datos,
    parametros: { leadTimeDias: 7, horizonteDias: 30, enviosPorSemana: 2 },
    hoy: HOY,
  });

  it("analiza todos los SKUs", () => {
    expect(plan.lineas).toHaveLength(SKUS_DEMO.length);
  });

  it("recupera la demanda real de cada SKU dentro de un margen razonable", () => {
    const errores: string[] = [];
    for (const linea of plan.lineas) {
      const real = datos.verdad.get(linea.sku)!;
      const estimada = linea.demanda.demandaDiaria;
      const error = Math.abs(estimada - real) / real;
      // SKUs de venta muy baja tienen ruido de Poisson enorme; se les da holgura.
      const tolerancia = real < 4 ? 0.85 : 0.35;
      if (error > tolerancia) {
        errores.push(
          `${linea.sku}: real=${real.toFixed(2)} estimada=${estimada.toFixed(2)} error=${(error * 100).toFixed(0)}%`,
        );
      }
    }
    expect(errores).toEqual([]);
  });

  it("la corrección mejora la estimación en los SKUs que se agotaron", () => {
    // Para los SKUs con quiebres severos, la tasa cruda subestima y la corregida no.
    const conQuiebre = SKUS_DEMO.filter((s) => s.severidadQuiebre >= 0.6).map((s) => s.sku);
    for (const sku of conQuiebre) {
      const l = plan.lineas.find((x) => x.sku === sku)!;
      const real = datos.verdad.get(sku)!;
      const errorCrudo = Math.abs(l.demanda.tasaObservada - real) / real;
      const errorCorregido = Math.abs(l.demanda.demandaDiaria - real) / real;
      expect(errorCorregido).toBeLessThan(errorCrudo);
    }
  });

  it("detecta días sin stock donde los hubo", () => {
    const termo = plan.lineas.find((l) => l.sku === "TER-ACE-1L")!;
    expect(termo.demanda.diasSinStock).toBeGreaterThan(5);
    expect(termo.demanda.factorCorreccion).toBeGreaterThan(1.1);
  });

  it("nunca sugiere cantidades negativas", () => {
    for (const l of plan.lineas) {
      expect(l.sugerido).toBeGreaterThanOrEqual(0);
      expect(l.stockSeguridad).toBeGreaterThanOrEqual(0);
    }
  });

  it("el objetivo cubre el horizonte más el colchón", () => {
    for (const l of plan.lineas) {
      if (l.demanda.demandaDiaria <= 0.005) continue;
      const esperado = l.demanda.demandaDiaria * plan.parametros.horizonteDias + l.stockSeguridad;
      expect(l.nivelObjetivo).toBeGreaterThanOrEqual(Math.floor(esperado));
    }
  });

  it("cuenta lo que está en transferencia como inventario ya puesto", () => {
    for (const l of plan.lineas) {
      expect(l.posicion).toBe(l.disponible + l.enTransferencia);
    }
  });

  it("arma un plan de cajas no vacío y dentro de la disponibilidad", () => {
    expect(plan.cajas.totalCajas).toBeGreaterThan(0);
    for (const elegida of plan.cajas.cajas) {
      const def = datos.cajas.find((c) => c.codigo === elegida.codigo)!;
      expect(elegida.cantidad).toBeLessThanOrEqual(def.cajasDisponibles);
    }
  });

  it("ordena primero lo más urgente", () => {
    const orden = { critico: 0, urgente: 1, ok: 2, sobrestock: 3, sin_demanda: 4 } as const;
    for (let i = 1; i < plan.lineas.length; i++) {
      expect(orden[plan.lineas[i].estado]).toBeGreaterThanOrEqual(
        orden[plan.lineas[i - 1].estado],
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe("optimizador de cajas mixtas", () => {
  const cajas: Caja[] = [
    { codigo: "A", cajasDisponibles: 10, items: [{ sku: "X", piezas: 24 }, { sku: "Y", piezas: 12 }] },
    { codigo: "B", cajasDisponibles: 10, items: [{ sku: "X", piezas: 36 }] },
    { codigo: "C", cajasDisponibles: 10, items: [{ sku: "Y", piezas: 30 }] },
  ];

  it("encuentra la combinación exacta cuando existe", () => {
    // 2 cajas A -> X=48, Y=24. Exacto.
    const r = optimizarCajas({
      necesidad: new Map([["X", 48], ["Y", 24]]),
      prioridad: new Map(),
      cajas,
      permiteUnidadesSueltas: false,
      inventarioSuelto: new Map(),
      pesoFaltante: 3,
      pesoSobrante: 1,
    });
    expect(r.costo).toBe(0);
    expect(r.enviadoPorSku.get("X")).toBe(48);
    expect(r.enviadoPorSku.get("Y")).toBe(24);
  });

  it("respeta el tope de cajas disponibles", () => {
    const r = optimizarCajas({
      necesidad: new Map([["X", 100000]]),
      prioridad: new Map(),
      cajas,
      permiteUnidadesSueltas: false,
      inventarioSuelto: new Map(),
      pesoFaltante: 3,
      pesoSobrante: 1,
    });
    for (const c of r.cajas) {
      const def = cajas.find((x) => x.codigo === c.codigo)!;
      expect(c.cantidad).toBeLessThanOrEqual(def.cajasDisponibles);
    }
  });

  it("prefiere quedarse corto en lo que no urge antes que en lo crítico", () => {
    // X es crítico (prioridad alta), Y no importa mucho.
    const r = optimizarCajas({
      necesidad: new Map([["X", 36], ["Y", 30]]),
      prioridad: new Map([["X", 5], ["Y", 0.2]]),
      cajas,
      permiteUnidadesSueltas: false,
      inventarioSuelto: new Map(),
      pesoFaltante: 3,
      pesoSobrante: 1,
    });
    const faltaX = r.faltantePorSku.get("X") ?? 0;
    expect(faltaX).toBe(0);
  });

  it("no manda nada cuando no se necesita nada", () => {
    const r = optimizarCajas({
      necesidad: new Map(),
      prioridad: new Map(),
      cajas,
      permiteUnidadesSueltas: false,
      inventarioSuelto: new Map(),
      pesoFaltante: 3,
      pesoSobrante: 1,
    });
    expect(r.totalCajas).toBe(0);
    expect(r.costo).toBe(0);
  });

  it("completa con piezas sueltas cuando está permitido", () => {
    const r = optimizarCajas({
      necesidad: new Map([["X", 40]]),
      prioridad: new Map(),
      cajas: [{ codigo: "B", cajasDisponibles: 1, items: [{ sku: "X", piezas: 36 }] }],
      permiteUnidadesSueltas: true,
      inventarioSuelto: new Map([["X", 10]]),
      pesoFaltante: 3,
      pesoSobrante: 1,
    });
    expect(r.enviadoPorSku.get("X")).toBe(40);
    expect(r.sueltas).toEqual([{ sku: "X", piezas: 4 }]);
  });
});

// ---------------------------------------------------------------------------
describe("calendario de envíos", () => {
  it("con 2 envíos por semana propone lunes o jueves", () => {
    for (let i = 0; i < 7; i++) {
      const f = proximoEnvio(sumarDias("2026-08-17", i), 2);
      const dow = new Date(`${f}T00:00:00Z`).getUTCDay();
      expect([1, 4]).toContain(dow);
    }
  });

  it("el próximo envío nunca queda en el pasado", () => {
    const hoy = aISO(new Date());
    expect(proximoEnvio(hoy, 2) >= hoy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("origen del stock histórico", () => {
  const base = {
    skus: ["A"],
    desde: "2026-08-10",
    hasta: "2026-08-12",
    stockActual: new Map([
      ["A", { sku: "A", disponible: 50, enTransferencia: 0, noDisponible: 0, total: 50 }],
    ]),
    ventas: [],
  };

  it("cuando hay movimiento de MELI, ese manda sobre la foto del día", () => {
    // La foto se tomó a las 7am con 80; después del mediodía se vendió hasta
    // quedar en 20. El cierre real del día es 20, no 80.
    const r = reconstruirStockDiario({
      ...base,
      snapshots: [
        { sku: "A", fecha: "2026-08-11", disponible: 80, origen: "snapshot" as const },
      ],
      operaciones: [
        {
          sku: "A",
          fecha: "2026-08-11T18:30:00.000Z",
          tipo: "sale",
          deltaDisponible: -60,
          resultadoDisponible: 20,
        },
      ],
    });

    const dia = r.get("A")!.find((d) => d.fecha === "2026-08-11")!;
    expect(dia.fin).toBe(20);
    expect(dia.origen).toBe("operaciones");
  });

  it("sin movimientos ese día, la foto sí vale", () => {
    // Si nada se movió, la lectura de la mañana es igual a la de la noche.
    const r = reconstruirStockDiario({
      ...base,
      snapshots: [
        { sku: "A", fecha: "2026-08-11", disponible: 80, origen: "snapshot" as const },
      ],
      operaciones: [],
    });

    const dia = r.get("A")!.find((d) => d.fecha === "2026-08-11")!;
    expect(dia.fin).toBe(80);
    expect(dia.origen).toBe("snapshot");
  });

  it("detecta un agotamiento que la foto de la mañana no vería", () => {
    // Foto a las 7am: 40 piezas. Se agotó a las 3pm. Si mandara la foto,
    // el día contaría como surtido y la demanda saldría subestimada.
    const r = reconstruirStockDiario({
      ...base,
      snapshots: [
        { sku: "A", fecha: "2026-08-11", disponible: 40, origen: "snapshot" as const },
      ],
      operaciones: [
        {
          sku: "A",
          fecha: "2026-08-11T15:00:00.000Z",
          tipo: "sale",
          deltaDisponible: -40,
          resultadoDisponible: 0,
        },
      ],
    });

    const dia = r.get("A")!.find((d) => d.fecha === "2026-08-11")!;
    expect(dia.fin).toBe(0);
    expect(dia.origen).toBe("operaciones");
  });
});
