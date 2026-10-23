import { describe, expect, it } from "vitest";
import { agruparPorFamilia, partesDeDonde, renglonesParaAceptar } from "./buen-fin-grupos";

const r = (item: string, modelo: string, queriamos: number, precio: number) => ({
  donde: `${item} · ${modelo} · Buen Fin 26`,
  detalle: "no creíble",
  aceptar: { queriamos, precio, actual: null },
});

describe("agruparPorFamilia", () => {
  it("junta las publicaciones del mismo modelo, promoción y precios", () => {
    const g = agruparPorFamilia(
      [r("MLM3", "GT277", 298.99, 289.99), r("MLM1", "GT130", 249.99, 241.99), r("MLM2", "GT277", 298.99, 289.99)],
      (x) => `${x.aceptar.queriamos}|${x.aceptar.precio}`,
    );
    expect(g.map((x) => [x.modelo, x.renglones.length])).toEqual([
      ["GT130", 1],
      ["GT277", 2],
    ]);
  });
  it("un precio distinto abre otra familia", () => {
    const g = agruparPorFamilia([r("MLM1", "GT277", 298.99, 289.99), r("MLM2", "GT277", 298.99, 279.99)], (x) => String(x.aceptar.precio));
    expect(g).toHaveLength(2);
  });
  it("lee modelo y promoción de donde", () => {
    expect(partesDeDonde("MLM1 · GT104-5 · Buen Fin 26")).toEqual({ item: "MLM1", modelo: "GT104-5", promocion: "Buen Fin 26" });
  });
});

describe("renglonesParaAceptar", () => {
  it("se queda solo con lo bien formado y redondea el precio", () => {
    expect(
      renglonesParaAceptar({
        renglones: [
          { itemId: "MLM1", promoId: "P-1", tipo: "DEAL", offerId: null, accion: "cambiar", precio: 241.994, donde: "MLM1 · 499 · Buen Fin 26" },
          { itemId: "nada", precio: 10 },
          { itemId: "MLM2", precio: 0 },
        ],
      }),
    ).toEqual([{ itemId: "MLM1", promoId: "P-1", tipo: "DEAL", offerId: null, accion: "cambiar", precio: 241.99, donde: "MLM1 · 499 · Buen Fin 26" }]);
    expect(renglonesParaAceptar(null)).toEqual([]);
  });
});
