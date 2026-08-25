import { describe, expect, it } from "vitest";
import {
  ESCENAS,
  armarPrompts,
  detectarGenero,
  detectarTipo,
  type TipoCalzado,
} from "./escenas";

describe("detectarTipo", () => {
  it("distingue botas, sandalias, tenis y tacones por el título real", () => {
    expect(detectarTipo("BOTA CASUAL GETAC PARA CABALLERO GT128")).toBe("bota");
    expect(detectarTipo("Botín Chelsea dama piel")).toBe("bota");
    expect(detectarTipo("SANDALIA DE PLAYA PARA MUJER")).toBe("sandalia");
    expect(detectarTipo("Huarache artesanal caballero")).toBe("sandalia");
    expect(detectarTipo("TENIS DEPORTIVO RUNNER GT200")).toBe("tenis");
    expect(detectarTipo("Zapatilla de tacón alto fiesta")).toBe("tacon");
    expect(detectarTipo("MOCASÍN DE PIEL CAFÉ")).toBe("mocasin");
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
  const tipos: TipoCalzado[] = ["bota", "sandalia", "tenis", "tacon", "mocasin", "zapato"];

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
});
