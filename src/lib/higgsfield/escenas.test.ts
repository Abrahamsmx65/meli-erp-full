import { describe, expect, it } from "vitest";
import {
  ESCENAS,
  armarPrompts,
  armarPromptsHablado,
  detectarGenero,
  detectarTipo,
  guionInicial,
  type TipoCalzado,
} from "./escenas";

describe("detectarTipo", () => {
  it("distingue botas, sandalias, tenis y tacones por el título real", () => {
    expect(detectarTipo("BOTA CASUAL GETAC PARA CABALLERO GT128")).toBe("bota");
    expect(detectarTipo("Botín Chelsea dama piel")).toBe("bota");
    expect(detectarTipo("SANDALIA DE PLAYA PARA MUJER")).toBe("sandalia_agua");
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

describe("armarPrompts", () => {
  const tipos: TipoCalzado[] = [
    "bota",
    "sandalia",
    "sandalia_agua",
    "pantufla",
    "tenis",
    "tacon",
    "mocasin",
    "zapato",
  ];

  it("toda escena de todo tipo produce ambos prompts, con ancla al producto", () => {
    for (const tipo of tipos) {
      for (const escena of ESCENAS) {
        const p = armarPrompts({ tipo, escenaId: escena.id, genero: "mujer", semilla: 0.5 });
        expect(p.imagen.length).toBeGreaterThan(60);
        expect(p.video.length).toBeGreaterThan(40);
        // El candado de fidelidad: la imagen siempre exige respetar la foto.
        expect(p.imagen).toMatch(/reference/i);
      }
    }
  });

  it("la semilla cambia la variante pero no rompe la escena", () => {
    const a = armarPrompts({ tipo: "bota", escenaId: "uso-real", genero: "hombre", semilla: 0.1 });
    const b = armarPrompts({ tipo: "bota", escenaId: "uso-real", genero: "hombre", semilla: 0.9 });
    expect(a.imagen).not.toEqual(b.imagen);
    // Misma semilla, mismo resultado: el dado es determinista.
    const c = armarPrompts({ tipo: "bota", escenaId: "uso-real", genero: "hombre", semilla: 0.1 });
    expect(c).toEqual(a);
  });

  it("las escenas de producto no meten personas", () => {
    const p = armarPrompts({ tipo: "sandalia", escenaId: "escaparate", genero: "mujer", semilla: 0.3 });
    expect(p.imagen).not.toMatch(/influencer|person\b/i);
  });

  it("las sandalias de vestir no se mojan; las de agua sí pueden", () => {
    for (const escena of ESCENAS) {
      for (const s of [0.1, 0.35, 0.6, 0.85]) {
        const p = armarPrompts({ tipo: "sandalia", escenaId: escena.id, genero: "mujer", semilla: s });
        expect(`${p.imagen} ${p.video}`).not.toMatch(/water|splash|wet|pool|beach/i);
      }
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

  it("mete el guion en español dentro del prompt de video", () => {
    const p = armarPromptsHablado({
      tipo: "pantufla",
      genero: "mujer",
      semilla: 0.5,
      guion: 'Estas pantuflas son "lo máximo"',
    });
    expect(p.video).toContain("Mexican Spanish");
    // Las comillas dobles del guion se convierten: son las que delimitan el diálogo.
    expect(p.video).toContain("Estas pantuflas son 'lo máximo'");
    expect(p.imagen).toMatch(/reference/i);
  });
});
