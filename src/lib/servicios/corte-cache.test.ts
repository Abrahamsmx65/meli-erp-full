import { describe, expect, it } from "vitest";
import { corteNecesitaRefresco, obtenerConCachePorPeriodo } from "./corte-cache";

describe("obtenerConCachePorPeriodo", () => {
  const guardado = (datos: unknown, vigente: boolean) =>
    async () => ({ estado: "encontrado" as const, valor: { datos: datos as number, generadoEn: new Date().toISOString(), vigente } });

  it("la pantalla SIRVE el renglón invalidado (y no calcula en el clic)", async () => {
    let calculos = 0;
    const v = await obtenerConCachePorPeriodo<number>({
      periodo: "2026-08",
      leer: guardado(10, false),
      guardar: async () => undefined,
      calcular: async () => {
        calculos++;
        return 99;
      },
    });
    expect(v).toBe(10);
    expect(calculos).toBe(0);
  });

  it("quien congela lo que lee (corte general) recalcula el renglón invalidado en vez de servirlo viejo", async () => {
    let guardadoEn: number | null = null;
    const v = await obtenerConCachePorPeriodo<number>({
      periodo: "2026-08",
      exigirVigente: true,
      leer: guardado(10, false),
      guardar: async (datos) => {
        guardadoEn = datos;
      },
      calcular: async () => 99,
    });
    expect(v).toBe(99);
    expect(guardadoEn).toBe(99);
  });

  it("si el recálculo truena usa el guardado y lo declara, para que el derivado no se congele", async () => {
    const motivos: string[] = [];
    const v = await obtenerConCachePorPeriodo<number>({
      periodo: "2026-08",
      exigirVigente: true,
      alUsarInvalidado: (motivo) => motivos.push(motivo),
      leer: guardado(10, false),
      guardar: async () => undefined,
      calcular: async () => {
        throw new Error("MELI no contestó");
      },
    });
    expect(v).toBe(10);
    expect(motivos).toEqual(["MELI no contestó"]);
  });

  it("un renglón vigente no se recalcula aunque se exija vigente", async () => {
    let calculos = 0;
    const v = await obtenerConCachePorPeriodo<number>({
      periodo: "2026-08",
      exigirVigente: true,
      leer: guardado(10, true),
      guardar: async () => undefined,
      calcular: async () => {
        calculos++;
        return 99;
      },
    });
    expect(v).toBe(10);
    expect(calculos).toBe(0);
  });
});

const min = (n: number) => n * 60_000;
const h = (n: number) => n * 3_600_000;

describe("corteNecesitaRefresco", () => {
  // "Hoy" fijo: 15 de septiembre de 2026, mediodía UTC.
  const ahora = Date.parse("2026-09-15T12:00:00Z");
  const hoyPeriodo = "2026-09";

  it("mes corriente: fresco dentro de 10 minutos, refresco después", () => {
    expect(corteNecesitaRefresco("2026-09", new Date(ahora - min(5)).toISOString(), true, ahora, hoyPeriodo)).toBe(false);
    expect(corteNecesitaRefresco("2026-09", new Date(ahora - min(11)).toISOString(), true, ahora, hoyPeriodo)).toBe(true);
  });

  it("invalidado siempre se refresca", () => {
    expect(corteNecesitaRefresco("2026-08", new Date(ahora - min(1)).toISOString(), false, ahora, hoyPeriodo)).toBe(true);
  });

  it("mes cerrado calculado con el mes aún abierto: le faltan días, se refresca", () => {
    // Agosto calculado el 31 de agosto por la tarde (antes de la medianoche MX).
    expect(corteNecesitaRefresco("2026-08", "2026-08-31T20:00:00Z", true, ahora, hoyPeriodo)).toBe(true);
  });

  it("mes cerrado calculado ya cerrado: congelado hasta 6 horas", () => {
    expect(corteNecesitaRefresco("2026-08", new Date(ahora - h(2)).toISOString(), true, ahora, hoyPeriodo)).toBe(false);
    expect(corteNecesitaRefresco("2026-08", new Date(ahora - h(7)).toISOString(), true, ahora, hoyPeriodo)).toBe(true);
  });

  it("sin fecha legible se refresca", () => {
    expect(corteNecesitaRefresco("2026-08", "no-es-fecha", true, ahora, hoyPeriodo)).toBe(true);
  });
});
