import { describe, expect, it } from "vitest";
import { armarPlanVariante } from "./listados";
import type { ItemCrudo } from "../servicios/listados";

const item: ItemCrudo = {
  id: "MLM1",
  variations: [
    {
      id: 1,
      attribute_combinations: [{ id: "COLOR", name: "Color", value_name: "Transparente" }, { id: "MODEL", name: "Modelo", value_name: "iPhone 15" }],
      attributes: [{ id: "SELLER_SKU", name: "SKU", value_name: "499-i15" }],
    },
    { id: 2, attribute_combinations: [{ id: "COLOR", name: "Color", value_name: "Transparente" }, { id: "MODEL", name: "Modelo", value_name: "iPhone 14" }] },
  ],
};

describe("armarPlanVariante", () => {
  it("manda todas las variantes, la editada completa y las demás solo con id", () => {
    const cuerpo = armarPlanVariante(item, "1", "COLOR", "Transp.")!;
    const vs = cuerpo.variations as Record<string, unknown>[];
    expect(vs).toHaveLength(2);
    expect(vs[1]).toEqual({ id: 2 });
    expect(vs[0].attribute_combinations).toEqual([
      { id: "COLOR", value_name: "Transp." },
      { id: "MODEL", value_name: "iPhone 15" },
    ]);
    // El SELLER_SKU regresa intacto: quitarlo lo borraría.
    expect(vs[0].attributes).toEqual([{ id: "SELLER_SKU", value_name: "499-i15" }]);
  });

  it("un atributo que la variante no tiene se agrega en attributes", () => {
    const cuerpo = armarPlanVariante(item, "2", "MATERIAL", "TPU")!;
    const v = (cuerpo.variations as Record<string, unknown>[])[1];
    expect(v.attributes).toEqual([{ id: "MATERIAL", value_name: "TPU" }]);
    expect(v.attribute_combinations).toBeUndefined();
  });

  it("una variante que no existe da null", () => {
    expect(armarPlanVariante(item, "9", "COLOR", "x")).toBeNull();
  });
});
