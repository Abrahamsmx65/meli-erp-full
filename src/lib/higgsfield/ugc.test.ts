import { describe, expect, it } from "vitest";
import {
  armarConceptoUGC,
  promptUGCConVozIA,
  promptUGCParaSpeak,
} from "./ugc";
import type { Genero, TipoCalzado } from "./escenas";

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

const GENEROS: Genero[] = ["mujer", "hombre", "nino", null];

describe("motor de conceptos UGC", () => {
  it("todo tipo y género arma un concepto completo, con candado y sin tokens sueltos", () => {
    for (const tipo of TIPOS) {
      for (const genero of GENEROS) {
        for (const semilla of [0.05, 0.35, 0.65, 0.95]) {
          const c = armarConceptoUGC({ tipo, genero, semilla });
          expect(c.etiqueta.length).toBeGreaterThan(3);
          expect(c.promptImagen).toContain("9:16");
          expect(c.promptImagen).toContain("NO studio lighting");
          expect(c.promptImagen).toMatch(/must remain EXACTLY/);
          expect(c.promptImagen).toContain("do not invent");
          // El guion queda en español, armado y sin {tokens} sin reemplazar.
          expect(c.guionSugerido.length).toBeGreaterThan(40);
          expect(c.guionSugerido).not.toMatch(/\{[a-z]+\}/);
          // La narrativa prohíbe el look de anuncio.
          expect(c.narrativa).toContain("NOT an ad");
          expect(c.narrativa).toContain("smartphone");
        }
      }
    }
  });

  it("es determinista con la semilla y varía al tirar el dado", () => {
    const a = armarConceptoUGC({ tipo: "bota", genero: "hombre", semilla: 0.2 });
    const b = armarConceptoUGC({ tipo: "bota", genero: "hombre", semilla: 0.2 });
    expect(a).toEqual(b);

    // Con suficientes tiradas deben salir guiones distintos.
    const guiones = new Set(
      [0.01, 0.13, 0.27, 0.41, 0.55, 0.69, 0.83, 0.97].map(
        (s) => armarConceptoUGC({ tipo: "bota", genero: "hombre", semilla: s }).guionSugerido,
      ),
    );
    expect(guiones.size).toBeGreaterThan(2);
  });

  it("cada público recibe sus conceptos: GRWM es de mujer, para-diario de hombre", () => {
    const conceptosMujer = new Set(
      Array.from({ length: 40 }, (_, i) =>
        armarConceptoUGC({ tipo: "sandalia", genero: "mujer", semilla: i / 40 }).id,
      ),
    );
    const conceptosHombre = new Set(
      Array.from({ length: 40 }, (_, i) =>
        armarConceptoUGC({ tipo: "bota", genero: "hombre", semilla: i / 40 }).id,
      ),
    );
    expect(conceptosMujer.has("outfit-del-dia")).toBe(true);
    expect(conceptosMujer.has("para-diario")).toBe(false);
    expect(conceptosHombre.has("para-diario")).toBe(true);
    expect(conceptosHombre.has("outfit-del-dia")).toBe(false);
  });

  it("las pantuflas cuentan la llegada a casa y las de agua el día de alberca", () => {
    const idsPantufla = new Set(
      Array.from({ length: 40 }, (_, i) =>
        armarConceptoUGC({ tipo: "pantufla", genero: "mujer", semilla: i / 40 }).id,
      ),
    );
    expect(idsPantufla.has("llegue-a-casa")).toBe(true);
    const idsAgua = new Set(
      Array.from({ length: 40 }, (_, i) =>
        armarConceptoUGC({ tipo: "sandalia_agua", genero: "hombre", semilla: i / 40 }).id,
      ),
    );
    expect(idsAgua.has("dia-de-alberca")).toBe(true);
  });

  it("para niños presenta una mamá adulta, nunca menores generados", () => {
    for (const semilla of [0.1, 0.5, 0.9]) {
      const c = armarConceptoUGC({ tipo: "tenis", genero: "nino", semilla });
      expect(c.promptImagen).toContain("mom");
      expect(c.promptImagen).not.toMatch(/\bchild\b|\bkid\b(?!s')/i);
    }
  });

  it("la concordancia de género gramatical sale bien armada", () => {
    const guiones = Array.from({ length: 20 }, (_, i) =>
      armarConceptoUGC({ tipo: "bota", genero: "hombre", semilla: i / 20 }).guionSugerido,
    ).join(" | ");
    // "botas" es femenino: nunca "estos botas" ni "unos botas".
    expect(guiones).not.toMatch(/estos botas|unos botas|los botas/);
  });

  it("los remates: Speak sin diálogo y voz de IA con el guion en español", () => {
    const c = armarConceptoUGC({ tipo: "tenis", genero: "hombre", semilla: 0.4 });
    const speak = promptUGCParaSpeak(c.narrativa);
    expect(speak).toMatch(/must remain EXACTLY/);
    expect(speak).not.toContain("saying:");

    const vozIA = promptUGCConVozIA(c.narrativa, 'Estos tenis son "otro nivel"');
    expect(vozIA).toContain("Mexican Spanish");
    expect(vozIA).toContain("lip sync");
    expect(vozIA).toContain("Estos tenis son 'otro nivel'");
    expect(vozIA).toMatch(/must remain EXACTLY/);
  });
});
