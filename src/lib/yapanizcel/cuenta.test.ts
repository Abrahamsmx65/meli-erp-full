import { describe, expect, it } from "vitest";
import { multiplosDeTexto, multiplosPorDiseno, textoDeMultiplos } from "./cuenta";

describe("múltiplos por diseño del pedido a China", () => {
  it("lee «662=20, 714=50» y también con dos puntos o por renglón", () => {
    expect(multiplosDeTexto("662=20, 714=50")).toEqual({ ok: true, valor: { "662": 20, "714": 50 } });
    expect(multiplosDeTexto("662:20\n n-462 = 12")).toEqual({ ok: true, valor: { "662": 20, "N-462": 12 } });
    expect(multiplosDeTexto("")).toEqual({ ok: true, valor: {} });
  });

  it("declara el pedazo que no entiende", () => {
    expect(multiplosDeTexto("662=20, 714")).toEqual({ ok: false, malo: "714" });
    expect(multiplosDeTexto("662=0")).toEqual({ ok: false, malo: "662=0" });
  });

  it("lo guardado en la base se limpia: solo enteros ≥ 1", () => {
    expect(multiplosPorDiseno({ "662": 20, "714": "50", x: 0, y: "nada" })).toEqual({ "662": 20, "714": 50 });
    expect(multiplosPorDiseno(null)).toEqual({});
    expect(multiplosPorDiseno([1, 2])).toEqual({});
  });

  it("se vuelve texto en orden natural", () => {
    expect(textoDeMultiplos({ "714": 50, "662": 20 })).toBe("662=20, 714=50");
  });
});
