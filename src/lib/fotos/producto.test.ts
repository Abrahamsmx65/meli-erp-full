import { describe, expect, it } from "vitest";
import { armarMapaFotos, claveColor, fotoDeProducto } from "./producto";

describe("fotos de producto", () => {
  it("el color de la proforma cae en el de Amazon", () => {
    expect(claveColor("GT134", "BLK/BLK/RED (NEGRO)")).toBe(claveColor("gt134", "BLK-RED"));
    expect(claveColor("GT219", "M BROWN")).toBe(claveColor("GT219", "MBROWN"));
  });

  it("gana la foto de la publicación activa y el modelo cae a su color", () => {
    const mapa = armarMapaFotos([
      { modelo: "GT148", color: "BLK", url: "https://x/inactiva.jpg" },
      { modelo: "GT148", color: "BLK", url: "https://x/activa.jpg", activo: true },
      { modelo: "GT148", color: "CREAM", url: "https://x/cream.jpg" },
    ]);
    expect(fotoDeProducto(mapa, "GT148", "BLK")).toBe("https://x/activa.jpg");
    expect(fotoDeProducto(mapa, "GT148", "CREAM")).toBe("https://x/cream.jpg");
    // Color que no existe: la foto del modelo (la activa).
    expect(fotoDeProducto(mapa, "GT148", "TOFFE")).toBe("https://x/activa.jpg");
  });

  it("prueba el color de MELI y usa el respaldo del modelo; nada sin foto", () => {
    const mapa = armarMapaFotos(
      [{ modelo: "GT150", color: "TOFFEE", url: "https://x/toffee.jpg" }, { modelo: "GT1", color: "BLK", url: null }],
      [{ modelo: "MY2304", url: "https://tt/1.jpg" }],
    );
    expect(fotoDeProducto(mapa, "GT150", "TOFFE", "TOFFEE")).toBe("https://x/toffee.jpg");
    expect(fotoDeProducto(mapa, "MY2304", "PURPLE")).toBe("https://tt/1.jpg");
    expect(fotoDeProducto(mapa, "GT1", "BLK")).toBeNull();
    expect(fotoDeProducto(null, "GT1")).toBeNull();
  });
});
