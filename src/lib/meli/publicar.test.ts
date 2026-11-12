import { describe, expect, it } from "vitest";
import {
  cuerpoDeVariante,
  erroresDeMeli,
  faltantesDePedido,
  fichaDeItem,
  filasDeGuia,
  skuDeVariante,
  soloAdvertencias,
  tallasDeTexto,
  tipoDeCalzado,
  variantesDePedido,
  type GuiaMeli,
  type ItemMeli,
  type PedidoPublicacion,
} from "./publicar";

// Recortado de MLM3787429501 (GT312-BLK-25-MX), leído el 12-nov-2026.
const ITEM: ItemMeli = {
  id: "MLM3787429501",
  title: "Botas Para Hombre Casuales Robusto Cordones Antiderrapante Negro 25 Mx",
  family_name: "Botas Para Hombre Casuales Robusto Cordones Antiderrapante",
  category_id: "MLM192062",
  price: 999,
  listing_type_id: "gold_special",
  official_store_id: 51289,
  attributes: [
    { id: "MATERIALS", name: "Materiales", value_id: "77033877", value_name: "Piel real" },
    { id: "BRAND", name: "Marca", value_id: "34463650", value_name: "Getac" },
    { id: "COLOR", name: "Color", value_id: "52049", value_name: "Negro" },
    { id: "GENDER", name: "Género", value_id: "339666", value_name: "Hombre" },
    { id: "HEEL_TYPE", name: "Tipo de taco", value_id: "-1", value_name: null },
    { id: "MODEL", name: "Modelo", value_name: "GT312" },
    { id: "PACKAGE_HEIGHT", name: "Altura del paquete", value_name: "12.4 cm" },
    { id: "SELLER_PACKAGE_HEIGHT", name: "Altura del paquete del seller", value_name: "43 cm" },
    { id: "SELLER_SKU", name: "SKU", value_name: "GT312-BLK-25-MX" },
    { id: "SIZE", name: "Talla", value_name: "25 MX" },
    { id: "SIZE_GRID_ID", name: "ID de la guía de tallas", value_name: "260076" },
    { id: "SIZE_GRID_ROW_ID", name: "Fila", value_name: "260076:3" },
    { id: "WITH_VIRTUAL_TRY_ON", name: "Con probador virtual", value_id: "242085", value_name: "Sí" },
  ],
  pictures: [{ id: "607377-MLM117375051211_092026", secure_url: "https://http2.mlstatic.com/D_607377-MLM117375051211_092026-O.jpg" }],
  sale_terms: [
    { id: "WARRANTY_TYPE", value_id: "2230280", value_name: "Garantía del vendedor" },
    { id: "WARRANTY_TIME", value_name: "30 días" },
  ],
};

const GUIA: GuiaMeli = {
  id: "260076",
  names: { MLM: "Mercado Libre Hombre Botas" },
  rows: [
    { id: "260076:1", attributes: [{ id: "SIZE", values: [{ name: "24 MX", struct: { number: 24 } }] }] },
    { id: "260076:2", attributes: [{ id: "SIZE", values: [{ name: "24,5 MX", struct: { number: 24.5 } }] }] },
    { id: "260076:3", attributes: [{ id: "SIZE", values: [{ name: "25 MX", struct: { number: 25 } }] }] },
    { id: "260076:6", attributes: [{ id: "SIZE", values: [{ name: "26 MX", struct: { number: 26 } }] }] },
  ],
};

const CATEGORIA = [
  { id: "BRAND", name: "Marca", tags: { required: true } },
  { id: "GENDER", name: "Género", tags: { required: true }, values: [{ id: "339666", name: "Hombre" }, { id: "339665", name: "Mujer" }] },
  { id: "FOOTWEAR_STYLE", name: "Estilo del calzado", tags: { required: true }, values: [{ id: "1", name: "Urbano" }] },
  { id: "AGE_GROUP", name: "Edad", tags: { read_only: true, required: true } },
];

function ficha() {
  return fichaDeItem("gt312", ITEM, CATEGORIA, GUIA, { categoriaNombre: "Botas y Botines", descripcion: "desc", maxTitulo: 60 });
}

function pedido(cambios: Partial<PedidoPublicacion> = {}): PedidoPublicacion {
  const f = ficha();
  f.atributos = f.atributos.map((a) => (a.id === "FOOTWEAR_STYLE" ? { ...a, valor: "Urbano", valorId: "1" } : a));
  return {
    modelo: "GT331",
    titulo: "Botas Para Hombre Casuales Con Cierre Lateral",
    precio: 999,
    descripcion: "Botas",
    pausar: true,
    colores: [
      { codigo: "BLK", nombre: "Negro", fotos: ["111-MLM"] },
      { codigo: "dk brown", nombre: "Café oscuro", fotos: ["222-MLM", "333-MLM"] },
    ],
    tallas: ["25", "26"],
    ficha: f,
    ...cambios,
  };
}

describe("publicar en MELI", () => {
  it("arma el SKU como el ERP lo conoce", () => {
    expect(skuDeVariante("gt331", "dk  brown", "25 MX")).toBe("GT331-DK BROWN-25-MX");
    expect(skuDeVariante("GT331", "BLK", "24,5")).toBe("GT331-BLK-24.5-MX");
  });

  it("lee tallas sueltas y por rango", () => {
    expect(tallasDeTexto("23-26, 28")).toEqual(["23", "24", "25", "26", "28"]);
    expect(tallasDeTexto("25 MX 26")).toEqual(["25", "26"]);
  });

  it("lee las filas de la guía de tallas", () => {
    expect(filasDeGuia(GUIA)[2]).toEqual({ rowId: "260076:3", talla: "25", nombre: "25 MX" });
    expect(filasDeGuia(GUIA)[1].talla).toBe("24.5");
  });

  it("copia la ficha sin lo de la variante ni lo que MELI no deja tocar", () => {
    const f = ficha();
    const ids = f.atributos.map((a) => a.id);
    expect(ids).toContain("MATERIALS");
    expect(ids).toContain("SELLER_PACKAGE_HEIGHT");
    expect(ids).toContain("HEEL_TYPE");
    for (const fuera of ["COLOR", "SIZE", "SELLER_SKU", "MODEL", "PACKAGE_HEIGHT", "SIZE_GRID_ID", "WITH_VIRTUAL_TRY_ON", "AGE_GROUP"]) {
      expect(ids).not.toContain(fuera);
    }
    expect(f.gridId).toBe("260076");
    expect(f.titulo).toBe("Botas Para Hombre Casuales Robusto Cordones Antiderrapante");
    expect(f.saleTerms).toHaveLength(2);
    // Lo obligatorio de la categoría que la publicación no traía sale vacío para llenarse.
    expect(f.atributos.find((a) => a.id === "FOOTWEAR_STYLE")).toMatchObject({ valor: "", requerido: true });
    expect(f.atributos.find((a) => a.id === "GENDER")?.opciones).toHaveLength(2);
  });

  it("una publicación por color y talla, con su fila de la guía", () => {
    const vs = variantesDePedido(pedido());
    expect(vs.map((v) => v.sku)).toEqual(["GT331-BLK-25-MX", "GT331-BLK-26-MX", "GT331-DK BROWN-25-MX", "GT331-DK BROWN-26-MX"]);
    expect(vs[1]).toMatchObject({ rowId: "260076:6", nombreTalla: "26 MX", nombreColor: "Negro" });
  });

  it("arma el cuerpo de la variante", () => {
    const p = pedido();
    const c = cuerpoDeVariante(p, variantesDePedido(p)[2]);
    expect(c.family_name).toBe("Botas Para Hombre Casuales Con Cierre Lateral");
    expect(c.title).toBeUndefined();
    expect(c.status).toBe("paused");
    expect(cuerpoDeVariante({ ...p, pausar: false }, variantesDePedido(p)[2]).status).toBeUndefined();
    expect(c.pictures).toEqual([{ id: "222-MLM" }, { id: "333-MLM" }]);
    expect(c.official_store_id).toBe(51289);
    const attrs = c.attributes as { id: string; value_id?: string; value_name?: string }[];
    const de = (id: string) => attrs.find((a) => a.id === id);
    expect(de("SELLER_SKU")?.value_name).toBe("GT331-DK BROWN-25-MX");
    expect(de("COLOR")?.value_name).toBe("Café oscuro");
    expect(de("SIZE")?.value_name).toBe("25 MX");
    expect(de("SIZE_GRID_ROW_ID")?.value_name).toBe("260076:3");
    expect(de("MODEL")?.value_name).toBe("GT331");
    expect(de("MATERIALS")).toEqual({ id: "MATERIALS", value_id: "77033877", value_name: "Piel real" });
    expect(de("HEEL_TYPE")).toEqual({ id: "HEEL_TYPE", value_id: "-1" });
    expect(attrs.filter((a) => a.id === "MODEL")).toHaveLength(1);
  });

  it("elige el boceto por la categoría y, si no lo dice, por el título", () => {
    expect(tipoDeCalzado("Botas y Botines")).toBe("bota");
    expect(tipoDeCalzado("Sandalias y Chanclas")).toBe("sandalia");
    expect(tipoDeCalzado("Calzado", "Pantufla Zuecos Hombre Afelpado")).toBe("pantufla");
    expect(tipoDeCalzado("Calzado", "Botas Largas Para Mujer Tacón Aguja")).toBe("bota");
    expect(tipoDeCalzado("Zapatillas", "")).toBe("tacon");
    expect(tipoDeCalzado("Tenis", "Tenis Para Agua")).toBe("tenis");
    expect(tipoDeCalzado("Flats", "Flats Para Mujer Tejido")).toBe("zapato");
    expect(ficha().boceto).toBe("bota");
    expect(ficha().fotos).toEqual([]);
  });

  it("sin fotos propias el color lleva el boceto", () => {
    const p = pedido({ colores: [{ codigo: "BLK", nombre: "Negro", fotos: [] }] });
    p.ficha.fotos = [{ id: "607377-MLM117375051211_092026", url: "/bocetos/bota.png" }];
    expect(faltantesDePedido(p)).toEqual([]);
    expect(cuerpoDeVariante(p, variantesDePedido(p)[0]).pictures).toEqual([{ id: "607377-MLM117375051211_092026" }]);
  });

  it("la tienda oficial de la cuenta manda sobre la de la publicación copiada", () => {
    const sinTienda = fichaDeItem("GT100", { ...ITEM, official_store_id: null }, CATEGORIA, GUIA, {
      categoriaNombre: "Botas",
      descripcion: "",
      maxTitulo: 60,
      tienda: { id: 51289, nombre: "Getac" },
    });
    expect(sinTienda.officialStoreId).toBe(51289);
    expect(sinTienda.tiendaNombre).toBe("Getac");
    expect(ficha().officialStoreId).toBe(51289);
  });

  it("dice lo que falta", () => {
    expect(faltantesDePedido(pedido())).toEqual([]);
    const sinFotos = pedido();
    sinFotos.ficha.fotos = [];
    const f = faltantesDePedido(
      pedido({
        ficha: sinFotos.ficha,
        titulo: "x".repeat(70),
        tallas: ["25", "40"],
        colores: [{ codigo: "BLK-RED", nombre: "", fotos: [] }],
      }),
    );
    expect(f.join(" ")).toMatch(/pasa de 60/);
    expect(f.join(" ")).toMatch(/de esta ficha: 40/);
    expect(f.join(" ")).toMatch(/guion/);
    expect(f.join(" ")).toMatch(/no tiene fotos/);
    expect(f.join(" ")).toMatch(/nombre en español/);
  });

  it("exige lo obligatorio de la categoría", () => {
    const p = pedido();
    p.ficha.atributos = p.ficha.atributos.map((a) => (a.id === "FOOTWEAR_STYLE" ? { ...a, valor: "" } : a));
    expect(faltantesDePedido(p).join(" ")).toMatch(/Estilo del calzado/);
  });

  it("saca los errores de MELI sin las advertencias", () => {
    const cuerpo = {
      message: "Validation error",
      cause: [
        { type: "warning", message: "Mandatory free shipping added" },
        { type: "error", code: "invalid.fashion_grid.grid_row_id.values", message: "Attribute [SIZE_GRID_ROW_ID] is not valid" },
      ],
    };
    expect(erroresDeMeli(cuerpo)).toEqual(["Attribute [SIZE_GRID_ROW_ID] is not valid"]);
    expect(erroresDeMeli({ message: "forbidden" })).toEqual(["forbidden"]);
    // Lo que contestó /items/validate a un cuerpo bueno: 400 con puras advertencias.
    const avisos = { message: "Validation error", cause: [{ type: "warning", message: "Mandatory free shipping added" }] };
    expect(erroresDeMeli(avisos)).toEqual([]);
    expect(soloAdvertencias(avisos)).toBe(true);
    expect(soloAdvertencias(cuerpo)).toBe(false);
    expect(soloAdvertencias({ message: "forbidden" })).toBe(false);
  });
});
