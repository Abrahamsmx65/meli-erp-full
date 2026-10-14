import { describe, expect, it } from "vitest";
import { clasificarPromo, modeloDeSku, ordenarPlan, planDePromo, redondear99, stockParaRelampago } from "./promociones";

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

  it("respeta el rango de MELI y no toca lo ajeno", () => {
    expect(
      planDePromo("MLM1", { id: "P1", type: "DEAL", name: "Buen Fin", status: "candidate", max_discounted_price: 560 }, obj).accion,
    ).toBe("fuera_de_rango");
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

it("pares del relámpago: lo del dueño o el mínimo de MELI, dentro del rango", () => {
  const r = planDePromo("MLM1", { id: "L1", type: "LIGHTNING", status: "candidate", stock: { min: 5, max: 40 } }, obj);
  expect(stockParaRelampago(r, undefined)).toEqual({ stock: 5 });
  expect(stockParaRelampago(r, 20)).toEqual({ stock: 20 });
  expect(stockParaRelampago(r, 2)).toHaveProperty("error");
  expect(stockParaRelampago(r, 50)).toHaveProperty("error");
  const sin = planDePromo("MLM1", { id: "L2", type: "LIGHTNING", status: "candidate" }, obj);
  expect(stockParaRelampago(sin, undefined)).toHaveProperty("error");
});
