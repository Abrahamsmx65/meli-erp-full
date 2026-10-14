import { describe, expect, it } from "vitest";
import { clasificarPromo, modeloDeSku, ofertaAmazon, ordenarPlan, planDePromo, precioMinimoAmazon, redondear99, stockParaRelampago } from "./promociones";

const obj = { modelo: "GT253", relampago: 549.99, normal: 585.99, pvpDeal: 899.99 };

describe("redondear99", () => {
  it("sube al .99 del mismo peso", () => {
    expect(redondear99(532.49)).toBe(532.99);
    expect(redondear99(585.74)).toBe(585.99);
    expect(redondear99(692.24)).toBe(692.99);
    expect(redondear99(585.99)).toBe(585.99);
    expect(redondear99(600)).toBe(600.99);
    expect(redondear99(null)).toBeNull();
  });
});

describe("clasificarPromo", () => {
  it("relámpago por tipo; Buen Fin y todos los días por nombre", () => {
    expect(clasificarPromo({ type: "LIGHTNING", name: "Oferta relámpago" })).toBe("relampago");
    expect(clasificarPromo({ type: "DEAL", name: "BUEN FIN 2026" })).toBe("buen_fin");
    expect(clasificarPromo({ type: "SELLER_CAMPAIGN", name: "Oferta de todos los días" })).toBe("todos_los_dias");
    expect(clasificarPromo({ type: "DEAL", name: "Hot Sale" })).toBeNull();
  });
});

describe("planDePromo", () => {
  it("cambia una inscrita con otro precio y deja igual la que ya cuadra", () => {
    expect(planDePromo("MLM1", { id: "P1", type: "DEAL", name: "Buen Fin", status: "started", price: 600 }, obj).accion).toBe("cambiar");
    expect(planDePromo("MLM1", { id: "P1", type: "DEAL", name: "Buen Fin", status: "started", price: 585.99 }, obj).accion).toBe("igual");
  });

  it("inscribe la candidata, también la relámpago programada", () => {
    const r = planDePromo("MLM1", { id: "P2", type: "SELLER_CAMPAIGN", name: "Todos los días", status: "candidate" }, obj);
    expect(r.accion).toBe("inscribir");
    expect(r.nuevo).toBe(585.99);
    expect(planDePromo("MLM1", { id: "P3", type: "LIGHTNING", status: "candidate" }, obj).accion).toBe("inscribir");
  });

  it("fuera del rango de MELI solo avisa (MELI decide) y no toca lo ajeno", () => {
    const r = planDePromo("MLM1", { id: "P1", type: "DEAL", name: "Buen Fin", status: "candidate", max_discounted_price: 560 }, obj);
    expect(r.accion).toBe("inscribir");
    expect(r.fueraDeRango).toBe(true);
    expect(planDePromo("MLM1", { id: "P9", type: "DEAL", name: "Hot Sale", status: "started", price: 1 }, obj).accion).toBe("no_se_toca");
  });

  it("ordena relámpago, Buen Fin, todos los días", () => {
    const plan = ordenarPlan([
      planDePromo("MLM1", { type: "DEAL", name: "Todos los días", status: "started", price: 1 }, obj),
      planDePromo("MLM1", { type: "DEAL", name: "Buen Fin", status: "started", price: 1 }, obj),
      planDePromo("MLM1", { type: "LIGHTNING", status: "started", price: 1 }, obj),
    ]);
    expect(plan.map((p) => p.clase)).toEqual(["relampago", "buen_fin", "todos_los_dias"]);
  });
});

it("modeloDeSku", () => {
  expect(modeloDeSku("GT251-BLK-25-MX")).toBe("GT251");
  expect(modeloDeSku("gt128-23-blk-mx")).toBe("GT128");
});

it("lo que asigna el dueño manda sobre el nombre («Activa Tus Descuentos» es su oferta de todos los días)", () => {
  const p = { id: "P5", type: "SELLER_CAMPAIGN", name: "Activa Tus Descuentos", status: "started", price: 582.99 };
  const r = planDePromo("MLM1", p, obj);
  expect(r.clase).toBe("todos_los_dias");
  expect(r.accion).toBe("cambiar");
  expect(r.nuevo).toBe(585.99);
  expect(planDePromo("MLM1", p, obj, { "SELLER_CAMPAIGN|Activa Tus Descuentos": "no_tocar" }).accion).toBe("no_se_toca");
  expect(planDePromo("MLM1", { type: "LIGHTNING", status: "started", price: 1 }, obj, { "LIGHTNING|": "no_tocar" }).accion).toBe("no_se_toca");
});

it("pares del relámpago: lo del dueño, el mínimo de MELI o, sin mínimo, 5 y luego 1", () => {
  const r = planDePromo("MLM1", { id: "L1", type: "LIGHTNING", status: "candidate", stock: { min: 5, max: 40 } }, obj);
  expect(stockParaRelampago(r, undefined)).toEqual({ intentos: [5] });
  expect(stockParaRelampago(r, 20)).toEqual({ intentos: [20] });
  expect(stockParaRelampago(r, 2)).toHaveProperty("error");
  expect(stockParaRelampago(r, 50)).toHaveProperty("error");
  const sin = planDePromo("MLM1", { id: "L2", type: "LIGHTNING", status: "candidate" }, obj);
  expect(stockParaRelampago(sin, undefined)).toEqual({ intentos: [5, 1] });
  const chico = planDePromo("MLM1", { id: "L3", type: "LIGHTNING", status: "candidate", stock: { max: 3 } }, obj);
  expect(stockParaRelampago(chico, undefined)).toEqual({ intentos: [3, 1] });
});

describe("Amazon: precio y mínimo", () => {
  it("el mínimo queda más de 15 % abajo, en .99", () => {
    expect(precioMinimoAmazon(616.99)).toBe(523.99);
    expect(precioMinimoAmazon(679.99)).toBe(576.99);
    expect(precioMinimoAmazon(616.99)).toBeLessThan(616.99 * 0.85);
  });

  it("cambia precio y mínimo y conserva lo demás de la oferta", () => {
    const actual = [
      {
        marketplace_id: "A1AM78C64UM0Y8",
        currency: "MXN",
        our_price: [{ schedule: [{ value_with_tax: 679.99 }] }],
        minimum_seller_allowed_price: [{ schedule: [{ value_with_tax: 600 }] }],
        maximum_seller_allowed_price: [{ schedule: [{ value_with_tax: 900 }] }],
        audience: "ALL",
      },
    ];
    const [o] = ofertaAmazon(actual, "A1AM78C64UM0Y8", 616.99);
    expect(o.our_price).toEqual([{ schedule: [{ value_with_tax: 616.99 }] }]);
    expect(o.minimum_seller_allowed_price).toEqual([{ schedule: [{ value_with_tax: 523.99 }] }]);
    expect(o.maximum_seller_allowed_price).toEqual([{ schedule: [{ value_with_tax: 900 }] }]);
    expect(o.audience).toBe("ALL");
  });

  it("quita un máximo que quedaría abajo del precio nuevo", () => {
    const actual = [{ marketplace_id: "M", maximum_seller_allowed_price: [{ schedule: [{ value_with_tax: 500 }] }] }];
    expect(ofertaAmazon(actual, "M", 616.99)[0]).not.toHaveProperty("maximum_seller_allowed_price");
    expect(ofertaAmazon(undefined, "M", 616.99)[0].currency).toBe("MXN");
  });
});

describe("aporte de MELI y el envío arriba de $299", () => {
  it("no inscribe si con el aporte la venta se cobra como ≥ $299 (GT266, Buen Fin 26)", () => {
    const p = { id: "B", type: "DEAL", name: "Buen Fin 26", status: "candidate", original_price: 298.99, meli_percentage: 3 };
    const r = planDePromo("MLM1", p, { ...obj, normal: 298.99 });
    expect(r.accion).toBe("pagarias_envio");
    expect(r.aporte).toBeCloseTo(8.97, 2);
  });

  it("sin aporte, o lejos del umbral, se inscribe normal", () => {
    expect(planDePromo("MLM1", { id: "B", type: "DEAL", name: "Buen Fin 26", status: "candidate", original_price: 298.99 }, { ...obj, normal: 298.99 }).accion).toBe("inscribir");
    expect(planDePromo("MLM1", { id: "B", type: "DEAL", name: "Buen Fin 26", status: "candidate", original_price: 220, meli_percentage: 3 }, { ...obj, normal: 199.99 }).accion).toBe("inscribir");
    expect(planDePromo("MLM1", { id: "B", type: "DEAL", name: "Buen Fin 26", status: "candidate", original_price: 700, meli_percentage: 5 }, obj).accion).toBe("inscribir");
  });
});
