import { describe, expect, it } from "vitest";
import {
  diferenciasContraFamilia,
  familiaDe,
  leerDestino,
  leerPublicaciones,
  userProductsDeFamilia,
} from "./familia-meli";

describe("leerDestino", () => {
  it("puros dígitos es el id de la familia", () => {
    expect(leerDestino(" 2168760072158418 ")).toEqual({ tipo: "familia", id: "2168760072158418" });
  });
  it("un MLM es una publicación de la familia", () => {
    expect(leerDestino("mlm-2745026941")).toEqual({ tipo: "publicacion", id: "MLM2745026941" });
  });
  it("otra cosa no es destino", () => {
    expect(leerDestino("GT135")).toBeNull();
    expect(leerDestino("")).toBeNull();
  });
});

describe("leerPublicaciones", () => {
  it("saca los MLM de un texto libre, sin repetir", () => {
    expect(
      leerPublicaciones("MLM2745026941, mlm-3999000111\nhttps://articulo.mercadolibre.com.mx/MLM-2745026941-bota"),
    ).toEqual(["MLM2745026941", "MLM3999000111"]);
  });
  it("un user product no es publicación", () => {
    expect(leerPublicaciones("MLMU3272960702")).toEqual([]);
  });
});

describe("userProductsDeFamilia", () => {
  it("lista de ids", () => {
    expect(userProductsDeFamilia({ user_products_ids: ["MLMU1", "MLMU2", "MLMU1"] })).toEqual(["MLMU1", "MLMU2"]);
  });
  it("lista de objetos", () => {
    expect(userProductsDeFamilia({ user_products: [{ id: "MLMU7" }, { user_product_id: "MLMU8" }] })).toEqual([
      "MLMU7",
      "MLMU8",
    ]);
  });
  it("sin nada", () => {
    expect(userProductsDeFamilia(null)).toEqual([]);
  });
});

describe("familiaDe", () => {
  it("número o texto, siempre como texto", () => {
    expect(familiaDe({ family_id: 2168760072158418 })).toBe("2168760072158418");
    expect(familiaDe({ family_id: "55" })).toBe("55");
    expect(familiaDe({})).toBeNull();
  });
});

describe("diferenciasContraFamilia", () => {
  const item = (attributes: { id: string; name?: string; value_name?: string }[]) => ({ id: "MLM1", attributes });

  it("color, talla y SKU no cuentan; el material sí", () => {
    const difs = diferenciasContraFamilia(
      item([
        { id: "COLOR", value_name: "Negro" },
        { id: "SIZE", value_name: "25" },
        { id: "SELLER_SKU", value_name: "GT1-BLK-25-MX" },
        { id: "BRAND", value_name: "Getac" },
        { id: "MATERIALS", name: "Materiales", value_name: "Sintético" },
      ]),
      item([
        { id: "COLOR", value_name: "Café" },
        { id: "SIZE", value_name: "26" },
        { id: "SELLER_SKU", value_name: "GT1-BROWN-26-MX" },
        { id: "BRAND", value_name: "GETAC" },
        { id: "MATERIALS", name: "Materiales", value_name: "Piel" },
      ]),
    );
    expect(difs).toEqual([
      { atributoId: "MATERIALS", nombre: "Materiales", enPublicacion: "Sintético", enFamilia: "Piel" },
    ]);
  });

  it("un atributo que solo trae uno de los dos también es diferencia", () => {
    const difs = diferenciasContraFamilia(item([]), item([{ id: "MODEL", name: "Modelo", value_name: "GT135" }]));
    expect(difs).toEqual([{ atributoId: "MODEL", nombre: "Modelo", enPublicacion: null, enFamilia: "GT135" }]);
  });
});
