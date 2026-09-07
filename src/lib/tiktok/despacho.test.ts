import { describe, expect, it } from "vitest";
import { agruparPorModelo, numerarPaquetes, partirSku, renglonesDeEtiqueta, textoDeEtiqueta } from "./despacho";

describe("partirSku", () => {
  it("separa modelo, color y talla, con el color de varias palabras", () => {
    expect(partirSku("GT135-DK BROWN-26")).toEqual({ modelo: "GT135", color: "DK BROWN", talla: "26" });
  });
  it("ignora el sufijo de país", () => {
    expect(partirSku("GT114-BEIGE-23-MX")).toEqual({ modelo: "GT114", color: "BEIGE", talla: "23" });
  });
  it("no truena con un SKU raro", () => {
    expect(partirSku("LOQUESEA")).toEqual({ modelo: "LOQUESEA", color: "", talla: "" });
  });
});

const paq = (orderId: string, sku: string, pares = 1) => ({
  orderId,
  packageId: `pk-${orderId}`,
  destinatario: null,
  pares: [{ sku, pares }],
});

describe("numerarPaquetes", () => {
  it("ordena por modelo, color y talla numérica, y numera desde 1", () => {
    const n = numerarPaquetes([
      paq("a", "GT150-CAMEL-27"),
      paq("b", "GT114-BLK-25-MX"),
      paq("c", "GT114-BEIGE-9"),
      paq("d", "GT114-BEIGE-23"),
    ]);
    expect(n.map((p) => `${p.numero}:${p.pares[0].sku}`)).toEqual([
      "1:GT114-BEIGE-9",
      "2:GT114-BEIGE-23",
      "3:GT114-BLK-25-MX",
      "4:GT150-CAMEL-27",
    ]);
  });

  it("la talla 9 va antes que la 23 (numérica, no alfabética)", () => {
    const n = numerarPaquetes([paq("a", "X-C-23"), paq("b", "X-C-9")]);
    expect(n[0].pares[0].sku).toBe("X-C-9");
  });

  it("dos pedidos iguales quedan en orden estable por id", () => {
    const n = numerarPaquetes([paq("z", "X-C-1"), paq("a", "X-C-1")]);
    expect(n.map((p) => p.orderId)).toEqual(["a", "z"]);
  });
});

describe("textoDeEtiqueta", () => {
  it("lleva el número y el SKU; con dos pares, la cantidad", () => {
    const [p] = numerarPaquetes([
      { orderId: "a", packageId: "pk", destinatario: null, pares: [{ sku: "GT135-DK BROWN-26", pares: 2 }] },
    ]);
    expect(textoDeEtiqueta(p)).toBe("#1 · GT135-DK BROWN-26 ×2");
  });
});

describe("agruparPorModelo", () => {
  it("junta los paquetes consecutivos del mismo modelo y suma pares", () => {
    const g = agruparPorModelo(
      numerarPaquetes([paq("a", "GT114-BEIGE-23"), paq("b", "GT114-BLK-25", 2), paq("c", "GT150-CAMEL-27")]),
    );
    expect(g.map((x) => [x.modelo, x.pares, x.paquetes.length])).toEqual([
      ["GT114", 3, 2],
      ["GT150", 1, 1],
    ]);
  });
});

describe("renglonesDeEtiqueta", () => {
  it("un paquete con dos productos da dos renglones, cada uno con su FNSKU; sin FNSKU va el SKU mismo", () => {
    const [p] = numerarPaquetes([
      {
        orderId: "o", packageId: "pk", destinatario: null,
        pares: [
          { sku: "GT134-NAVY-24-MX", pares: 1, fnsku: "X004KYMZZB" },
          { sku: "GT134-NAVY-RED-24-MX", pares: 2, fnsku: null },
        ],
      },
    ]);
    expect(renglonesDeEtiqueta(p, 5)).toEqual([
      { sku: "GT134-NAVY-24-MX", pares: 1, texto: "#1 · GT134-NAVY-24-MX", codigo: "X004KYMZZB", esHoja: false },
      { sku: "GT134-NAVY-RED-24-MX", pares: 2, texto: "GT134-NAVY-RED-24-MX ×2", codigo: "GT134-NAVY-RED-24-MX", esHoja: true },
    ]);
  });
});
