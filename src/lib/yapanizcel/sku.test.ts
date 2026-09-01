import { describe, expect, it } from "vitest";
import {
  amarrar,
  claveAplastada,
  claveCanonica,
  claveNucleo,
  construirIndice,
  desglosar,
  esAutomatico,
  piezas,
} from "./sku";

describe("piezas", () => {
  it("separa donde la letra se pega al número", () => {
    expect(piezas("499N-IP15PM")).toEqual(["499", "N", "IP", "15", "PM"]);
  });

  it("da lo mismo con guiones, espacios o nada", () => {
    expect(piezas("499 IP15PM")).toEqual(piezas("499-IP-15-PM"));
    expect(piezas("499IP15PM")).toEqual(piezas("499 IP 15 PM"));
  });

  it("quita el sufijo de sitio", () => {
    expect(piezas("499-IP15PM-MX")).toEqual(["499", "IP", "15", "PM"]);
  });

  it("no confunde un sufijo de sitio con el SKU entero", () => {
    expect(piezas("MX")).toEqual(["MX"]);
  });
});

describe("claves", () => {
  it("la canónica ignora mayúsculas, acentos y separadores", () => {
    expect(claveCanonica("  499-ip15pm  ")).toBe("499-IP15PM");
    expect(claveCanonica("499_ip15pm")).toBe("499-IP15PM");
    expect(claveCanonica("499-IP15PM-MX")).toBe("499-IP15PM");
  });

  it("la aplastada ignora dónde caen los guiones", () => {
    expect(claveAplastada("499-IP-15-PM")).toBe(claveAplastada("499IP15PM"));
  });

  it("el núcleo ignora la letra suelta de más", () => {
    expect(claveNucleo("499N-IP15PM")).toBe(claveNucleo("499-IP15PM"));
    expect(claveNucleo("499C-IP15PM")).toBe(claveNucleo("499-IP15PM"));
  });

  it("el núcleo NO borra letras que van pegadas a otras letras", () => {
    // "PM" es una pieza de dos letras: no es una letra suelta.
    expect(claveNucleo("499-IP15PM")).toBe("499IP15PM");
  });
});

describe("amarrar", () => {
  const catalogo = ["499-IP15PM", "501-IP15PM", "499-SGS24U", "610-A54-NEGRO"];
  const indice = construirIndice(catalogo);

  it("amarra idénticos como exacto", () => {
    const r = amarrar("499-IP15PM", indice);
    expect(r.nivel).toBe("exacto");
    expect(r.skuMeli).toBe("499-IP15PM");
  });

  it("amarra solo lo que cambió de mayúsculas o separadores", () => {
    expect(amarrar("499_ip15pm", indice).skuMeli).toBe("499-IP15PM");
    expect(amarrar("499-IP15PM-MX", indice).skuMeli).toBe("499-IP15PM");
  });

  it("amarra solo cuando el guion se movió de lugar", () => {
    const r = amarrar("499-IP-15-PM", indice);
    expect(r.nivel).toBe("aplastado");
    expect(r.skuMeli).toBe("499-IP15PM");
  });

  it("la N de más NO se amarra sola: se propone", () => {
    const r = amarrar("499N-IP15PM", indice);
    expect(r.nivel).toBe("nucleo");
    expect(esAutomatico(r.nivel)).toBe(false);
    expect(r.skuMeli).toBeNull();
    expect(r.candidatos).toEqual(["499-IP15PM"]);
  });

  it("la C de más tampoco", () => {
    expect(amarrar("499C-IP15PM", indice).skuMeli).toBeNull();
    expect(amarrar("499C-IP15PM", indice).candidatos).toEqual(["499-IP15PM"]);
  });

  it("el mapeo manual manda sobre todo", () => {
    const manual = new Map([["499N-IP15PM", "501-IP15PM"]]);
    const r = amarrar("499N-IP15PM", indice, manual);
    expect(r.nivel).toBe("manual");
    expect(r.skuMeli).toBe("501-IP15PM");
  });

  it("las mismas piezas en otro orden se proponen, no se amarran", () => {
    const r = amarrar("IP15PM-499", indice);
    expect(r.nivel).toBe("ordenado");
    expect(r.skuMeli).toBeNull();
    expect(r.candidatos).toEqual(["499-IP15PM"]);
  });

  it("lo que no se parece a nada queda sin amarre", () => {
    const r = amarrar("777-XPERIA1", indice);
    expect(r.nivel).toBe("sin_amarre");
    expect(r.candidatos).toEqual([]);
  });

  it("un empate NUNCA se resuelve solo, ni en un nivel seguro", () => {
    // Dos SKUs de MELI que aplastados dan lo mismo.
    const conEmpate = construirIndice(["499-IP15PM", "499IP-15PM"]);
    const r = amarrar("499 IP 15 PM", conEmpate);
    expect(r.ambiguo).toBe(true);
    expect(r.skuMeli).toBeNull();
    expect(r.candidatos).toHaveLength(2);
  });

  it("un SKU vacío no amarra con nada", () => {
    expect(amarrar("   ", indice).nivel).toBe("sin_amarre");
  });
});

describe("desglosar", () => {
  it("saca el diseño, que es lo que agrupa los pedidos a China", () => {
    expect(desglosar("499-IP15PM").diseno).toBe("499");
    expect(desglosar("610-A54-NEGRO")).toEqual({
      diseno: "610",
      modelo: "A54",
      color: "NEGRO",
    });
  });
});
