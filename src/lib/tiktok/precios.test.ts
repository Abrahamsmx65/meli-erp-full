import { describe, expect, it } from "vitest";
import { factorNeto, netoTikTok, nivelesDePrecio, parametrosDesde, PARAMETROS_POR_OMISION, precioParaNeto, renglonesDePrecio } from "./precios";

const p = PARAMETROS_POR_OMISION;

describe("netoTikTok", () => {
  it("descuenta comisión 6 %, cargo por par, afiliado 4 %, envío 8 %, retenciones sobre la base sin IVA y $2 de empaque", () => {
    const d = netoTikTok(500, p);
    expect(d.comision).toBeCloseTo(30, 6);
    expect(d.cargo).toBe(6);
    expect(d.afiliado).toBeCloseTo(20, 6);
    expect(d.envio).toBeCloseTo(40, 6);
    expect(d.ivaRetenido).toBeCloseTo((500 / 1.16) * 0.08, 6);
    expect(d.isrRetenido).toBeCloseTo((500 / 1.16) * 0.025, 6);
    expect(d.empaque).toBe(2);
    expect(d.neto).toBeCloseTo(500 - 30 - 6 - 20 - 40 - (500 / 1.16) * 0.105 - 2, 6);
  });
});

describe("precioParaNeto", () => {
  it("es la inversa exacta de netoTikTok", () => {
    const precio = precioParaNeto(300, p) as number;
    expect(netoTikTok(precio, p).neto).toBeCloseTo(300, 6);
  });
  it("null si la fórmula no deja nada (comisiones de 100 %)", () => {
    expect(precioParaNeto(300, { ...p, comisionPct: 100 })).toBeNull();
    expect(factorNeto(p)).toBeGreaterThan(0.7);
  });
});

describe("nivelesDePrecio", () => {
  it("live al peso hacia arriba y cada nivel 5 % sobre el anterior, con su neto", () => {
    const n = nivelesDePrecio(300, p) as ReturnType<typeof nivelesDePrecio> & object;
    expect(n.map((x) => x.clave)).toEqual(["live", "normal", "campana"]);
    const exacto = precioParaNeto(300, p) as number;
    expect(n[0].precio).toBe(Math.ceil(exacto));
    expect(n[0].neto).toBeGreaterThanOrEqual(300);
    expect(n[1].precio).toBe(Math.ceil(n[0].precio * 1.05));
    expect(n[2].precio).toBe(Math.ceil(n[1].precio * 1.05));
    expect(n[2].neto).toBeGreaterThan(n[1].neto);
  });
  it("sin objetivo alcanzable, null", () => {
    expect(nivelesDePrecio(300, { ...p, afiliadoPct: 100 })).toBeNull();
  });
});

describe("parametrosDesde", () => {
  it("toma lo que viene y deja lo demás por omisión; lo inválido no entra", () => {
    const q = parametrosDesde({ afiliadoPct: "6", envioPct: "abc", escalonPct: ["7"], comisionPct: "-1", empaquePorPar: "3" });
    expect(q.afiliadoPct).toBe(6);
    expect(q.envioPct).toBe(8);
    expect(q.escalonPct).toBe(7);
    expect(q.comisionPct).toBe(6);
    expect(q.empaquePorPar).toBe(3);
  });
});

describe("renglonesDePrecio", () => {
  it("neto por par de MELI = objetivo; sin pares no hay niveles; ordena por pares", () => {
    const r = renglonesDePrecio(
      [
        { modelo: "GT1", categoria: null, paresMeli: 10, netoMeli: 3000, costo: 150, precioTikTok: 399 },
        { modelo: "GT2", categoria: "Botas", paresMeli: 0, netoMeli: 0, costo: null, precioTikTok: null },
        { modelo: "GT3", categoria: null, paresMeli: 50, netoMeli: 10000, costo: null, precioTikTok: null },
      ],
      p,
    );
    expect(r.map((x) => x.modelo)).toEqual(["GT3", "GT1", "GT2"]);
    expect(r[1].netoPorPar).toBe(300);
    expect(r[1].niveles?.[0].neto).toBeGreaterThanOrEqual(300);
    expect(r[1].netoTikTokActual).toBeCloseTo(netoTikTok(399, p).neto, 6);
    expect(r[2].niveles).toBeNull();
    expect(r[2].netoPorPar).toBeNull();
  });
});
