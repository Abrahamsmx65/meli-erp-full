import { describe, expect, it } from "vitest";
import { armarRevision, type VarianteEnvio } from "./costos-envio";
import {
  MAX_RENGLONES_FICHA,
  datosEvidencia,
  filasSolicitudMeli,
  huellaEvidencia,
  rutaEvidencia,
  siteDeItem,
  textoCaja,
} from "./evidencia-envio";

/**
 * El GT229 resumido: tres tallas bien medidas por publicación, una mal en
 * cada una de dos publicaciones. Cada color es una publicación con variantes
 * (varias tallas comparten el Item ID), como en Full de verdad.
 */
function variante(
  sku: string,
  itemId: string,
  medida: [number, number, number, number],
  costo: number,
  extra: Partial<VarianteEnvio> = {},
): VarianteEnvio {
  const [alto, ancho, largo, peso] = medida;
  return {
    sku,
    itemId,
    inventoryId: null,
    modelo: "GT229",
    color: sku.split("-")[1],
    talla: sku.split("-")[2],
    medida: { alto, ancho, largo, peso },
    fuente: "MEASUREMENT",
    medidaVendedor: null,
    precio: 499,
    tipoPublicacion: "gold_special",
    envioGratis: true,
    estado: "active",
    costo,
    costoNormal: 88.5,
    pesoFacturable: null,
    ...extra,
  };
}

const GT229: VarianteEnvio[] = [
  variante("GT229-BLK-23", "MLM100", [10, 26, 26, 440], 88.5),
  variante("GT229-BLK-24", "MLM100", [10, 20.8, 26.2, 460], 88.5),
  variante("GT229-BLK-25", "MLM100", [10.3, 23.7, 27.5, 500], 88.5),
  variante("GT229-DK-25", "MLM200", [11.2, 23.8, 27.4, 520], 88.5),
  variante("GT229-DK-26", "MLM200", [36.6, 29.4, 11.2, 530], 139.5), // parada
  variante("GT229-DK-27", "MLM200", [9.6, 25, 29.8, 560], 88.5),
  variante("GT229-TAB-24", "MLM300", [25.2, 25.4, 28.4, 480], 190), // 25 de alto
  variante("GT229-TAB-25", "MLM300", [9.8, 24.2, 28.6, 520], 88.5),
  variante("GT229-TAB-26", "MLM300", [9, 23.6, 27.2, 620], 88.5),
];

describe("el Excel que pide MELI", () => {
  it("un renglón por publicación mal medida, con la medida de las hermanas y el site del Item ID", () => {
    const filas = filasSolicitudMeli(armarRevision(GT229), "MLM");
    // Primero donde hay más dinero: la TAB-24 cobra $190, la DK-26 $139.50.
    expect(filas.map((f) => f.itemId)).toEqual(["MLM300", "MLM200"]);
    for (const f of filas) {
      expect(f.site).toBe("MLM");
      // Largo ≥ ancho ≥ alto: como se lee una caja, no como la guardó MELI.
      expect(f.largo).toBeGreaterThanOrEqual(f.ancho);
      expect(f.ancho).toBeGreaterThanOrEqual(f.alto);
      expect(f.alto).toBeLessThan(12); // la caja acostada, no la parada
      expect(Number.isInteger(f.peso)).toBe(true);
      expect(f.malas).toBe(1);
      expect(f.evidencia).toBe("");
    }
    expect(filas[0].skus).toEqual(["GT229-TAB-24"]);
    expect(filas[0].sobrecosto).toBeCloseTo(101.5);
    expect(filas[1].skus).toEqual(["GT229-DK-26"]);
    expect(filas[1].sobrecosto).toBeCloseTo(51);
  });

  it("dos tallas malas de la misma publicación salen UNA vez", () => {
    const conDos = [...GT229, variante("GT229-DK-28", "MLM200", [30, 28, 12, 600], 139.5)];
    const filas = filasSolicitudMeli(armarRevision(conDos), "MLM");
    const dk = filas.filter((f) => f.itemId === "MLM200");
    expect(dk).toHaveLength(1);
    expect(dk[0].skus).toEqual(["GT229-DK-26", "GT229-DK-28"]);
    expect(dk[0].malas).toBe(2);
  });

  it("pega el link de evidencia del modelo en cada renglón", () => {
    const filas = filasSolicitudMeli(
      armarRevision(GT229),
      "MLM",
      new Map([["GT229", "https://x/evidencia/GT229.png?v=1"]]),
    );
    expect(filas.every((f) => f.evidencia === "https://x/evidencia/GT229.png?v=1")).toBe(true);
  });

  it("sin medida de consenso no hay nada que pedir, y sin Item ID tampoco", () => {
    const pocas = GT229.slice(0, 2).map((v) => ({ ...v, costo: 139.5 }));
    expect(filasSolicitudMeli(armarRevision(pocas), "MLM")).toEqual([]);
    const sinItem = GT229.map((v) => (v.sku === "GT229-DK-26" ? { ...v, itemId: null } : v));
    expect(filasSolicitudMeli(armarRevision(sinItem), "MLM").map((f) => f.itemId)).toEqual(["MLM300"]);
  });

  it("el site sale del prefijo del Item ID y si no, del de la cuenta", () => {
    expect(siteDeItem("MLM1234567", "MLA")).toBe("MLM");
    expect(siteDeItem("mlb99", "MLM")).toBe("MLB");
    expect(siteDeItem("1234", "MLM")).toBe("MLM");
  });
});

describe("la ficha de evidencia", () => {
  it("lleva las malas arriba, las hermanas después, y la foto real", () => {
    const [m] = armarRevision(GT229);
    const d = datosEvidencia(m, "https://http2.mlstatic.com/foto.jpg", new Date(2026, 8, 2))!;
    expect(d.modelo).toBe("GT229");
    expect(d.imagen).toBe("https://http2.mlstatic.com/foto.jpg");
    expect(d.renglones.slice(0, 2).map((r) => r.sku)).toEqual(["GT229-TAB-24", "GT229-DK-26"]);
    expect(d.renglones.slice(0, 2).every((r) => r.mala)).toBe(true);
    expect(d.renglones.slice(2).every((r) => !r.mala)).toBe(true);
    expect(d.renglones).toHaveLength(9);
    expect(d.omitidos).toBe(0);
    expect(d.itemsMalos).toEqual(["MLM300", "MLM200"]);
    expect(d.hermanas).toBe(9);
    expect(d.fecha).toContain("2026");
    // La caja parada se enseña ya acostada: los lados de mayor a menor.
    expect(d.renglones[1].medida).toBe("36.6 × 29.4 × 11.2");
    expect(d.renglones[0].midioMeli).toBe(true);
  });

  it("recorta las hermanas buenas para que quepa, nunca las malas", () => {
    const muchas: VarianteEnvio[] = [];
    for (let i = 0; i < 40; i++) {
      muchas.push(variante(`GT229-BLK-${20 + i}`, "MLM100", [10, 24, 27, 500], 88.5));
    }
    muchas.push(variante("GT229-DK-26", "MLM200", [36.6, 29.4, 11.2, 530], 139.5));
    const d = datosEvidencia(armarRevision(muchas)[0], null)!;
    expect(d.renglones).toHaveLength(MAX_RENGLONES_FICHA);
    expect(d.renglones[0].sku).toBe("GT229-DK-26");
    expect(d.omitidos).toBe(40 - (MAX_RENGLONES_FICHA - 1));
    expect(d.imagen).toBeNull();
  });

  it("sin consenso no hay ficha", () => {
    expect(datosEvidencia(armarRevision(GT229.slice(0, 2))[0], null)).toBeNull();
  });

  it("la huella cambia solo cuando cambia lo dibujado", () => {
    const [m] = armarRevision(GT229);
    const a = huellaEvidencia(datosEvidencia(m, null, new Date(2026, 8, 1))!);
    const b = huellaEvidencia(datosEvidencia(m, null, new Date(2026, 8, 2))!);
    expect(a).toBe(b); // la fecha no cuenta
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    const c = huellaEvidencia(datosEvidencia(m, "https://foto")!);
    expect(c).not.toBe(a);
    const corregida = GT229.map((v) =>
      v.sku === "GT229-DK-26" ? { ...v, medida: { alto: 10, ancho: 24, largo: 27, peso: 530 }, costo: 88.5 } : v,
    );
    expect(huellaEvidencia(datosEvidencia(armarRevision(corregida)[0], null)!)).not.toBe(a);
  });

  it("caja y ruta", () => {
    expect(textoCaja({ alto: 36.6, ancho: 29.4, largo: 11.2, peso: 1 })).toBe("36.6 × 29.4 × 11.2");
    expect(textoCaja(null)).toBe("—");
    expect(rutaEvidencia("abc", "GT229")).toBe("abc/GT229.png");
    expect(rutaEvidencia("abc", "GT 229/X")).toBe("abc/GT_229_X.png");
    expect(rutaEvidencia("abc", "")).toBe("abc/sin-modelo.png");
  });
});
