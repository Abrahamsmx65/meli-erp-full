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

  it("la N o la C de más antes del diseño se amarran solas (decisión del dueño)", () => {
    const r = amarrar("499N-IP15PM", indice);
    expect(r.nivel).toBe("prefijo_nc");
    expect(esAutomatico(r.nivel)).toBe(true);
    expect(r.skuMeli).toBe("499-IP15PM");
    expect(amarrar("499C-IP15PM", indice).skuMeli).toBe("499-IP15PM");
  });

  it("una letra suelta en OTRO lugar solo se propone", () => {
    const r = amarrar("499-IP15PM-X", indice);
    expect(r.nivel).toBe("nucleo");
    expect(esAutomatico(r.nivel)).toBe(false);
    expect(r.skuMeli).toBeNull();
    expect(r.candidatos).toEqual(["499-IP15PM"]);
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

describe("prefijo N o C antes del diseño (caso real del sheet)", () => {
  const catalogo = ["N-367-E14", "367-PocoC40", "462-A06", "C-362-PocoM6pro-blk", "650-i11", "514-Rmn10pro"];
  const indice = construirIndice(catalogo);

  it("bodega con N- y MELI sin ella: se amarra solo", () => {
    const r = amarrar("N-462-A06", indice);
    expect(r.nivel).toBe("prefijo_nc");
    expect(esAutomatico(r.nivel)).toBe(true);
    expect(r.skuMeli).toBe("462-A06");
  });

  it("bodega con C- y MELI sin ella: se amarra solo", () => {
    expect(amarrar("C-367-PocoC40", indice).skuMeli).toBe("367-PocoC40");
    expect(amarrar("c-367-PocoC40", indice).skuMeli).toBe("367-PocoC40");
  });

  it("al revés también: bodega sin la N y MELI con ella", () => {
    expect(amarrar("367-E14", indice).skuMeli).toBe("N-367-E14");
    expect(amarrar("362-PocoM6pro-blk", indice).skuMeli).toBe("C-362-PocoM6pro-blk");
  });

  it("la letra pegada al número (499N-) cuenta igual", () => {
    const idx = construirIndice(["499-IP15PM"]);
    const r = amarrar("499N-IP15PM", idx);
    expect(r.nivel).toBe("prefijo_nc");
    expect(r.skuMeli).toBe("499-IP15PM");
  });

  it("otros prefijos (CH-, R-, S-) solo se proponen", () => {
    const r = amarrar("CH-650-i11", indice);
    expect(r.nivel).toBe("prefijo");
    expect(r.skuMeli).toBeNull();
    expect(r.candidatos).toEqual(["650-i11"]);
    expect(amarrar("R-514-Rmn10pro", indice).skuMeli).toBeNull();
  });

  it("si MELI tiene las dos versiones, es empate y no se decide solo", () => {
    const idx = construirIndice(["N-462-A06", "462-A06"]);
    const r = amarrar("n-462-a06", idx);
    // Canónico empata exacto con N-462-A06: ese sí es seguro.
    expect(r.nivel).toBe("canonico");
    expect(r.skuMeli).toBe("N-462-A06");
    const r2 = amarrar("C-462-A06", idx);
    expect(r2.ambiguo).toBe(true);
    expect(r2.skuMeli).toBeNull();
    expect(r2.candidatos).toHaveLength(2);
  });

  it("una C dentro del modelo (PocoC40) no se toca", () => {
    const idx = construirIndice(["367-Poco40"]);
    expect(amarrar("367-PocoC40", idx).nivel).not.toBe("prefijo_nc");
  });
});
