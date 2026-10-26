import { describe, expect, it } from "vitest";
import { categoriaVisible, fotoAmazon, rangoTallas, srcSetAmazon, tituloCorto } from "./catalogo-vista";

describe("tituloCorto", () => {
  it("quita la marca y suaviza lo gritado, conserva las siglas", () => {
    expect(tituloCorto("GETAC CHANCLAS MUJER, SANDALIAS HOMBRE con Plantilla de corcho Suela EVA")).toBe(
      "Chanclas mujer, sandalias hombre con Plantilla de corcho Suela EVA",
    );
    expect(tituloCorto("GETAC Pantuflas de Plataforma para Mujer")).toBe("Pantuflas de Plataforma para Mujer");
    expect(tituloCorto("Botas UGG")).toBe("Botas UGG");
  });
});

describe("rangoTallas", () => {
  it("rango cuando son seguidas", () => {
    expect(rangoTallas(["23", "24", "25", "26", "27", "28"])).toBe("23 a 28");
    expect(rangoTallas(["22", "22.5", "23", "23.5"])).toBe("22 a 23.5");
  });
  it("lista cuando no", () => {
    expect(rangoTallas(["23", "25", "28"])).toBe("23, 25, 28");
    expect(rangoTallas(["CH", "M", "G"])).toBe("CH, M, G");
    expect(rangoTallas(["24", "25"])).toBe("24, 25");
  });
});

describe("categoriaVisible", () => {
  it("junta las que solo cambian de mayúsculas", () => {
    expect(categoriaVisible("Botas lluvia")).toBe(categoriaVisible("BOTAS  LLUVIA"));
    expect(categoriaVisible(" ")).toBeNull();
  });
});

describe("fotoAmazon", () => {
  it("pide el tamaño en el nombre", () => {
    expect(fotoAmazon("https://m.media-amazon.com/images/I/91mhxy2EEaL.jpg", 600)).toBe("https://m.media-amazon.com/images/I/91mhxy2EEaL._AC_SL600_.jpg");
    expect(fotoAmazon("https://m.media-amazon.com/images/I/81+LZ-NOWiL.jpg", 100)).toBe("https://m.media-amazon.com/images/I/81+LZ-NOWiL._AC_SL100_.jpg");
    // ya traía un tamaño: se reemplaza
    expect(fotoAmazon("https://m.media-amazon.com/images/I/91mhxy2EEaL._AC_SX679_.jpg", 400)).toBe("https://m.media-amazon.com/images/I/91mhxy2EEaL._AC_SL400_.jpg");
  });
  it("lo que no es de Amazon no se toca", () => {
    const tiktok = "https://p16-oec-va.ibyteimg.com/tos-maliva-i-o3syd03w52-us/abc~tplv-o3syd03w52-origin-jpeg.jpeg";
    expect(fotoAmazon(tiktok, 400)).toBe(tiktok);
    expect(srcSetAmazon(tiktok)).toBeUndefined();
  });
  it("srcset con anchos", () => {
    expect(srcSetAmazon("https://m.media-amazon.com/images/I/X1.jpg", [400, 700])).toBe(
      "https://m.media-amazon.com/images/I/X1._AC_SL400_.jpg 400w, https://m.media-amazon.com/images/I/X1._AC_SL700_.jpg 700w",
    );
  });
});
