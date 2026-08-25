import { describe, expect, it } from "vitest";
import { construirEntradaDop, PRESETS } from "./presets";

describe("construirEntradaDop", () => {
  it("arma el cuerpo que espera Higgsfield", () => {
    const e = construirEntradaDop({
      prompt: "  Slow orbit around the shoe  ",
      imagenUrl: "https://http2.mlstatic.com/D_1234-F.jpg",
      modelo: "dop-turbo",
    });
    expect(e).toEqual({
      model: "dop-turbo",
      prompt: "Slow orbit around the shoe",
      input_images: [
        { type: "image_url", image_url: "https://http2.mlstatic.com/D_1234-F.jpg" },
      ],
      enhance_prompt: true,
    });
  });

  it("rechaza prompt vacío", () => {
    expect(() =>
      construirEntradaDop({ prompt: "   ", imagenUrl: "https://x.com/a.jpg", modelo: "dop-turbo" }),
    ).toThrow(/prompt/i);
  });

  it("rechaza imágenes que no sean URL pública", () => {
    expect(() =>
      construirEntradaDop({ prompt: "ok", imagenUrl: "ftp://x.com/a.jpg", modelo: "dop-turbo" }),
    ).toThrow(/URL pública/);
    expect(() =>
      construirEntradaDop({ prompt: "ok", imagenUrl: "", modelo: "dop-turbo" }),
    ).toThrow(/URL pública/);
  });

  it("rechaza modelos desconocidos", () => {
    expect(() =>
      construirEntradaDop({ prompt: "ok", imagenUrl: "https://x.com/a.jpg", modelo: "sora" }),
    ).toThrow(/desconocido/i);
  });

  it("todas las recetas producen una entrada válida", () => {
    for (const p of PRESETS) {
      const e = construirEntradaDop({
        prompt: p.prompt,
        imagenUrl: "https://x.com/a.jpg",
        modelo: "dop-lite",
      });
      expect(e.prompt.length).toBeGreaterThan(20);
    }
  });
});
