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

  it("la regla de la corrida despareja frena el arrastre de cajas por un pico chico", () => {
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
    // faltante = ceil(31/30 × 37 − 30) = 9 pares, pero la caja trae 21 de
    // hermanas que Amazon ni conoce (sin venta ahí): corrida dispareja. En
    // vez de llenar el objetivo, viaja la semana de venta de la talla
    // (ceil(31/30 × 7) = 8 pares → 3 cajas de a 3) — el goteo, no las 5+
    // cajas que el faltante completo arrastraba antes.
    expect(plan.ajustesCorrida).toEqual([
      {
        sku: "GT114-LT BROWN-26-MX",
        regla: "solo_7_dias",
        necesidadOriginal: 9,
        necesidadAjustada: 8,
        peorSobrante: Infinity,
      },
    ]);
    expect(plan.cajas).toHaveLength(1);
    expect(plan.cajas[0].cantidad).toBe(3);
    expect(plan.sinCajaEnBodega).toHaveLength(0);
    expect(plan.faltanteConCaja).toHaveLength(0);
  });

  it("con la talla 26 en cero sí viajan cajas para sus 7 días, y el residuo no es \"sin caja\"", () => {
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
      enTransferencia: 0,
      totalFba: 0,
      cobertura: null,
    };

    const plan = planFbaConCajas({
      renglones: [renglon],
      dias: 30,
      catalogo,
      indiceMeli: indexarCatalogo(SKUS_MELI as any),
      parametros: normalizarParametros({}),
    });
    // Corrida dispareja (hermanas sin venta en Amazon): en vez de los 39
    // pares de 37 días, solo la semana de venta = 8 pares. Lo recortado se
    // surte completo, así que el rescate sube 3 cajas (9 pares de la 26,
    // con 3 por caja) y no queda faltante — mucho menos que las ~13 cajas
    // que pedían los 39 pares.
    expect(plan.ajustesCorrida).toHaveLength(1);
    expect(plan.ajustesCorrida[0].regla).toBe("solo_7_dias");
    expect(plan.ajustesCorrida[0].necesidadOriginal).toBe(39);
    expect(plan.ajustesCorrida[0].necesidadAjustada).toBe(8);
    expect(plan.cajas).toHaveLength(1);
    expect(plan.cajas[0].cantidad).toBe(3);
    expect(plan.sinCajaEnBodega).toHaveLength(0);
    expect(plan.faltanteConCaja).toHaveLength(0);
  });
});
