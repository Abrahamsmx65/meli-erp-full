import { describe, expect, it } from "vitest";
import { construirCajas } from "../importar/cajas";
import { construirIndice } from "../importar/sku";
import { indexarCatalogo } from "../etiquetas/resolver";
import { planFbaConCajas } from "./fba-plan";
import { normalizarParametros } from "../engine/params";
import type { RenglonAmazon } from "./amazon";

// Datos REALES de la base (cuenta GETAC), copiados tal cual.
const SKUS_MELI = [
  { sku: "GT114-LT BROWN-23-MX", modelo: "GT114", color: "LT BROWN", talla: "23" },
  { sku: "GT114-LT BROWN-24-MX", modelo: "GT114", color: "LT BROWN", talla: "24" },
  { sku: "GT114-LT BROWN-25-MX", modelo: "GT114", color: "LT BROWN", talla: "25" },
  { sku: "GT114-LT BROWN-26-MX", modelo: "GT114", color: "LT BROWN", talla: "26" },
  { sku: "GT114-LT BROWN-27-MX", modelo: "GT114", color: "LT BROWN", talla: "27" },
  { sku: "GT114-LT BROWN-28-MX", modelo: "GT114", color: "LT BROWN", talla: "28" },
];

const EXISTENCIAS = [
  {
    almacen: "EnvioPack",
    codigoAlmacen: "",
    skuCaja: "IN10122-GT114-LT BROWN",
    pedido: "IN10122",
    modelo: "GT114",
    color: "LT BROWN",
    talla: "CORRIDA",
    contenedor: "",
    cajasFisicas: 80,
    cajasApartadas: 10,
    enCamino: 0,
    cajasDisponibles: 70,
    paresPorCaja: 24,
    paresDisponibles: 0,
  },
];

const CORRIDAS = [
  {
    pedido: "IN10122",
    modelo: "GT114",
    color: "LT BROWN",
    tallas: { "23": 3, "24": 7, "25": 8, "26": 3, "27": 3 },
    total: 24,
  },
];

describe("GT114-LT BROWN-26: el residuo del rescate no es \"sin caja en bodega\" (datos reales)", () => {
  it("la corrida IN10122 amarra talla 26 al SKU de MELI", () => {
    const r = construirCajas(EXISTENCIAS as any, CORRIDAS as any, {
      indice: construirIndice(SKUS_MELI.map((s) => s.sku)),
      mapeoManual: new Map(),
      almacenes: ["Caseshop", "EnvioPack", "Industher"],
    });
    const caja = r.cajas[0];
    expect(caja).toBeDefined();
    const item26 = caja.detalle.find((d) => d.talla === "26");
    expect(item26?.sku).toBe("GT114-LT BROWN-26-MX");
  });

  it("el plan de FBA le encuentra caja al faltante de la talla 26", () => {
    const catalogo = construirCajas(EXISTENCIAS as any, CORRIDAS as any, {
      indice: construirIndice(SKUS_MELI.map((s) => s.sku)),
      mapeoManual: new Map(),
      almacenes: ["Caseshop", "EnvioPack", "Industher"],
    }).cajas;

    const renglon: RenglonAmazon = {
      sku: "GT114-LT BROWN-26-MX",
      titulo: null,
      asin: null,
      unidades: 31,
      ordenes: 28,
      importe: 0,
      disponible: 0,
      enTransferencia: 30,
      totalFba: 30,
      cobertura: null,
    };

    const plan = planFbaConCajas({
      renglones: [renglon],
      dias: 30,
      catalogo,
      indiceMeli: indexarCatalogo(SKUS_MELI as any),
      parametros: normalizarParametros({}),
    });
    expect(plan.sinAmarre).toHaveLength(0);
    // faltante = ceil(31/30 × 44 − 30) = 16 pares; el rescate manda 5 cajas
    // (15 pares de la talla 26) y el par que sobra NO debe salir como "sin
    // caja en bodega": el SKU sí está ligado y sí viaja en el plan.
    expect(plan.cajas.length).toBeGreaterThan(0);
    expect(plan.sinCajaEnBodega).toHaveLength(0);
    expect(plan.faltanteConCaja).toEqual([
      { sku: "GT114-LT BROWN-26-MX", pares: 1, enPlan: 15 },
    ]);
  });
});
