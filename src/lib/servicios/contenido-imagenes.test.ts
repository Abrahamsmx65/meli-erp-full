/**
 * A un color sin fotos propias Amazon le contesta las fotos de la FAMILIA —
 * las del color publicado—, y el ZIP las bajaba como si fueran suyas (GT125:
 * WHITE y BLK/BROWN salían llenos de fotos de BROWN). Estas pruebas protegen
 * el filtro: un juego de fotos idéntico tiene UN solo dueño.
 */
import { describe, expect, it } from "vitest";
import { fotosRepetidas } from "./contenido-imagenes";

const color = (nombre: string, activos: number, links: string[]) => ({
  nombre,
  activos,
  links,
});

describe("fotosRepetidas", () => {
  it("el color sin publicar pierde las fotos que son del publicado", () => {
    const r = fotosRepetidas([
      color("BROWN", 5, ["a.jpg", "b.jpg", "c.jpg"]),
      color("WHITE", 0, ["a.jpg", "b.jpg", "c.jpg"]),
      color("BLK/BROWN", 0, ["a.jpg", "b.jpg", "c.jpg"]),
    ]);
    expect(r.get("WHITE")).toBe("BROWN");
    expect(r.get("BLK/BROWN")).toBe("BROWN");
    expect(r.has("BROWN")).toBe(false);
  });

  it("cada color con sus propias fotos se queda en paz", () => {
    const r = fotosRepetidas([
      color("BROWN", 5, ["a.jpg", "b.jpg"]),
      color("BLK", 3, ["x.jpg", "y.jpg"]),
      color("LEOPARD", 2, ["z.jpg"]),
    ]);
    expect(r.size).toBe(0);
  });

  it("el mismo juego en otro orden sigue siendo el mismo juego", () => {
    const r = fotosRepetidas([
      color("BROWN", 5, ["a.jpg", "b.jpg"]),
      color("WHITE", 0, ["b.jpg", "a.jpg"]),
    ]);
    expect(r.get("WHITE")).toBe("BROWN");
  });

  it("un juego parecido pero no idéntico no se toca", () => {
    // Compartir ALGUNAS fotos (una toma de ambiente) es legítimo.
    const r = fotosRepetidas([
      color("BROWN", 5, ["a.jpg", "b.jpg"]),
      color("BLK", 2, ["a.jpg", "propia.jpg"]),
    ]);
    expect(r.size).toBe(0);
  });

  it("un color sin fotos no entra al conteo", () => {
    const r = fotosRepetidas([
      color("BROWN", 5, ["a.jpg"]),
      color("WHITE", 0, []),
    ]);
    expect(r.size).toBe(0);
  });

  it("con todos sin publicar, gana el primero por nombre y el resto se declara", () => {
    const r = fotosRepetidas([
      color("WHITE", 0, ["a.jpg"]),
      color("CREAM", 0, ["a.jpg"]),
    ]);
    expect(r.get("WHITE")).toBe("CREAM");
    expect(r.has("CREAM")).toBe(false);
  });
});
