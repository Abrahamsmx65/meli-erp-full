import { describe, expect, it } from "vitest";
import {
  COSTO_MAXIMO_GUIA_USD,
  costoDeUso,
  disponibleDelMes,
  fotoAmazon,
  fotosParaAnalizar,
  huellaDeProducto,
  limpiarGuia,
  mensajeDeProducto,
  modelosPorGenerar,
  type GuiaGuardada,
} from "./guia-ia";
import type { ProductoCatalogo } from "./catalogo-amazon";

const foto = (id: string) => `https://m.media-amazon.com/images/I/${id}.jpg`;

const producto = (o: Partial<ProductoCatalogo>): ProductoCatalogo => ({
  productId: "amz-GT145",
  modelo: "GT145",
  titulo: "GETAC Alpargatas de cuña para mujer",
  categoria: "ALPARGATAS",
  activo: true,
  precioDesde: 373,
  precioHasta: 373,
  precios: null,
  bullets: [],
  colores: [
    { color: "Azul marino", fotos: [foto("A1"), foto("A2"), foto("A3")], tallas: ["23", "24"], tallasConStock: [] },
    { color: "Camel", fotos: [foto("B1"), foto("B2")], tallas: ["23"], tallasConStock: [] },
  ],
  pares: 0,
  oculto: false,
  bodega: 0,
  mar: 0,
  tiktok: 0,
  total: 10,
  ...o,
});

const SIN = { bullets: [], descripcion: null };

describe("guías de Claude: motor", () => {
  it("manda la principal de cada color y la segunda del primero, al tamaño pedido", () => {
    expect(fotosParaAnalizar(producto({}))).toEqual([
      "https://m.media-amazon.com/images/I/A1._AC_SL800_.jpg",
      "https://m.media-amazon.com/images/I/B1._AC_SL800_.jpg",
      "https://m.media-amazon.com/images/I/A2._AC_SL800_.jpg",
      "https://m.media-amazon.com/images/I/A3._AC_SL800_.jpg",
    ]);
    expect(fotoAmazon("https://otro.com/x.jpg", 800)).toBe("https://otro.com/x.jpg");
  });

  it("la huella cambia con el título o las fotos, no con el stock", () => {
    const h = huellaDeProducto(producto({}), SIN);
    expect(huellaDeProducto(producto({ total: 999 }), SIN)).toBe(h);
    expect(huellaDeProducto(producto({ titulo: "Otro título" }), SIN)).not.toBe(h);
    expect(huellaDeProducto(producto({}), { bullets: ["Suela de yute"], descripcion: null })).not.toBe(h);
  });

  it("toca lo que no tiene guía o cambió; no pisa lo corregido a mano ni lo oculto", () => {
    const a = producto({ modelo: "GT145", total: 5 });
    const b = producto({ modelo: "GT146", total: 50 });
    const c = producto({ modelo: "GT147", total: 1 });
    const d = producto({ modelo: "GT148", oculto: true });
    const huellas = new Map([a, b, c, d].map((p) => [p.modelo, huellaDeProducto(p, SIN)]));
    const guardada = (huella: string, editada = false) => ({ huella, editada }) as GuiaGuardada;
    const guardadas = { GT145: guardada("vieja"), GT146: guardada(huellas.get("GT146")!), GT147: guardada("vieja", true) };
    expect(modelosPorGenerar([a, b, c, d], guardadas, huellas, 10)).toEqual(["GT145"]);
    // sin guías, primero lo que tiene más stock
    expect(modelosPorGenerar([a, b, c], {}, huellas, 2)).toEqual(["GT146", "GT145"]);
  });

  it("cuenta el gasto con los tokens y respeta el tope del mes", () => {
    expect(costoDeUso({ input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
    expect(costoDeUso({ input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(20);
    const ahora = new Date("2026-10-28T12:00:00Z");
    expect(disponibleDelMes({ "2026-10": 14.8 }, ahora, 15)).toBeLessThan(COSTO_MAXIMO_GUIA_USD);
    expect(disponibleDelMes({ "2026-09": 15 }, ahora, 15)).toBe(15);
  });

  it("limpia la respuesta y rechaza la que viene incompleta", () => {
    const g = limpiarGuia({
      resumen: "  Cuña de   yute ",
      puntosFuertes: [{ punto: "Correa de mezclilla", toma: "Close-up" }, { punto: "", toma: "x" }],
      ideas: ["Look de brunch", 3],
      ganchos: ["La cuña que va con todo"],
      paraQuien: [],
      evitar: ["No digas que es piel"],
    });
    expect(g?.resumen).toBe("Cuña de yute");
    expect(g?.puntosFuertes).toHaveLength(1);
    expect(g?.ideas).toEqual(["Look de brunch"]);
    expect(limpiarGuia({ puntosFuertes: [], ideas: ["x"], ganchos: ["y"] })).toBeNull();
    expect(limpiarGuia("texto")).toBeNull();
  });

  it("el mensaje lleva título, categoría, colores, tallas y los textos de la ficha", () => {
    const m = mensajeDeProducto(producto({}), { bullets: ["Plantilla acolchada"], descripcion: "Para el verano." });
    expect(m).toMatch(/Categoría: ALPARGATAS/);
    expect(m).toMatch(/Colores: Azul marino, Camel/);
    expect(m).toMatch(/- Plantilla acolchada/);
    expect(m).toMatch(/Descripción:\nPara el verano\./);
  });
});
