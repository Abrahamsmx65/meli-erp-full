/**
 * La fuente principal de fotos del ZIP de contenido son los ATRIBUTOS de la
 * publicación de cada color (lo que el vendedor capturó): estas pruebas
 * protegen el orden de la ficha y que no se invente nada.
 */
import { describe, expect, it } from "vitest";
import { fotosDeAtributos } from "./fotos-publicacion";

const MX = "A1AM78C64UM0Y8";

describe("fotosDeAtributos", () => {
  it("la principal primero y luego las otras en su orden", () => {
    const fotos = fotosDeAtributos(
      {
        other_product_image_locator_2: [{ marketplace_id: MX, media_location: "https://img/2.jpg" }],
        main_product_image_locator: [{ marketplace_id: MX, media_location: "https://img/main.jpg" }],
        other_product_image_locator_1: [{ marketplace_id: MX, media_location: "https://img/1.jpg" }],
      },
      MX,
    );
    expect(fotos).toEqual(["https://img/main.jpg", "https://img/1.jpg", "https://img/2.jpg"]);
  });

  it("sin atributos de foto, vacío: nada se inventa", () => {
    expect(fotosDeAtributos({}, MX)).toEqual([]);
    expect(fotosDeAtributos(undefined, MX)).toEqual([]);
  });

  it("prefiere el locator del marketplace de la cuenta", () => {
    const fotos = fotosDeAtributos(
      {
        main_product_image_locator: [
          { marketplace_id: "OTRO", media_location: "https://img/otro.jpg" },
          { marketplace_id: MX, media_location: "https://img/mx.jpg" },
        ],
      },
      MX,
    );
    expect(fotos).toEqual(["https://img/mx.jpg"]);
  });

  it("un locator sin URL o repetido no cuenta", () => {
    const fotos = fotosDeAtributos(
      {
        main_product_image_locator: [{ marketplace_id: MX, media_location: "https://img/a.jpg" }],
        other_product_image_locator_1: [{ marketplace_id: MX, media_location: " " }],
        other_product_image_locator_2: [{ marketplace_id: MX, media_location: "https://img/a.jpg" }],
      },
      MX,
    );
    expect(fotos).toEqual(["https://img/a.jpg"]);
  });
});
