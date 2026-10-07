import { describe, expect, it } from "vitest";
import { indexarCatalogo } from "../etiquetas/resolver";
import { coloresFantasma, evaluarAmarre } from "./amarre-pedido";
import { armarMapaAlias } from "./alias-color";

const ix = indexarCatalogo([
  { sku: "MY2307-CHOCOLATTE BROWN-24-MX", modelo: "MY2307", color: "CHOCOLATTE BROWN", talla: "24" },
  { sku: "MY2307-BLUE-24-MX", modelo: "MY2307", color: "BLUE", talla: "24" },
  { sku: "MY2307-BLUE-25-MX", modelo: "MY2307", color: "BLUE", talla: "25" },
  { sku: "GT114-BLK-26-MX", modelo: "GT114", color: "BLK", talla: "26" },
  { sku: "GT114-DK BROWN-26-MX", modelo: "GT114", color: "DK BROWN", talla: "26" },
]);

describe("evaluarAmarre: ¿el renglón del pedido existe en MELI?", () => {
  it("ligado con los amarres de siempre (sinónimos, anotación, una letra)", () => {
    expect(evaluarAmarre(ix, { modelo: "GT114", color: "BLACK", talla: "26" }).estado).toBe("ligado");
    expect(evaluarAmarre(ix, { modelo: "GT114", color: "BLK (NEGRO)", talla: "26" }).skuMeli).toBe("GT114-BLK-26-MX");
    expect(evaluarAmarre(ix, { modelo: "MY2307", color: "CHOCOLATE BROWN", talla: "24" }).estado).toBe("ligado");
  });

  it("color fantasma: el modelo está en MELI pero con otros colores, y se enseñan", () => {
    const a = evaluarAmarre(ix, { modelo: "MY2307", color: "NAVY", tallas: { "24": 3, "25": 5 } });
    expect(a.estado).toBe("color_fantasma");
    expect(a.coloresMeli).toEqual(["BLUE", "CHOCOLATTE BROWN"]);
  });

  it("un amarre a mano liga el color del pedido con la variante de MELI que eligió el dueño", () => {
    const alias = armarMapaAlias([
      { modelo: "MY2307", color: "NAVY", color_meli: "BLUE", color_pedido: "NAVY" },
      { modelo: "MY2307", color: "GREY BLUE", color_meli: null, color_pedido: "GREY BLUE" },
    ]);
    const ligado = evaluarAmarre(ix, { modelo: "MY2307", color: "NAVY", tallas: { "24": 3 } }, alias);
    expect(ligado.estado).toBe("ligado");
    expect(ligado.skuMeli).toBe("MY2307-BLUE-24-MX");
    expect(ligado.ligadoA).toBe("BLUE");

    // Confirmado como color nuevo: ya no se grita, pero tampoco se liga.
    const nuevo = evaluarAmarre(ix, { modelo: "MY2307", color: "GREY BLUE", tallas: { "24": 3 } }, alias);
    expect(nuevo.estado).toBe("color_nuevo");
    expect(nuevo.skuMeli).toBeNull();

    // Un amarre a un color que MELI ya no tiene vuelve a ser fantasma.
    const roto = evaluarAmarre(
      ix,
      { modelo: "MY2307", color: "NAVY", tallas: { "24": 3 } },
      armarMapaAlias([{ modelo: "MY2307", color: "NAVY", color_meli: "TEAL", color_pedido: "NAVY" }]),
    );
    expect(roto.estado).toBe("color_fantasma");
    expect(roto.ligadoA).toBe("TEAL");
  });

  it("modelo nuevo: no hay nada publicado de ese modelo", () => {
    const a = evaluarAmarre(ix, { modelo: "GT999", color: "BLK", talla: "24" });
    expect(a.estado).toBe("modelo_nuevo");
    expect(a.coloresMeli).toEqual([]);
  });

  it("una corrida sin tallas prueba con las tallas publicadas del modelo", () => {
    expect(evaluarAmarre(ix, { modelo: "MY2307", color: "BLUE" }).estado).toBe("ligado");
  });

  it("coloresFantasma resume sin repetir, solo lo fantasma", () => {
    const lineas = [
      { modelo: "MY2307", color: "NAVY", talla: "24" },
      { modelo: "MY2307", color: "NAVY", talla: "25" },
      { modelo: "MY2307", color: "BLUE", talla: "24" },
      { modelo: "GT999", color: "BLK", talla: "24" },
    ];
    const r = coloresFantasma(lineas, lineas.map((l) => evaluarAmarre(ix, l)));
    expect(r).toEqual([{ modelo: "MY2307", color: "NAVY", coloresMeli: ["BLUE", "CHOCOLATTE BROWN"] }]);
  });
});
