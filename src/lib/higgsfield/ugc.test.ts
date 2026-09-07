import { describe, expect, it } from "vitest";
import {
  armarConceptoUGC,
  detectarRasgos,
  promptUGCConVozIA,
  promptUGCDesdeFoto,
  promptUGCParaSpeak,
} from "./ugc";
import type { Genero, TipoCalzado } from "./escenas";

const TIPOS: TipoCalzado[] = [
  "bota",
  "bota_industrial",
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
    // Con el paquete de 100 conceptos las tiradas deben ser muchas para que
    // un concepto específico aparezca seguro en el muestreo.
    const conceptosMujer = new Set(
      Array.from({ length: 800 }, (_, i) =>
        armarConceptoUGC({ tipo: "sandalia", genero: "mujer", semilla: i / 800 }).id,
      ),
    );
    const conceptosHombre = new Set(
      Array.from({ length: 800 }, (_, i) =>
        armarConceptoUGC({ tipo: "bota", genero: "hombre", semilla: i / 800 }).id,
      ),
    );
    expect(conceptosMujer.has("outfit-del-dia")).toBe(true);
    expect(conceptosMujer.has("para-diario")).toBe(false);
    expect(conceptosHombre.has("para-diario")).toBe(true);
    expect(conceptosHombre.has("outfit-del-dia")).toBe(false);
  });

  it("las pantuflas cuentan la llegada a casa y las de agua el día de alberca", () => {
    const idsPantufla = new Set(
      Array.from({ length: 800 }, (_, i) =>
        armarConceptoUGC({ tipo: "pantufla", genero: "mujer", semilla: i / 800 }).id,
      ),
    );
    expect(idsPantufla.has("llegue-a-casa")).toBe(true);
    const idsAgua = new Set(
      Array.from({ length: 800 }, (_, i) =>
        armarConceptoUGC({ tipo: "sandalia_agua", genero: "hombre", semilla: i / 800 }).id,
      ),
    );
    expect(idsAgua.has("dia-de-alberca")).toBe(true);
  });

  const CONCEPTOS_NINOS = [
    "para-mis-hijos",
    "regreso-a-clases-ninos",
    "parque-sin-pendientes",
    "crecen-rapidisimo",
    "uniforme-que-aguanta",
  ];

  it("para niños presenta una mamá adulta, nunca menores generados", () => {
    for (const semilla of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const c = armarConceptoUGC({ tipo: "tenis", genero: "nino", semilla });
      expect(CONCEPTOS_NINOS).toContain(c.id);
      expect(c.promptImagen).toContain("mom");
      expect(c.promptImagen).toContain("no children on camera");
    }
  });

  it("los conceptos de niños jamás aparecen para adultos", () => {
    for (const tipo of TIPOS) {
      for (const semilla of [0.05, 0.35, 0.65, 0.95]) {
        expect(CONCEPTOS_NINOS).not.toContain(
          armarConceptoUGC({ tipo, genero: "hombre", semilla }).id,
        );
        expect(CONCEPTOS_NINOS).not.toContain(
          armarConceptoUGC({ tipo, genero: "mujer", semilla }).id,
        );
      }
    }
  });

  it("las botas industriales venden trabajo rudo, no moda", () => {
    const ids = new Set(
      Array.from({ length: 800 }, (_, i) =>
        armarConceptoUGC({ tipo: "bota_industrial", genero: "hombre", semilla: i / 800 }).id,
      ),
    );
    expect(ids.has("aguantan-trabajo")).toBe(true);
    expect(ids.has("dia-en-la-obra")).toBe(true);
    expect(ids.has("outfit-del-dia")).toBe(false);
  });

  it("el paquete de 100 conceptos entra al motor: mucha variedad real", () => {
    for (const tipo of TIPOS) {
      const ids = new Set(
        Array.from({ length: 400 }, (_, i) =>
          armarConceptoUGC({ tipo, genero: "mujer", semilla: i / 400 }).id,
        ),
      );
      // Cada tipo debe tener un abanico amplio de escenarios (los suyos +
      // los transversales), no un puñito.
      expect(ids.size).toBeGreaterThanOrEqual(15);
    }
    // Y entre los que salen deben estar los formatos nuevos del brief.
    const idsTodos = new Set(
      Array.from({ length: 800 }, (_, i) =>
        armarConceptoUGC({ tipo: "tenis", genero: "hombre", semilla: i / 800 }).id,
      ),
    );
    expect(idsTodos.has("problema-solucion")).toBe(true);
    expect(idsTodos.has("unboxing-asmr")).toBe(true);
    expect(idsTodos.has("resena-tres-puntos")).toBe(true);
    expect(idsTodos.has("antes-y-despues")).toBe(true);
    expect(idsTodos.has("dia-en-mi-vida")).toBe(true);
  });

  it("con más conceptos y variantes, 20 tiradas dan varios conceptos distintos", () => {
    const ids = new Set(
      Array.from({ length: 20 }, (_, i) =>
        armarConceptoUGC({ tipo: "tenis", genero: "hombre", semilla: (i + 0.5) / 20 }).id,
      ),
    );
    expect(ids.size).toBeGreaterThanOrEqual(3);
  });

  it("los rasgos del producto salen del título", () => {
    expect(detectarRasgos("Pantuflas Térmicas Borrega Frío Invierno")).toContain("frio");
    expect(detectarRasgos("Bota Industrial Casquillo Dieléctrica")).toContain("seguridad");
    expect(detectarRasgos("Sandalias Frescas Verano Playa")).toContain("calor");
    expect(detectarRasgos("Bota Impermeable Lluvia")).toContain("lluvia");
    expect(detectarRasgos("Pantufla Navideña de Reno")).toContain("navidad");
    expect(detectarRasgos("Zapato Casual Negro")).toEqual([]);
  });

  it("unas pantuflas de frío hablan del frío, jamás de la alberca", () => {
    const texto = "Pantuflas Térmicas Borrega Frío Invierno Calientitas";
    const ids = new Set<string>();
    let guiones = "";
    for (let i = 0; i < 300; i++) {
      const c = armarConceptoUGC({ tipo: "pantufla", genero: "mujer", semilla: (i + 0.5) / 300, texto });
      ids.add(c.id);
      guiones += ` ${c.guionSugerido}`;
    }
    // Los conceptos de calor quedan PROHIBIDOS para producto de frío.
    expect(ids.has("dia-de-alberca")).toBe(false);
    expect(ids.has("calor-de-ciudad")).toBe(false);
    // Los conceptos afines al frío sí aparecen.
    expect(ids.has("invierno-en-casa") || ids.has("piso-frio")).toBe(true);
    // Y el material del rasgo domina los guiones: se habla de frío.
    expect(guiones).toMatch(/fr[íi]o|friíto|calientit|invierno|helado|diciembre/i);
    // Sigue habiendo variedad, no un solo concepto en bucle.
    expect(ids.size).toBeGreaterThanOrEqual(5);
  });

  it("unas sandalias de playa jamás cuentan el invierno", () => {
    const texto = "Sandalias Frescas Verano Playa Mujer";
    const ids = new Set<string>();
    for (let i = 0; i < 300; i++) {
      ids.add(
        armarConceptoUGC({ tipo: "sandalia", genero: "mujer", semilla: (i + 0.5) / 300, texto }).id,
      );
    }
    expect(ids.has("invierno-en-casa")).toBe(false);
    expect(ids.has("piso-frio")).toBe(false);
    expect(ids.has("look-de-otono")).toBe(false);
  });

  it("sin texto del producto el motor sigue igual que siempre (determinista)", () => {
    const a = armarConceptoUGC({ tipo: "tenis", genero: "hombre", semilla: 0.42 });
    const b = armarConceptoUGC({ tipo: "tenis", genero: "hombre", semilla: 0.42, texto: "" });
    expect(a).toEqual(b);
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

  it("el UGC desde la foto real arranca del primer cuadro idéntico y sin cortes", () => {
    for (const genero of GENEROS) {
      const p = promptUGCDesdeFoto({
        tipo: "bota",
        genero,
        semilla: 0.3,
        guion: 'Estas botas "aguantan todo"',
      });
      expect(p).toContain("starts EXACTLY on the provided real product photo");
      expect(p).toContain("Mexican Spanish");
      expect(p).toContain("lip sync");
      expect(p).toContain("Estas botas 'aguantan todo'");
      expect(p).toContain("no cuts");
      expect(p).toMatch(/must remain EXACTLY/);
    }
    // Determinista y con variantes de entrada a cuadro.
    const a = promptUGCDesdeFoto({ tipo: "tenis", genero: "hombre", semilla: 0.1, guion: "x" });
    expect(a).toEqual(
      promptUGCDesdeFoto({ tipo: "tenis", genero: "hombre", semilla: 0.1, guion: "x" }),
    );
    const variantes = new Set(
      [0.05, 0.25, 0.45, 0.65, 0.85].map((s) =>
        promptUGCDesdeFoto({ tipo: "tenis", genero: "hombre", semilla: s, guion: "x" }),
      ),
    );
    expect(variantes.size).toBeGreaterThan(1);
  });
});
