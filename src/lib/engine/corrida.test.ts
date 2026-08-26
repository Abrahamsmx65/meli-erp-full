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

/** Hermanas vendiendo 1.6/día con `dias` días en APTAS; la T22 agotada. */
function datosBase(diasHermanas: number): Map<string, DatosSkuCorrida> {
  const datos = new Map<string, DatosSkuCorrida>();
  datos.set("T22", { disponible: 0, enCamino: 0, demandaDiaria: 1.6 });
  for (const sku of TALLAS.slice(1)) {
    datos.set(sku, { disponible: 1.6 * diasHermanas, enCamino: 0, demandaDiaria: 1.6 });
  }
  return datos;
}

describe("regla de la corrida despareja", () => {
  it("manda la MITAD cuando las hermanas van al día (aptas ≤ 1.3×)", () => {
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

  it("el sobrante de las hermanas se mide en APTAS: lo en camino no las vuelve disparejas", () => {
    // Hermanas con 30 días en aptas + una montaña en camino: para el negocio
    // siguen "al día" (así lee la pantalla) y la regla debe dar MITAD.
    const datos = datosBase(30);
    for (const sku of TALLAS.slice(1)) {
      datos.set(sku, { disponible: 1.6 * 30, enCamino: 100, demandaDiaria: 1.6 });
    }

    const necesidad = new Map([["T22", 48]]);
    const [ajuste] = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajuste.regla).toBe("mitad_corrida");
  });

  it("solo cubre 7 días de venta cuando alguna hermana pasa del 1.3×", () => {
    // Una hermana con 60 días en aptas (2× su venta de 30): corrida dispareja.
    // La talla agotada trae 15 pares APTOS y aun así viajan sus 7 días: lo
    // apto ya se está vendiendo y no descuenta.
    const datos = datosBase(30);
    datos.set("T27", { disponible: 1.6 * 60, enCamino: 0, demandaDiaria: 1.6 });
    datos.set("T22", { disponible: 15, enCamino: 0, demandaDiaria: 1.6 });

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

  it("lo EN CAMINO sí descuenta los 7 días de la corrida dispareja", () => {
    const datos = datosBase(30);
    datos.set("T27", { disponible: 1.6 * 60, enCamino: 0, demandaDiaria: 1.6 });
    datos.set("T22", { disponible: 0, enCamino: 30, demandaDiaria: 1.6 });

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
    datos.set("T27", { disponible: 20, enCamino: 0, demandaDiaria: 0 });

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
    datos.set("T27", { disponible: 0, enCamino: 0, demandaDiaria: 0 });

    const necesidad = new Map([["T22", 48]]);
    const [ajuste] = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [cajaCorrida()],
      horizonteDias: 30,
    });

    expect(ajuste.regla).toBe("mitad_corrida");
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
    datos.set("T23", { disponible: 0, enCamino: 0, demandaDiaria: 1.6 });

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
    // específica de 0 (lo recortado se surte completo), suben las 2 cajas
    // que lo tapan.
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
      toleranciaRescatePorSku: new Map([["T22", 0]]),
    });
    expect(conAjuste.totalCajas).toBe(2);
    expect(conAjuste.enviadoPorSku.get("T22")).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Los dos casos reales con los que se calibró la regla (26-ago-2026).
describe("casos reales de calibración", () => {
  it("GT135 DK BROWN: hermanas al día en aptas (aunque traigan en camino) → mitad", () => {
    const S = (t: string) => `GT135-DK BROWN-${t}-MX`;
    const caja: Caja = {
      codigo: "DK",
      cajasDisponibles: 8,
      items: [
        { sku: S("23"), piezas: 2 }, { sku: S("24"), piezas: 4 }, { sku: S("25"), piezas: 6 },
        { sku: S("26"), piezas: 5 }, { sku: S("27"), piezas: 4 }, { sku: S("28"), piezas: 3 },
      ],
    };
    const datos = new Map<string, DatosSkuCorrida>([
      [S("23"), { disponible: 25, enCamino: 12, demandaDiaria: 0.97 }],
      [S("24"), { disponible: 50, enCamino: 24, demandaDiaria: 1.7 }],
      [S("25"), { disponible: 81, enCamino: 44, demandaDiaria: 2.67 }],
      [S("26"), { disponible: 71, enCamino: 30, demandaDiaria: 2.56 }],
      [S("27"), { disponible: 9, enCamino: 28, demandaDiaria: 3.13 }],
      [S("28"), { disponible: 16, enCamino: 18, demandaDiaria: 2.2 }],
    ]);
    // Sugeridos del plan real: la 27 con 12 días de cobertura pedía 84.
    const necesidad = new Map([[S("27"), 84], [S("28"), 50], [S("23"), 1]]);

    const ajustes = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [caja],
      horizonteDias: 30,
    });

    // Las hermanas 24/25/26 traen ~30 días en aptas: corrida PAREJA, viaja
    // la mitad (con la posición completa dentro del cálculo salían 1.56× y
    // la regla mataba el envío de un modelo que se está quedando sin 27/28).
    const a27 = ajustes.find((a) => a.sku === S("27"));
    expect(a27?.regla).toBe("mitad_corrida");
    expect(a27?.necesidadAjustada).toBe(42);
    expect(necesidad.get(S("28"))).toBe(25);
  });

  it("GT155 BEIGE: hermanas con 2× en aptas → solo 7 días de venta de las agotadas", () => {
    const B = (t: string) => `GT155-BEIGE-${t}-MX`;
    const caja: Caja = {
      codigo: "IN10119",
      cajasDisponibles: 28,
      items: [
        { sku: B("23"), piezas: 3 }, { sku: B("24"), piezas: 7 }, { sku: B("25"), piezas: 8 },
        { sku: B("26"), piezas: 4 }, { sku: B("27"), piezas: 2 },
      ],
    };
    const datos = new Map<string, DatosSkuCorrida>([
      [B("23"), { disponible: 22, enCamino: 0, demandaDiaria: 0.32 }],
      [B("24"), { disponible: 51, enCamino: 5, demandaDiaria: 0.97 }],
      [B("25"), { disponible: 59, enCamino: 1, demandaDiaria: 0.96 }],
      [B("26"), { disponible: 8, enCamino: 0, demandaDiaria: 0.67 }],
      [B("27"), { disponible: 9, enCamino: 0, demandaDiaria: 0.37 }],
    ]);
    const necesidad = new Map([[B("26"), 20], [B("27"), 10]]);

    const ajustes = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [caja],
      horizonteDias: 30,
    });

    // 23/24/25 traen 1.8–2.3× su venta de 30 días: dispareja. Viajan solo
    // los 7 días de venta de la 26 (5 pzas) y de la 27 (3 pzas) — con la
    // corrida de 4 y 2 pares, eso son ~2 cajas en vez de las 5 de antes.
    expect(ajustes.map((a) => a.regla)).toEqual(["solo_7_dias", "solo_7_dias"]);
    expect(necesidad.get(B("26"))).toBe(5);
    expect(necesidad.get(B("27"))).toBe(3);

    const r = optimizarCajas({
      necesidad,
      prioridad: new Map([[B("26"), 1.8], [B("27"), 1.8]]),
      castigoSobrante: new Map([
        [B("23"), 2.5], [B("24"), 2.5], [B("25"), 2.5], [B("26"), 0.4], [B("27"), 0.4],
      ]),
      demandaDiaria: new Map([...datos.entries()].map(([s, d]) => [s, d.demandaDiaria])),
      cajas: [caja],
      permiteUnidadesSueltas: false,
      inventarioSuelto: new Map(),
      pesoFaltante: 3,
      pesoSobrante: 1,
      toleranciaRescateDias: 7,
      toleranciaRescatePorSku: new Map([[B("26"), 0], [B("27"), 0]]),
    });
    expect(r.totalCajas).toBe(2);
  });
});
