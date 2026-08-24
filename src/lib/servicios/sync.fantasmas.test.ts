import { describe, expect, it } from "vitest";
import { detectarSkusFantasma } from "./sync";

/** El caso real: GT274-NAVY/WHITE renombrado a GT274-NAVY-WHITE en MELI. */
describe("detectarSkusFantasma", () => {
  const frescos = [
    { sku: "GT274-NAVY-WHITE-30-MX", itemId: "MLM3081040507" },
    { sku: "GT203-BLK-25-MX", itemId: "MLM2775842349" },
  ];

  it("apaga el nombre viejo de un SKU renombrado en su mismo item", () => {
    const activos = [
      { sku: "GT274-NAVY-WHITE-30-MX", item_id: "MLM3081040507", user_product_id: null },
      { sku: "GT274-NAVY/WHITE-30-MX", item_id: "MLM3081040507", user_product_id: null },
    ];
    expect(detectarSkusFantasma(activos, frescos, [])).toEqual(["GT274-NAVY/WHITE-30-MX"]);
  });

  it("NO toca filas de items que esta corrida no recorrió (pausados, cerrados)", () => {
    const activos = [
      { sku: "VIEJO-AGOTADO-25-MX", item_id: "MLM_NO_RECORRIDO", user_product_id: null },
    ];
    expect(detectarSkusFantasma(activos, frescos, [])).toEqual([]);
  });

  it("NO toca variantes cuyo SKU sigue pendiente de resolverse", () => {
    const activos = [
      { sku: "GT203-GOLD-24-MX", item_id: "MLM2775842349", user_product_id: "UP123" },
    ];
    const pendientes = [{ itemId: "MLM2775842349", userProductId: "UP123" }];
    expect(detectarSkusFantasma(activos, frescos, pendientes)).toEqual([]);
  });

  it("un item visto solo por sus pendientes también delata a sus fantasmas", () => {
    const activos = [
      { sku: "NOMBRE-VIEJO-23-MX", item_id: "MLM_SOLO_PENDIENTES", user_product_id: null },
    ];
    const pendientes = [{ itemId: "MLM_SOLO_PENDIENTES", userProductId: "UP999" }];
    expect(detectarSkusFantasma(activos, frescos, pendientes)).toEqual(["NOMBRE-VIEJO-23-MX"]);
  });
});
