import { describe, expect, it } from "vitest";
import { factorNeto, netoTikTok, nivelesDePrecio, nivelesDesdeNormal, parametrosDesde, PARAMETROS_POR_OMISION, precioParaNeto, renglonesDePrecio, filtrarPrecios } from "./precios";

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
  it("normal deja lo de MELI (al peso hacia arriba); live 5 % abajo aunque deje menos; campaña 5 % arriba", () => {
    const n = nivelesDePrecio(300, p) as ReturnType<typeof nivelesDePrecio> & object;
    expect(n.map((x) => x.clave)).toEqual(["live", "normal", "campana"]);
    const exacto = precioParaNeto(300, p) as number;
    expect(n[1].precio).toBe(Math.ceil(exacto));
    expect(n[1].neto).toBeGreaterThanOrEqual(300);
    expect(n[0].precio).toBe(Math.round(n[1].precio * 0.95));
    expect(n[0].neto).toBeLessThan(300);
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
  it("el objetivo es el neto del RELÁMPAGO de MELI, no el promedio; mi precio manda; sin relámpago no hay niveles", () => {
    const r = renglonesDePrecio(
      [
        { modelo: "GT1", categoria: null, paresMeli: 10, netoMeli: 3000, netoRelampago: 128.99, precioRelampagoMeli: 128.99, paresRelampago: 4, costo: 80, precioTikTok: 399 },
        { modelo: "GT2", categoria: "Botas", paresMeli: 0, netoMeli: 0, costo: null, precioTikTok: null },
        { modelo: "GT3", categoria: null, paresMeli: 50, netoMeli: 10000, netoRelampago: 150, miPrecio: 180, costo: null, precioTikTok: null },
      ],
      p,
    );
    expect(r.map((x) => x.modelo)).toEqual(["GT1", "GT2", "GT3"]);
    expect(r[0].netoPorPar).toBe(128.99);
    expect(r[0].origenNivel).toBe("relampago-meli");
    expect(r[0].niveles?.[1].neto).toBeGreaterThanOrEqual(128.99);
    expect(r[0].origenPrecio).toBe("lista");
    expect(r[0].netoTikTokActual).toBeCloseTo(netoTikTok(399, p).neto, 6);
    expect(r[2].origenNivel).toBe("mi-precio");
    expect(r[2].niveles?.map((n) => n.precio)).toEqual([171, 180, 189]);
    expect(r[1].niveles).toBeNull();
    expect(r[1].netoPorPar).toBeNull();
  });

  it("va en orden alfabético natural por modelo, sin importar la venta", () => {
    const vacio = { categoria: null, netoMeli: 0, costo: null, precioTikTok: null };
    const r = renglonesDePrecio(
      [
        { modelo: "GT134", paresMeli: 900, ...vacio },
        { modelo: "GT102", paresMeli: 1, ...vacio },
        { modelo: "MY2304", paresMeli: 50, ...vacio },
        { modelo: "GT104-1", paresMeli: 0, ...vacio },
        { modelo: "GT99", paresMeli: 0, ...vacio },
      ],
      p,
    );
    expect(r.map((x) => x.modelo)).toEqual(["GT99", "GT102", "GT104-1", "GT134", "MY2304"]);
  });
});

describe("filtrarPrecios", () => {
  const filas = [
    { modelo: "GT148", categoria: "Botas y Botines" },
    { modelo: "GT102", categoria: "Tenis" },
    { modelo: "MY2304", categoria: null },
  ];
  it("busca por pedazos en modelo y categoría, sin acentos ni guiones; vacío = todos", () => {
    expect(filtrarPrecios(filas, "")).toHaveLength(3);
    expect(filtrarPrecios(filas, "gt148").map((f) => f.modelo)).toEqual(["GT148"]);
    expect(filtrarPrecios(filas, "botás").map((f) => f.modelo)).toEqual(["GT148"]);
    expect(filtrarPrecios(filas, "gt1 ten").map((f) => f.modelo)).toEqual(["GT102"]);
    expect(filtrarPrecios(filas, "my-2304")).toHaveLength(1);
    expect(filtrarPrecios(filas, "my 2304")).toHaveLength(1);
    expect(filtrarPrecios(filas, "my2304")).toHaveLength(1);
    expect(filtrarPrecios(filas, "zz")).toHaveLength(0);
  });
});

describe("nivelesDesdeNormal", () => {
  it("normal es el precio del dueño al peso; live 5 % abajo; campaña 5 % arriba; cada uno con su neto", () => {
    const n = nivelesDesdeNormal(400, p) as ReturnType<typeof nivelesDesdeNormal> & object;
    expect(n.map((x) => x.precio)).toEqual([380, 400, 420]);
    expect(n[1].neto).toBeCloseTo(netoTikTok(400, p).neto, 6);
    expect(n[0].neto).toBeLessThan(n[1].neto);
    expect(nivelesDesdeNormal(0, p)).toBeNull();
  });
});
