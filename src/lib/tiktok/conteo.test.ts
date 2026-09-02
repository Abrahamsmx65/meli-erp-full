import { describe, expect, it } from "vitest";
import {
  ajustesDeConteo,
  escanearConteo,
  estadoInicialConteo,
  fijarConteo,
  fraseDeConteo,
  indexarParaConteo,
  modelosDeConteo,
  renglonesDeConteo,
} from "./conteo";

const productos = [
  { sku: "GT135-DK BROWN-26", fnsku: "X001AAA", saldo: 3, apartado: 1 },
  { sku: "GT135-DK BROWN-27", fnsku: "X001BBB", saldo: 2, apartado: 0 },
  { sku: "GT135-DK BROWN-28", fnsku: null, saldo: 0, apartado: 0 },
  { sku: "GT150-CAMEL-25", fnsku: "X001CCC", saldo: 5, apartado: 0 },
];
const indice = indexarParaConteo(productos);

describe("escanear", () => {
  it("suma un par por escaneo, por FNSKU o por SKU tecleado", () => {
    let e = estadoInicialConteo();
    e = escanearConteo(e, "x001aaa", indice);
    e = escanearConteo(e, "X001AAA", indice);
    e = escanearConteo(e, "gt135-dkbrown-27", indice);
    expect(e.contados).toEqual({ "GT135-DK BROWN-26": 2, "GT135-DK BROWN-27": 1 });
    expect(e.ultimo).toBe("GT135-DK BROWN-27");
    expect(e.escaneos).toHaveLength(3);
    expect(e.error).toBeNull();
  });

  it("un código desconocido no cuenta y avisa", () => {
    const e = escanearConteo(estadoInicialConteo(), "ZZZ", indice);
    expect(e.contados).toEqual({});
    expect(e.error).toMatch(/ZZZ/);
  });

  it("se puede fijar a mano (producto sin FNSKU) y queda como manual", () => {
    const e = fijarConteo(estadoInicialConteo(), "GT135-DK BROWN-28", 4);
    expect(e.contados["GT135-DK BROWN-28"]).toBe(4);
    expect(e.escaneos).toEqual(["MANUAL:GT135-DK BROWN-28=4"]);
  });
});

describe("renglones y ajustes", () => {
  it("compara contra el SALDO (lo apartado sigue en la bodega)", () => {
    let e = estadoInicialConteo();
    e = escanearConteo(e, "X001AAA", indice);
    e = escanearConteo(e, "X001AAA", indice);
    e = escanearConteo(e, "X001AAA", indice);
    const r = renglonesDeConteo(e, productos);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ sku: "GT135-DK BROWN-26", saldo: 3, apartado: 1, contado: 3, diferencia: 0 });
    expect(ajustesDeConteo(r, "2026-09-02T15:00:00.000Z")).toEqual([]);
  });

  it("un modelo completo pone en cero lo que no apareció; otros modelos no se tocan", () => {
    const e = escanearConteo(estadoInicialConteo(), "X001AAA", indice);
    const r = renglonesDeConteo(e, productos, "GT135");
    expect(r.map((x) => [x.sku, x.contado, x.supuestoCero])).toEqual([
      ["GT135-DK BROWN-26", 1, false],
      ["GT135-DK BROWN-27", 0, true],
    ]);
    const ajustes = ajustesDeConteo(r, "2026-09-02T15:00:00.000Z");
    expect(ajustes.map((a) => [a.sku, a.cantidad, a.referencia])).toEqual([
      ["GT135-DK BROWN-26", 1, "conteo:2026-09-02T15:00:00.000Z"],
      ["GT135-DK BROWN-27", 0, "conteo:2026-09-02T15:00:00.000Z"],
    ]);
    expect(ajustes[0].nota).toMatch(/-2/);
    expect(ajustes.every((a) => a.tipo === "ajuste")).toBe(true);
  });

  it("modelos disponibles y frase de voz", () => {
    expect(modelosDeConteo(productos)).toEqual(["GT135", "GT150"]);
    expect(fraseDeConteo("GT135-DK BROWN-26", 2)).toBe("G T 135, dk brown, talla 26: van 2");
    expect(fraseDeConteo("GT150-CAMEL-25", 1)).toBe("G T 150, camel, talla 25: va 1");
  });
});
