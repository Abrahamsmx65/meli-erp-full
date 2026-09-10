import { describe, expect, it } from "vitest";
import { renombresDePublicacion } from "./sync";

/**
 * El caso real del 10-sep-2026: la variante MLM2741888669/197085920397
 * (user product MLMU3785520895) se llamaba "GT134-NAVY / RED-28-MX" y el
 * dueño la corrigió en MELI a "GT134-NAVY-RED-28-MX". El aviso del webhook
 * dio de alta el nombre nuevo y dejó el viejo activo: dos renglones para la
 * misma caja, y el kardex de TikTok mandando los 15 pares de un lado al otro.
 */
describe("una publicación que cambia de SKU apaga su nombre anterior", () => {
  const activos = [
    {
      sku: "GT134-NAVY / RED-28-MX",
      item_id: "MLM2741888669",
      variation_id: "197085920397",
      user_product_id: "MLMU3785520895",
    },
    {
      sku: "GT134-NAVY-28-MX",
      item_id: "MLM2741888669",
      variation_id: "197085920398",
      user_product_id: "MLMU3785520896",
    },
  ];

  it("apaga el nombre viejo de ESA variante y no toca a las hermanas", () => {
    const viejos = renombresDePublicacion(activos, [
      {
        sku: "GT134-NAVY-RED-28-MX",
        itemId: "MLM2741888669",
        variationId: "197085920397",
        userProductId: "MLMU3785520895",
      },
    ]);
    expect(viejos).toEqual(["GT134-NAVY / RED-28-MX"]);
  });

  it("si el SKU no cambió no apaga nada", () => {
    const viejos = renombresDePublicacion(activos, [
      {
        sku: "GT134-NAVY / RED-28-MX",
        itemId: "MLM2741888669",
        variationId: "197085920397",
        userProductId: "MLMU3785520895",
      },
    ]);
    expect(viejos).toEqual([]);
  });

  it("sin user product amarra por item + variación", () => {
    const viejos = renombresDePublicacion(
      [{ sku: "GT125-BLK/BROWN-25-MX", item_id: "MLM111", variation_id: "9", user_product_id: null }],
      [{ sku: "GT125-BLK-BROWN-25-MX", itemId: "MLM111", variationId: "9", userProductId: null }],
    );
    expect(viejos).toEqual(["GT125-BLK/BROWN-25-MX"]);
  });

  it("una variante que sigue esperando su SKU no se apaga por error", () => {
    // El fresco no la trae (todavía no se resuelve): nadie la nombra, nadie la apaga.
    const viejos = renombresDePublicacion(activos, [
      {
        sku: "GT134-NAVY-RED-28-MX",
        itemId: "MLM2741888669",
        variationId: "197085920397",
        userProductId: "MLMU3785520895",
      },
    ]);
    expect(viejos).not.toContain("GT134-NAVY-28-MX");
  });

  it("dos variantes distintas del mismo item no se pisan", () => {
    const viejos = renombresDePublicacion(
      [
        { sku: "A-1", item_id: "MLM1", variation_id: "1", user_product_id: "U1" },
        { sku: "B-1", item_id: "MLM1", variation_id: "2", user_product_id: "U2" },
      ],
      [
        { sku: "A-2", itemId: "MLM1", variationId: "1", userProductId: "U1" },
        { sku: "B-1", itemId: "MLM1", variationId: "2", userProductId: "U2" },
      ],
    );
    expect(viejos).toEqual(["A-1"]);
  });
});
