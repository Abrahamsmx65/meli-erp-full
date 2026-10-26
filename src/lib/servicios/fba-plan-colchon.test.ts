import { describe, expect, it } from "vitest";
import { construirCajas } from "../importar/cajas";
import { construirIndice } from "../importar/sku";
import { indexarCatalogo } from "../etiquetas/resolver";
import { planFbaConCajas, type VentaDiaFba } from "./fba-plan";
import { mapaCorridas, sugerirEnvioFba } from "./fba";
import { normalizarParametros } from "../engine/params";
import { sumarDias } from "../engine/fechas";
import type { RenglonAmazon } from "./amazon";

// FBA con las MISMAS reglas que Full (dueño, 21-oct-2026): colchón de
// subida con objetivo de 45 (+7) días, tope del color y a lo más 5 cajas
// del color por envío.
const SKUS = ["26", "27"].map((t) => ({
  sku: `GT156-BLK-${t}-MX`,
  modelo: "GT156",
  color: "BLK",
  talla: t,
}));
const EXISTENCIAS = [
  {
    almacen: "EnvioPack",
    codigoAlmacen: "",
    skuCaja: "IN10078-GT156-BLK",
    pedido: "IN10078",
    modelo: "GT156",
    color: "BLK",
    talla: "CORRIDA",
    contenedor: "",
    cajasFisicas: 30,
    cajasApartadas: 0,
    enCamino: 0,
    cajasDisponibles: 30,
    paresPorCaja: 12,
    paresDisponibles: 0,
  },
];
const CORRIDAS = [
  { pedido: "IN10078", modelo: "GT156", color: "BLK", tallas: { "26": 6, "27": 6 }, total: 12 },
];
const HOY = "2026-10-21";

function renglon(t: string): RenglonAmazon {
  return {
    sku: `GT156-BLK-${t}-MX`,
    titulo: null,
    asin: null,
    unidades: 30,
    ordenes: 30,
    importe: 0,
    disponible: 20,
    enTransferencia: 0,
    totalFba: 20,
    cobertura: null,
  };
}

function ventas(porDia: number): VentaDiaFba[] {
  const out: VentaDiaFba[] = [];
  for (let i = 1; i <= 14; i++) {
    for (const t of ["26", "27"]) {
      out.push({ sku: `GT156-BLK-${t}-MX`, fecha: sumarDias(HOY, -i), unidades: porDia });
    }
  }
  return out;
}

function plan(v: VentaDiaFba[] | undefined) {
  const catalogo = construirCajas(EXISTENCIAS as any, CORRIDAS as any, {
    indice: construirIndice(SKUS.map((s) => s.sku)),
    mapeoManual: new Map(),
    almacenes: ["Caseshop", "EnvioPack", "Industher"],
  }).cajas;
  return planFbaConCajas({
    renglones: [renglon("26"), renglon("27")],
    dias: 30,
    catalogo,
    indiceMeli: indexarCatalogo(SKUS as any),
    parametros: normalizarParametros({}),
    hoy: HOY,
    ventasRecientes: v,
  });
}

describe("colchón de subida en FBA", () => {
  it("sin subida: el objetivo de siempre (37 días)", () => {
    const p = plan(ventas(1));
    expect(p.ajustesCorrida).toHaveLength(0);
    // 1 al día × 37 − 20 = 17 por talla → 3 cajas de 6.
    expect(p.cajas[0].cantidad).toBe(3);
  });

  it("vende el doble en 2 semanas: va en subida, pero a lo más 5 cajas del color", () => {
    const p = plan(ventas(2));
    const reglas = new Set(p.ajustesCorrida.map((a) => a.regla));
    expect(reglas.has("colchon")).toBe(true);
    expect(reglas.has("tope_color")).toBe(true);
    expect(p.cajas[0].cantidad).toBe(5);
  });

  it("sin la venta reciente no hay colchón", () => {
    expect(plan(undefined).cajas[0].cantidad).toBe(3);
  });

  it("«Por producto» dice lo mismo que el plan de cajas", () => {
    const p = plan(ventas(2));
    const sug = sugerirEnvioFba(
      [renglon("26"), renglon("27")],
      30,
      mapaCorridas(CORRIDAS as any),
      undefined,
      indexarCatalogo(SKUS as any),
      p,
    );
    expect(sug).toHaveLength(1);
    expect(sug[0].cajas).toBe(5);
    expect(sug[0].pares).toBe(60);
    expect(sug[0].ajusteCorrida).toBe("tope_color");
  });

  it("el máximo de 5 cajas es por COLOR completo, aunque haya cajas de una talla", () => {
    // GT142 PINK en FBA pedía 6: una caja de una talla por talla, 5 de cada una.
    const existencias = ["26", "27"].map((t) => ({
      ...EXISTENCIAS[0],
      skuCaja: `IN10078-GT156-BLK-${t}`,
      talla: t,
      paresPorCaja: 6,
    }));
    const catalogo = construirCajas(existencias as any, [], {
      indice: construirIndice(SKUS.map((s) => s.sku)),
      mapeoManual: new Map(),
      almacenes: ["Caseshop", "EnvioPack", "Industher"],
    }).cajas;
    const p = planFbaConCajas({
      renglones: [renglon("26"), renglon("27")],
      dias: 30,
      catalogo,
      indiceMeli: indexarCatalogo(SKUS as any),
      parametros: normalizarParametros({}),
      hoy: HOY,
      ventasRecientes: ventas(2),
    });
    expect(new Set(catalogo.map((c) => c.producto)).size).toBe(1);
    expect(p.cajas.reduce((a, c) => a + c.cantidad, 0)).toBe(5);
  });

  it("«Por producto» enseña lo que se manda a probar aunque no tenga venta en Amazon", () => {
    const sug = sugerirEnvioFba([], 30, new Map(), undefined, indexarCatalogo(SKUS as any), {
      cajas: [
        { cantidad: 2, paresTotales: 24, modelo: "GT156", color: "BLK", aporta: [{ sku: "GT156-BLK-26-MX" }] },
      ],
      ajustesCorrida: [],
    });
    expect(sug).toHaveLength(1);
    expect(sug[0]).toMatchObject({ producto: "GT156 BLK", cajas: 2, pares: 24, aProbar: true });
  });
});

