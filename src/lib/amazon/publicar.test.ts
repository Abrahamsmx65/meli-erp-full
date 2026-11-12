import { describe, expect, it } from "vitest";
import {
  colorBase,
  cuerpoHijo,
  cuerpoPadre,
  erroresDeAmazon,
  faltantesDeAmazon,
  fichaDeAmazon,
  skuPadre,
  tallaAmazon,
  variantesDeAmazon,
  type Atributos,
  type PedidoAmazon,
} from "./publicar";

const MK = "A1AM78C64UM0Y8";
const es = { language_tag: "es_MX", marketplace_id: MK };

// Recortado de GT312-BROWN-29-MX y su padre N7-1OOE-UVDP, leídos el 12-nov-2026.
const HIJO: Atributos = {
  brand: [{ value: "GETAC", ...es }],
  size: [{ value: "Mediano", ...es }],
  color: [{ ...es, standardized_values: ["café"] }],
  style: [{ value: "Botas militares", ...es }],
  closure: [{ type: [{ value: "Cordones", language_tag: "es_MX" }], marketplace_id: MK }],
  item_name: [{ value: "GETAC Botas para Hombre Tácticas", ...es }],
  model_name: [{ value: "GT312", ...es }],
  list_price: [{ currency: "MXN", marketplace_id: MK, value_with_tax: 999 }],
  bullet_point: [{ value: "Viñeta uno", ...es }, { value: "Viñeta dos", ...es }],
  occasion_type: [{ value: "Trabajo", ...es }, { value: "Uso diario", ...es }],
  footwear_size: [{ size: "measurement_29_point_0_centimeters", gender: "men", age_group: "adult", size_class: "measurement", size_system: "jp_footwear_size_system", marketplace_id: MK }],
  target_gender: [{ value: "male", marketplace_id: MK }],
  generic_keyword: [{ value: "BOTA BOTIN", ...es }],
  parentage_level: [{ value: "child", marketplace_id: MK }],
  purchasable_offer: [{ audience: "ALL", currency: "MXN", our_price: [{ schedule: [{ value_with_tax: 999 }] }], marketplace_id: MK }],
  item_package_weight: [{ unit: "kilograms", value: 1.66, marketplace_id: MK }],
  product_description: [{ value: ".", ...es }],
  merchant_suggested_asin: [{ value: "B0HQKQY5H7", marketplace_id: MK }],
  main_product_image_locator: [{ media_location: "https://x/y.jpg", marketplace_id: MK }],
  product_site_launch_date: [{ value: "2024-01-21T21:19:37.886Z", marketplace_id: MK }],
  fulfillment_availability: [{ fulfillment_channel_code: "AMAZON_NA" }],
  child_parent_sku_relationship: [{ parent_sku: "N7-1OOE-UVDP", marketplace_id: MK, child_relationship_type: "variation" }],
  supplier_declared_has_product_identifier_exemption: [{ value: true, marketplace_id: MK }],
};
const PADRE: Atributos = {
  brand: [{ value: "GETAC", ...es }],
  size: [{ value: "Mediano", ...es }],
  color: [{ value: "Café claro", ...es }],
  style: [{ value: "Botas militares", ...es }],
  item_name: [{ value: "GETAC Botas para Hombre Tácticas", ...es }],
  footwear_size: HIJO.footwear_size,
  parentage_level: [{ value: "parent", marketplace_id: MK }],
  skip_offer: [{ value: false, marketplace_id: MK }],
  supplier_declared_has_product_identifier_exemption: [{ value: true, marketplace_id: MK }],
};

function ficha() {
  return fichaDeAmazon("gt312", "GT312-BROWN-29-MX", { attributes: HIJO, summaries: [{ productType: "BOOT" }] }, { sku: "N7-1OOE-UVDP", attributes: PADRE }, MK);
}

function pedido(cambios: Partial<PedidoAmazon> = {}): PedidoAmazon {
  const f = ficha();
  return {
    modelo: "GT351",
    titulo: "GETAC Botas Largas para Mujer con Pliegue y Tacón de Aguja",
    precio: 899,
    colores: [
      { codigo: "BLK", nombre: "Negro" },
      { codigo: "dk brown", nombre: "Café oscuro" },
    ],
    tallas: ["23", "24.5"],
    vinetas: f.vinetas,
    descripcion: "",
    palabras: f.palabras,
    simples: f.simples,
    ficha: f,
    ...cambios,
  };
}

describe("crear en Amazon", () => {
  it("escribe la talla en centímetros y el color base", () => {
    expect(tallaAmazon("26")).toBe("measurement_26_point_0_centimeters");
    expect(tallaAmazon("24,5 MX")).toBe("measurement_24_point_5_centimeters");
    expect(colorBase("Café oscuro")).toBe("Marrón");
    expect(colorBase("Negro")).toBe("Negro");
    expect(colorBase("Crema")).toBe("Beige");
    expect(colorBase("Negro / Rojo")).toBe("Multicolor");
    expect(colorBase("Leopardo")).toBe("Leopardo");
  });

  it("copia la ficha sin lo que es de cada publicación", () => {
    const f = ficha();
    expect(f.productType).toBe("BOOT");
    expect(f.precio).toBe(999);
    expect(f.vinetas).toEqual(["Viñeta uno", "Viñeta dos"]);
    expect(f.talla.gender).toBe("men");
    for (const fuera of ["merchant_suggested_asin", "main_product_image_locator", "item_name", "color", "footwear_size", "purchasable_offer", "product_site_launch_date", "child_parent_sku_relationship"]) {
      expect(f.hijo[fuera]).toBeUndefined();
      expect(f.padre[fuera]).toBeUndefined();
    }
    expect(f.hijo.closure).toBeDefined();
    expect(f.hijo.item_package_weight).toBeDefined();
    expect(f.padre.size).toBeUndefined();
    expect(f.padre.skip_offer).toBeDefined();
    // Solo los de texto sencillo se ofrecen para corregir.
    expect(f.simples.map((s) => s.clave)).toEqual(["brand", "size", "style", "occasion_type"]);
    expect(f.simples.find((s) => s.clave === "occasion_type")?.valores).toEqual(["Trabajo", "Uso diario"]);
  });

  it("el padre va primero y luego color por talla", () => {
    const vs = variantesDeAmazon(pedido());
    expect(vs.map((v) => v.sku)).toEqual(["GT351-PADRE", "GT351-BLK-23-MX", "GT351-BLK-24.5-MX", "GT351-DK BROWN-23-MX", "GT351-DK BROWN-24.5-MX"]);
    expect(vs[0].esPadre).toBe(true);
    expect(skuPadre("gt351")).toBe("GT351-PADRE");
  });

  it("arma el padre sin oferta ni talla", () => {
    const c = cuerpoPadre(pedido()) as { productType: string; requirements: string; attributes: Atributos };
    expect(c.productType).toBe("BOOT");
    expect(c.requirements).toBe("LISTING");
    expect(c.attributes.parentage_level).toEqual([{ value: "parent", marketplace_id: MK }]);
    expect(c.attributes.child_parent_sku_relationship).toEqual([{ child_relationship_type: "variation", marketplace_id: MK }]);
    expect(c.attributes.variation_theme).toEqual([{ name: "SIZE/COLOR" }]);
    expect(c.attributes.item_name[0].value).toBe("GETAC Botas Largas para Mujer con Pliegue y Tacón de Aguja");
    expect(c.attributes.model_number).toEqual([{ value: "GT351", marketplace_id: MK }]);
    expect(c.attributes.purchasable_offer).toBeUndefined();
    expect(c.attributes.footwear_size).toBeUndefined();
    expect(c.attributes.product_description[0].value).toBe(".");
  });

  it("arma el hijo con color, talla, precio y FBA", () => {
    const p = pedido();
    const v = variantesDeAmazon(p)[4];
    const a = (cuerpoHijo(p, v) as { attributes: Atributos }).attributes;
    expect(a.color).toEqual([{ value: "Café oscuro", ...es, standardized_values: ["Marrón"] }]);
    expect(a.footwear_size[0]).toMatchObject({ size: "measurement_24_point_5_centimeters", gender: "men", size_system: "jp_footwear_size_system" });
    expect(a.child_parent_sku_relationship[0].parent_sku).toBe("GT351-PADRE");
    expect(a.purchasable_offer[0].our_price[0].schedule[0].value_with_tax).toBe(899);
    expect(a.list_price[0].value_with_tax).toBe(899);
    expect(a.fulfillment_availability).toEqual([{ fulfillment_channel_code: "AMAZON_NA" }]);
    expect(a.supplier_declared_has_product_identifier_exemption).toBeDefined();
    expect(a.merchant_suggested_asin).toBeUndefined();
    expect(a.main_product_image_locator).toBeUndefined();
    expect(a.bullet_point).toHaveLength(2);
  });

  it("lleva lo que se corrigió de los atributos sencillos", () => {
    const p = pedido();
    p.simples = p.simples.map((s) => (s.clave === "style" ? { ...s, valores: ["Botas altas"] } : s.clave === "occasion_type" ? { ...s, valores: [] } : s));
    const a = (cuerpoHijo(p, variantesDeAmazon(p)[1]) as { attributes: Atributos }).attributes;
    expect(a.style).toEqual([{ value: "Botas altas", ...es }]);
    expect(a.occasion_type).toBeUndefined();
  });

  it("una talla sin género en la ficha no lo inventa", () => {
    const p = pedido();
    p.ficha = { ...p.ficha, talla: { age_group: "adult", size_class: "measurement", size_system: "jp_footwear_size_system" } };
    const a = (cuerpoHijo(p, variantesDeAmazon(p)[1]) as { attributes: Atributos }).attributes;
    expect(a.footwear_size[0].gender).toBeUndefined();
  });

  it("dice lo que falta", () => {
    expect(faltantesDeAmazon(pedido())).toEqual([]);
    const f = faltantesDeAmazon(pedido({ titulo: "Corto", vinetas: [], colores: [{ codigo: "BLK", nombre: "" }] })).join(" ");
    expect(f).toMatch(/título/);
    expect(f).toMatch(/viñeta/);
    expect(f).toMatch(/nombre en español/);
  });

  it("lee los errores de Amazon", () => {
    expect(erroresDeAmazon({ status: "VALID", issues: [] })).toEqual([]);
    expect(erroresDeAmazon({ status: "ACCEPTED", issues: [{ severity: "WARNING", message: "aviso" }] })).toEqual([]);
    expect(erroresDeAmazon({ status: "INVALID", issues: [{ severity: "ERROR", message: "Falta el color", attributeNames: ["color"] }] })).toEqual(["Falta el color (color)"]);
    expect(erroresDeAmazon({ status: "INVALID" })).toEqual(["Amazon contestó INVALID."]);
    expect(erroresDeAmazon(null)).toEqual(["Amazon no contestó a tiempo."]);
  });
});
