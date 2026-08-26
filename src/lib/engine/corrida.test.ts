import { describe, expect, it } from "vitest";
import { ajustarNecesidadPorCorrida, type DatosSkuCorrida } from "./corrida";
import { optimizarCajas } from "./boxes";
import type { Caja } from "./types";

/**
 * Corrida típica: 6 tallas, 8 pares cada una (48 por caja). La talla 22 se
 * agotó; las demás traen lo que diga cada prueba.
 */
const TALLAS = ["T22", "T23", "T24", "T25", "T26", "T27"];

function cajaCorrida(disponibles = 10): Caja {
  return {
    codigo: "C1",
    cajasDisponibles: disponibles,
    items: TALLAS.map((sku) => ({ sku, piezas: 8 })),
  };
}

/** Hermanas vendiendo 1.6/día con `dias` días de stock; la T22 agotada. */
function datosBase(diasHermanas: number): Map<string, DatosSkuCorrida> {
  const datos = new Map<string, DatosSkuCorrida>();
  datos.set("T22", { posicion: 0, demandaDiaria: 1.6 });
  for (const sku of TALLAS.slice(1)) {
    datos.set(sku, { posicion: 1.6 * diasHermanas, demandaDiaria: 1.6 });
  }
  return datos;
}

describe("regla de la corrida despareja", () => {
  it("manda la MITAD cuando las hermanas van al día (sobrante ≤ 1.3×)", () => {
    // T22 pide 48 (30 días a 1.6/día); las hermanas traen 30 días justos.
    const necesidad = new Map([["T22", 48]]);
    const ajustes = ajustarNecesidadPorCorrida({
      necesidad,
      datos: datosBase(30),
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajustes).toEqual([
      {
        sku: "T22",
        regla: "mitad_corrida",
        necesidadOriginal: 48,
        necesidadAjustada: 24,
        peorSobrante: 1,
      },
    ]);
    expect(necesidad.get("T22")).toBe(24);
  });

  it("solo cubre 7 días cuando alguna hermana pasa del 1.3×", () => {
    // Una hermana con 60 días de stock (2× su venta de 30): corrida dispareja.
    const datos = datosBase(30);
    datos.set("T27", { posicion: 1.6 * 60, demandaDiaria: 1.6 });

    const necesidad = new Map([["T22", 48]]);
    const [ajuste] = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajuste.regla).toBe("solo_7_dias");
    // 1.6/día × 7 días = 11.2 → 12 piezas.
    expect(ajuste.necesidadAjustada).toBe(12);
    expect(necesidad.get("T22")).toBe(12);
  });

  it("no recorta nada cuando la mitad o más de la caja tapa faltantes reales", () => {
    // Tres tallas piden a la vez: 24 de las 48 piezas de la caja son útiles.
    const necesidad = new Map([["T22", 48], ["T23", 48], ["T24", 48]]);
    const ajustes = ajustarNecesidadPorCorrida({
      necesidad,
      datos: datosBase(30),
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajustes).toEqual([]);
    expect(necesidad.get("T22")).toBe(48);
  });

  it("una hermana sin amarre (sin datos) vuelve la corrida dispareja", () => {
    const datos = datosBase(30);
    datos.delete("T27"); // la caja la trae, el plan no la conoce

    const necesidad = new Map([["T22", 48]]);
    const [ajuste] = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajuste.regla).toBe("solo_7_dias");
  });

  it("una hermana con stock parado y sin venta vuelve la corrida dispareja", () => {
    const datos = datosBase(30);
    datos.set("T27", { posicion: 20, demandaDiaria: 0 });

    const necesidad = new Map([["T22", 48]]);
    const [ajuste] = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajuste.regla).toBe("solo_7_dias");
  });

  it("una hermana VACÍA sin venta no cuenta como sobrante", () => {
    // Que a una talla vacía le llegue caja no es sobrar: sigue siendo mitad.
    const datos = datosBase(30);
    datos.set("T27", { posicion: 0, demandaDiaria: 0 });

    const necesidad = new Map([["T22", 48]]);
    const [ajuste] = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajuste.regla).toBe("mitad_corrida");
  });

  it("si los 7 días ya están cubiertos, la talla no pide nada", () => {
    const datos = datosBase(30);
    datos.set("T27", { posicion: 1.6 * 60, demandaDiaria: 1.6 }); // dispareja
    datos.set("T22", { posicion: 15, demandaDiaria: 1.6 }); // 9.4 días de stock

    const necesidad = new Map([["T22", 33]]);
    const [ajuste] = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajuste.regla).toBe("solo_7_dias");
    expect(ajuste.necesidadAjustada).toBe(0);
    expect(necesidad.has("T22")).toBe(false);
  });

  it("sin caja disponible que traiga la talla, no hay nada que recortar", () => {
    const necesidad = new Map([["T22", 48]]);
    const ajustes = ajustarNecesidadPorCorrida({
      necesidad,
      datos: datosBase(30),
      cajas: [cajaCorrida(0)], // agotada en bodega
      horizonteDias: 30,
    });

    expect(ajustes).toEqual([]);
    expect(necesidad.get("T22")).toBe(48);
  });

  it("el recorte de una talla no cambia el veredicto de otra de la misma corrida", () => {
    // Dos tallas agotadas (16 de 48 piezas útiles: la regla aplica a ambas).
    // Ambas deben decidirse contra la necesidad ORIGINAL, no contra la ya
    // recortada de la primera.
    const datos = datosBase(30);
    datos.set("T23", { posicion: 0, demandaDiaria: 1.6 });

    const necesidad = new Map([["T22", 48], ["T23", 48]]);
    const ajustes = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajustes).toHaveLength(2);
    expect(ajustes.every((a) => a.regla === "mitad_corrida")).toBe(true);
    expect(necesidad.get("T22")).toBe(24);
    expect(necesidad.get("T23")).toBe(24);
  });
});

describe("tolerancia de rescate por SKU en el optimizador", () => {
  it("una talla recortada a 7 días sí fuerza su caja aunque el hueco sea chico", () => {
    // Necesidad ya recortada a 12 piezas (7 días a 1.6/día). Con la
    // tolerancia general de 23 días ese hueco jamás se rescataría; con la
    // específica de 2 días, suben las 2 cajas que lo tapan.
    const entrada = {
      necesidad: new Map([["T22", 12]]),
      prioridad: new Map([["T22", 3]]),
      castigoSobrante: new Map(TALLAS.slice(1).map((s) => [s, 2.5] as [string, number])),
      demandaDiaria: new Map(TALLAS.map((s) => [s, 1.6] as [string, number])),
      cajas: [cajaCorrida()],
      permiteUnidadesSueltas: false,
      inventarioSuelto: new Map<string, number>(),
      pesoFaltante: 3,
      pesoSobrante: 1,
      toleranciaRescateDias: 23,
    };

    const sinAjuste = optimizarCajas(entrada);
    expect(sinAjuste.totalCajas).toBe(0);

    const conAjuste = optimizarCajas({
      ...entrada,
      toleranciaRescatePorSku: new Map([["T22", 2]]),
    });
    expect(conAjuste.totalCajas).toBe(2);
    expect(conAjuste.enviadoPorSku.get("T22")).toBe(16);
  });
});
