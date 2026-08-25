import { describe, expect, it } from "vitest";
import {
  ESCENAS,
  armarPromptProducto,
  armarPromptHablado,
  detectarGenero,
  detectarTipo,
  guionInicial,
  type TipoCalzado,
} from "./escenas";

const TIPOS: TipoCalzado[] = [
  "bota",
  "sandalia",
  "sandalia_agua",
  "pantufla",
  "tenis",
  "tacon",
  "mocasin",
  "zapato",
];

describe("detectarTipo", () => {
  it("distingue los tipos por el título real", () => {
    expect(detectarTipo("BOTA CASUAL GETAC PARA CABALLERO GT128")).toBe("bota");
    expect(detectarTipo("Botín Chelsea dama piel")).toBe("bota");
    expect(detectarTipo("Huarache artesanal caballero")).toBe("sandalia");
    expect(detectarTipo("TENIS DEPORTIVO RUNNER GT200")).toBe("tenis");
    expect(detectarTipo("Zapatilla de tacón alto fiesta")).toBe("tacon");
    expect(detectarTipo("MOCASÍN DE PIEL CAFÉ")).toBe("mocasin");
  });

  it("las pantuflas no son sandalias, aunque sean de corcho", () => {
    expect(detectarTipo("Pantufla De Corcho Mujer Hombre Peluche Correa Ajustable")).toBe("pantufla");
  });

  it("separa las sandalias de agua de las de vestir", () => {
    expect(detectarTipo("SANDALIA ACUATICA PARA PLAYA")).toBe("sandalia_agua");
    expect(detectarTipo("SANDALIA DE PLAYA PARA MUJER")).toBe("sandalia_agua");
    expect(detectarTipo("Chancla de alberca")).toBe("sandalia_agua");
    expect(detectarTipo("SANDALIA DE CORCHO DAMA")).toBe("sandalia");
  });

  it("cae en zapato cuando no reconoce nada", () => {
    expect(detectarTipo("CALZADO CONFORT GT-500")).toBe("zapato");
  });
});

describe("detectarGenero", () => {
  it("detecta dama, caballero y niños", () => {
    expect(detectarGenero("BOTA PARA DAMA")).toBe("mujer");
    expect(detectarGenero("Tenis de mujer casual")).toBe("mujer");
    expect(detectarGenero("ZAPATO CABALLERO VESTIR")).toBe("hombre");
    expect(detectarGenero("Bota infantil niño")).toBe("nino");
    expect(detectarGenero("ZAPATO CONFORT")).toBeNull();
  });
});

describe("armarPromptProducto", () => {
  it("toda escena de todo tipo produce prompt con el candado de fidelidad", () => {
    for (const tipo of TIPOS) {
      for (const escena of ESCENAS) {
        const p = armarPromptProducto({ tipo, escenaId: escena.id, semilla: 0.5 });
        expect(p.length).toBeGreaterThan(80);
        expect(p).toMatch(/must remain EXACTLY/);
        expect(p).toMatch(/Do not redesign/);
      }
    }
  });

  it("la semilla cambia la variante y es determinista", () => {
    const a = armarPromptProducto({ tipo: "bota", escenaId: "escaparate", semilla: 0.0 });
    const b = armarPromptProducto({ tipo: "bota", escenaId: "escaparate", semilla: 0.2 });
    expect(a).not.toEqual(b);
    const c = armarPromptProducto({ tipo: "bota", escenaId: "escaparate", semilla: 0.0 });
    expect(c).toEqual(a);
  });

  it("nunca pide regenerar personas ni cambiar el producto", () => {
    for (const escena of ESCENAS) {
      const p = armarPromptProducto({ tipo: "tenis", escenaId: escena.id, semilla: 0.7 });
      expect(p).not.toMatch(/influencer|wearing|redesigned/i);
    }
  });
});

describe("clip hablado", () => {
  it("el guion inicial concuerda en género gramatical", () => {
    expect(guionInicial("pantufla")).toMatch(/estas pantuflas/);
    expect(guionInicial("pantufla")).toMatch(/comodísimas/);
    expect(guionInicial("tenis")).toMatch(/estos tenis/);
    expect(guionInicial("tenis")).toMatch(/comodísimos/);
  });

  it("mete el guion como voz en off en español y respeta el candado", () => {
    const p = armarPromptHablado({
      tipo: "pantufla",
      genero: "mujer",
      semilla: 0.5,
      guion: 'Estas pantuflas son "lo máximo"',
    });
    expect(p).toContain("Mexican Spanish");
    expect(p).toContain("voice-over");
    // Las comillas dobles del guion se convierten: son las que delimitan el diálogo.
    expect(p).toContain("Estas pantuflas son 'lo máximo'");
    expect(p).toMatch(/must remain EXACTLY/);
  });

  it("la voz sigue el género del producto", () => {
    expect(
      armarPromptHablado({ tipo: "bota", genero: "hombre", semilla: 0.2, guion: "Hola" }),
    ).toContain("male voice-over");
    expect(
      armarPromptHablado({ tipo: "bota", genero: "mujer", semilla: 0.2, guion: "Hola" }),
    ).toContain("female voice-over");
  });
});
