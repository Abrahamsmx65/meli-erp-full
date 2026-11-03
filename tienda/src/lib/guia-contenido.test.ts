import { describe, expect, it } from "vitest";
import { guiaConIA, guiaDeContenido, MAX_PUNTOS, textoDeGuia } from "./guia-contenido";
import type { ProductoInfluencer } from "./influencers";

const producto = (o: Partial<ProductoInfluencer>): ProductoInfluencer => ({
  productId: "amz-X",
  modelo: "GT156",
  titulo: "",
  categoria: null,
  activo: true,
  precioDesde: null,
  precioHasta: null,
  bullets: [],
  colores: [{ color: "Negro", fotos: [], tallas: ["25", "26", "27", "28"], tallasConStock: [] }],
  pares: 0,
  ...o,
});

const OCTUBRE = new Date(2026, 9, 26);

describe("guía de contenido", () => {
  it("pantuflas: lo de la categoría y lo que dice el título", () => {
    const g = guiaDeContenido(
      producto({
        categoria: "PANTUFLAS HOMBRE",
        titulo: "GETAC Pantuflas de espuma viscoelástica para Hombre, Forro de Peluche afelpado Suela antideslizante Plantillas Memory Foam",
      }),
      OCTUBRE,
    );
    expect(g.puntosFuertes.join(" ")).toMatch(/memory foam/i);
    expect(g.puntosFuertes.join(" ")).toMatch(/afelpado/i);
    // en una pantufla la suela se cuenta para salir al patio, no para pisos mojados
    expect(g.puntosFuertes.join(" ")).toMatch(/patio/);
    // el título no habla de corcho ni de agua
    expect(g.puntosFuertes.join(" ")).not.toMatch(/corcho|impermeable/i);
    // «viscoelástica» no es un elástico lateral
    expect(g.puntosFuertes.join(" ")).not.toMatch(/agujetas/);
    // pantufla en octubre: idea de frío primero
    expect(g.ideas[0]).toMatch(/frío/);
    expect(g.ganchos[0]).toMatch(/fríos/);
  });

  it("sandalias de corcho: ideas de outfits, sin promesas de calor", () => {
    const g = guiaDeContenido(
      producto({
        modelo: "GT114",
        categoria: "CORCHO",
        titulo: "GETAC CHANCLAS MUJER, SANDALIAS HOMBRE con Plantilla de corcho Suela Antiderrapante EVA Unisex, Broche hebilla con Correas ajustables",
        precioDesde: 181,
        precioHasta: 181,
        total: 90104,
        colores: ["Negro", "Beige", "Rosa"].map((color) => ({ color, fotos: [], tallas: ["23", "24", "25"], tallasConStock: [] })),
      }),
      OCTUBRE,
    );
    expect(g.puntosFuertes.join(" ")).toMatch(/corcho/);
    expect(g.puntosFuertes.join(" ")).toMatch(/hebillas/);
    expect(g.datos[0]).toBe("Modelo GT114 · corcho.");
    expect(g.puntosFuertes.join(" ")).not.toMatch(/calientito|antiderrapante/i);
    expect(g.ideas.join(" ")).toMatch(/outfits/);
    expect(g.ideas.join(" ")).toMatch(/3 colores/);
    expect(g.ganchos.join(" ")).toMatch(/menos de \$190/);
    expect(g.datos.join(" ")).toMatch(/Tallas 23 a 25/);
    expect(g.datos.join(" ")).toMatch(/90,104 pares/);
  });

  it("alpargata: yute y cuña, nada de piso mojado ni antiderrapante (dueño, 26-oct-2026)", () => {
    const g = guiaDeContenido(
      producto({
        modelo: "GT129",
        categoria: "ALPARGATAS",
        titulo: "GETAC Alpargatas de Punta Abierta para Mujer, Zapatillas de Cuña Suela antiderrapante Sandalias de Plataforma Yute con Correa Elástica",
      }),
      OCTUBRE,
    );
    const todo = [...g.puntosFuertes, ...g.comoMostrarlo, ...g.ideas, ...g.ganchos].join(" ");
    expect(g.puntosFuertes.join(" ")).toMatch(/yute/);
    expect(g.puntosFuertes.join(" ")).toMatch(/[Cc]uña/);
    expect(g.puntosFuertes.join(" ")).toMatch(/elástica/);
    expect(todo).not.toMatch(/antiderrapante|antideslizante|mojad|resbal/i);
    expect(g.ideas.join(" ")).toMatch(/verano/);
  });

  it("botas: el estilo del título, sin antiderrapante", () => {
    const g = guiaDeContenido(
      producto({
        categoria: "BOTAS MUJER",
        titulo: "GETAC Botas tipo Chelsea para Mujer de Gamuza, Bota con Tacón Ancho de Punta Redonda Elástico Lateral, Suela antiderrapante",
      }),
      OCTUBRE,
    );
    const todo = [...g.puntosFuertes, ...g.comoMostrarlo, ...g.ideas].join(" ");
    expect(g.puntosFuertes.join(" ")).toMatch(/Chelsea/);
    expect(g.puntosFuertes.join(" ")).toMatch(/gamuza/);
    expect(todo).not.toMatch(/antiderrapante|antideslizante|mojad|resbal/i);
  });

  it("botas de lluvia y chanclas EVA sí cuentan la suela antiderrapante", () => {
    const lluvia = guiaDeContenido(producto({ categoria: "BOTAS LLUVIA", titulo: "Botas de lluvia impermeables Suela antiderrapante" }), OCTUBRE);
    expect(lluvia.puntosFuertes.join(" ")).toMatch(/banquetas mojadas/);
    const eva = guiaDeContenido(producto({ categoria: "SANDALIAS EVA", titulo: "Chanclas EVA Flip Flop Suela Antiderrapante" }), OCTUBRE);
    expect(eva.puntosFuertes.join(" ")).toMatch(/regadera/);
  });

  it("nunca más de MAX_PUNTOS y la primera toma es abrir con el producto", () => {
    const g = guiaDeContenido(
      producto({
        titulo:
          "Memory Foam afelpado impermeable antiderrapante plataforma corcho hebilla secado rápido ligero soporte de arco cremallera gamuza remaches",
      }),
      OCTUBRE,
    );
    expect(g.puntosFuertes).toHaveLength(MAX_PUNTOS);
    expect(g.comoMostrarlo[0]).toMatch(/Abre con el producto/);
  });

  it("sin precio ni stock no inventa datos", () => {
    const g = guiaDeContenido(producto({ titulo: "Botas de lluvia impermeables", categoria: "BOTAS LLUVIA" }), OCTUBRE);
    expect(g.datos.join(" ")).not.toMatch(/Precio|stock/);
    expect(g.ideas.join(" ")).toMatch(/charco/);
  });

  it("el texto para copiar lleva las secciones con viñetas", () => {
    const p = producto({ titulo: "Suela antiderrapante" });
    const t = textoDeGuia(p, guiaDeContenido(p, OCTUBRE));
    expect(t).toMatch(/^GETAC GT156 · ideas para tu video/);
    expect(t).toMatch(/Puntos fuertes:\n• Suela antiderrapante/);
  });
});

describe("guía de Claude", () => {
  const ia = {
    resumen: "Cuña de yute con correa cruzada en mezclilla.",
    puntosFuertes: [{ punto: "Correa cruzada de mezclilla deslavada.", toma: "Close-up de la mezclilla con luz de ventana." }],
    ideas: ["Look de brunch con vestido blanco."],
    ganchos: ["La cuña que combina con todo tu clóset."],
    paraQuien: ["Quien quiere altura sin tacón delgado."],
    evitar: ["No digas que es piel."],
  };

  it("manda sobre las reglas y los datos siguen saliendo del catálogo", () => {
    const p = producto({ modelo: "GT145", categoria: "ALPARGATAS", titulo: "Alpargatas de cuña", precioDesde: 373, total: 336 });
    const g = guiaConIA(p, ia, OCTUBRE);
    expect(g.deIA).toBe(true);
    expect(g.puntosFuertes).toEqual(["Correa cruzada de mezclilla deslavada."]);
    expect(g.comoMostrarlo[1]).toMatch(/mezclilla/);
    expect(g.ganchos.at(-1)).toMatch(/menos de \$380/);
    expect(g.evitar).toEqual(["No digas que es piel."]);
    expect(g.datos.join(" ")).toMatch(/336 pares/);
    const t = textoDeGuia(p, g);
    expect(t).toMatch(/Lo que no debes decir:\n• No digas que es piel/);
  });

  it("sin guía de Claude se queda la de reglas", () => {
    const p = producto({ categoria: "ALPARGATAS", titulo: "Alpargatas de cuña yute" });
    expect(guiaConIA(p, null, OCTUBRE)).toEqual(guiaDeContenido(p, OCTUBRE));
  });
});
