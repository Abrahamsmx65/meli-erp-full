/**
 * El amarre de los packing lists de septiembre-octubre 2026 (11-oct-2026):
 * colores con la anotación en español, BLACK contra BLK, cajas de una sola
 * talla en el pedido y dedazos cuando el archivo no trae pedido.
 */
import { describe, expect, it } from "vitest";
import type { LineaPacking, PackingList } from "../importar/packing-list";
import { casarPackingList, claveColorLaxa, repartoExactoPorTalla } from "./packing-list";

const CUENTA = "cuenta-1";
type Fila = Record<string, unknown>;

function baseSimulada(tablas: Record<string, Fila[]>) {
  const consulta = (tabla: string) => {
    let filas = [...(tablas[tabla] ?? [])];
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => ((filas = filas.filter((f) => f[c] === v)), q),
      neq: (c: string, v: unknown) => ((filas = filas.filter((f) => f[c] !== v)), q),
      in: (c: string, vs: unknown[]) => ((filas = filas.filter((f) => vs.includes(f[c]))), q),
      order: (c: string) => ((filas = [...filas].sort((a, b) => String(a[c]).localeCompare(String(b[c])))), q),
      range: (a: number, b: number) => ((filas = filas.slice(a, b + 1)), q),
      maybeSingle: async () => ({ data: filas[0] ?? null }),
      then: (res: (v: { data: Fila[]; count: number; error: null }) => void) => res({ data: filas, count: filas.length, error: null }),
    };
    return q;
  };
  return { from: consulta } as any;
}

function linea(p: Partial<LineaPacking>): LineaPacking {
  return {
    pedidoCrudo: p.pedido ?? null,
    pedido: null,
    modelo: "",
    color: "",
    colorCrudo: p.color ?? "",
    talla: null,
    tallas: {},
    paresPorCaja: 48,
    cajas: 0,
    pares: 0,
    medidas: null,
    pesoKg: null,
    fila: 1,
    ...p,
  };
}

function packing(lineas: LineaPacking[]): PackingList {
  return {
    contenedor: "KKFU7878526",
    sello: null,
    referencia: "S269-2026",
    lineas,
    totales: { cajas: lineas.reduce((a, l) => a + l.cajas, 0), pares: 0 },
    pedidos: [],
    avisos: [],
  };
}

function base(lineas: Fila[]) {
  const pedidos = [...new Set(lineas.map((l) => l.pedido as string))].map((p, i) => ({
    id: p,
    account_id: CUENTA,
    pedido: p,
    estado: "creado",
    creado_en: `2026-0${i + 1}-01`,
  }));
  return baseSimulada({
    pedidos,
    pedido_lineas: lineas.map((l) => ({ pares_por_caja: 48, talla: "", ...l, pedido_id: l.pedido })),
    contenedor_lineas: [],
    contenedores: [],
  });
}

describe("claveColorLaxa", () => {
  it("quita la anotación, BLACK = BLK, sin punto y sin repetidos", () => {
    expect(claveColorLaxa("BLK (NEGRO)")).toBe(claveColorLaxa("BLK"));
    expect(claveColorLaxa("BLACK")).toBe(claveColorLaxa("BLK (NEGRO)"));
    expect(claveColorLaxa("DK.BROWN (MARRON OSCURO)")).toBe(claveColorLaxa("DK BROWN"));
    expect(claveColorLaxa("NAVY (AZUL MARINO)")).toBe(claveColorLaxa("NAVY"));
    expect(claveColorLaxa("BLK/BLK/RED")).toBe(claveColorLaxa("BLK-RED"));
    // Otro color sigue siendo otro.
    expect(claveColorLaxa("M BROWN")).not.toBe(claveColorLaxa("LT BROWN"));
  });
});

describe("repartoExactoPorTalla", () => {
  const r = [
    { id: "a", talla: "23", libre: 8 },
    { id: "b", talla: "24", libre: 18 },
  ];
  it("solo si las cajas son justo lo que les falta", () => {
    expect(repartoExactoPorTalla(26, r, (x) => x.libre)?.map((x) => x.cajas)).toEqual([8, 18]);
    expect(repartoExactoPorTalla(25, r, (x) => x.libre)).toBeNull();
  });
});

describe("casarPackingList con el color laxo", () => {
  it("con pedido: «CAMEL (CAMEL)» y «BLK/GREY (GRIS)» amarran con CAMEL y BLK/GREY (S269, IN10160)", async () => {
    const db = base([
      { id: "camel", pedido: "IN10160", modelo: "GT161", color: "CAMEL", cajas: 20 },
      { id: "gris", pedido: "IN10160", modelo: "GT161", color: "BLK/GREY", cajas: 30 },
    ]);
    const c = await casarPackingList(
      db,
      CUENTA,
      packing([
        linea({ pedido: "IN10160", modelo: "GT161", color: "CAMEL (CAMEL)", cajas: 20 }),
        linea({ pedido: "IN10160", modelo: "GT161", color: "BLK/GREY (GRIS)", cajas: 30 }),
      ]),
      null,
    );
    expect(c.lineas.map((l) => [l.pedidoLineaId, l.cajasAsignar])).toEqual([
      ["camel", 20],
      ["gris", 30],
    ]);
  });

  it("con pedido: BLACK del archivo contra «BLK (NEGRO)» del pedido (S267, IN10140 GT074)", async () => {
    const db = base([{ id: "negro", pedido: "IN10140", modelo: "GT074", color: "BLK (NEGRO)", cajas: 50 }]);
    const c = await casarPackingList(db, CUENTA, packing([linea({ pedido: "IN10140", modelo: "GT074", color: "BLACK", cajas: 50 })]), null);
    expect(c.lineas[0].pedidoLineaId).toBe("negro");
    expect(c.lineas[0].cajasAsignar).toBe(50);
  });

  it("sin pedido en el archivo: «BLK (NEGRO)» encuentra el BLK de un pedido vivo (S270, GT260)", async () => {
    const db = base([{ id: "blk", pedido: "IN10118", modelo: "GT260", color: "BLK", cajas: 60 }]);
    const c = await casarPackingList(db, CUENTA, packing([linea({ modelo: "GT260", color: "BLK (NEGRO)", cajas: 60 })]), null);
    expect(c.lineas[0].pedidoLineaId).toBe("blk");
    expect(c.totales.cajasAsignar).toBe(60);
  });

  it("sin pedido: un dedazo a una letra (COGNAC contra el CONGNAC del pedido) se rescata y se declara", async () => {
    const db = base([{ id: "cog", pedido: "IN10118", modelo: "GT264", color: "CONGNAC", cajas: 60 }]);
    const c = await casarPackingList(db, CUENTA, packing([linea({ modelo: "GT264", color: "COGNAC", cajas: 60 })]), null);
    expect(c.lineas[0].pedidoLineaId).toBe("cog");
    expect(c.avisos.some((a) => a.includes("una letra"))).toBe(true);
  });
});

describe("caja de corrida contra un pedido por talla", () => {
  const tallas = [
    ["23", 8],
    ["24", 18],
    ["25", 15],
    ["27", 8],
    ["28", 20],
    ["29", 23],
  ] as const;
  const pedido = () =>
    base(tallas.map(([t, n]) => ({ id: `t${t}`, pedido: "IN10159", modelo: "GT134", color: "BLK", talla: t, cajas: n })));

  it("las 92 cajas son justo lo que le falta al IN10159 en sus seis tallas: se reparten (S269-2026)", async () => {
    const c = await casarPackingList(
      pedido(),
      CUENTA,
      packing([
        linea({ pedido: "IN10159", modelo: "GT134", color: "BLK (NEGRO)", cajas: 41 }),
        linea({ pedido: "IN10159", modelo: "GT134", color: "BLK (NEGRO)", cajas: 51 }),
      ]),
      null,
    );
    expect(c.totales.cajasAsignar).toBe(92);
    expect(c.lineas.map((l) => [l.talla, l.cajasAsignar])).toEqual(tallas.map(([t, n]) => [t, n]));
  });

  it("si no cuadra exacto NO se adivina el reparto: queda pendiente con el porqué", async () => {
    const c = await casarPackingList(pedido(), CUENTA, packing([linea({ pedido: "IN10159", modelo: "GT134", color: "BLK", cajas: 44 })]), null);
    expect(c.totales.cajasAsignar).toBe(0);
    expect(c.lineas[0].detalle).toMatch(/por talla .* sin decir de qué talla/);
  });

  it("igual sin pedido en el archivo, buscando entre los pedidos vivos", async () => {
    const c = await casarPackingList(pedido(), CUENTA, packing([linea({ modelo: "GT134", color: "BLK (NEGRO)", cajas: 92 })]), null);
    expect(c.totales.cajasAsignar).toBe(92);
  });
});
