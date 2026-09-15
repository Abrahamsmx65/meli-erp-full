/**
 * Casar el packing list real (IN10079-3, contenedor MIEU3920536) contra
 * una base simulada con el pedido IN10079 cargado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importarPackingList } from "../importar/packing-list";
import { aUnaLetra, casarPackingList, colorParecido, problemasDelCasado } from "./packing-list";

const buf = readFileSync(join(process.cwd(), "fixtures", "packing-list-IN10079.xls"));
const CUENTA = "cuenta-1";

interface Fila {
  [k: string]: unknown;
}

/**
 * Base simulada mínima: solo lo que casarPackingList usa (select con eq /
 * neq / in / maybeSingle). Las filas se dan por tabla.
 */
function baseSimulada(tablas: Record<string, Fila[]>) {
  const consulta = (tabla: string) => {
    let filas = [...(tablas[tabla] ?? [])];
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        filas = filas.filter((f) => f[c] === v);
        return q;
      },
      neq: (c: string, v: unknown) => {
        filas = filas.filter((f) => f[c] !== v);
        return q;
      },
      in: (c: string, vs: unknown[]) => {
        filas = filas.filter((f) => vs.includes(f[c]));
        return q;
      },
      // Lo que traerTodo necesita para paginar (orden estable + páginas).
      order: (c: string) => {
        filas = [...filas].sort((a, b) => String(a[c]).localeCompare(String(b[c])));
        return q;
      },
      range: (a: number, b: number) => {
        filas = filas.slice(a, b + 1);
        return q;
      },
      maybeSingle: async () => ({ data: filas[0] ?? null }),
      then: (res: (v: { data: Fila[]; count: number; error: null }) => void) =>
        res({ data: filas, count: filas.length, error: null }),
    };
    return q;
  };
  return { from: consulta } as any;
}

function pedidoIN10079(opts?: { sinGT217?: boolean }) {
  const lineas: Fila[] = [];
  const modelos: [string, string[]][] = [
    ["GT221", ["M BROWN", "TAN", "BLACK"]],
    ["GT219", ["BLACK", "M BROWN", "CREAM"]],
    ["GT218", ["CREAM", "MBROWN", "TAN"]],
    ["GT151", ["BLACK", "M BROWN", "DK BROWN"]],
    ["GT217", ["TOFFEE", "TAN"]],
  ];
  for (const [modelo, colores] of modelos) {
    if (opts?.sinGT217 && modelo === "GT217") continue;
    for (const color of colores) {
      lineas.push({
        id: `${modelo}-${color}`,
        pedido_id: "p1",
        modelo,
        color,
        talla: "",
        cajas: 200,
        pares_por_caja: 24,
      });
    }
  }
  return {
    pedidos: [
      { id: "p1", account_id: CUENTA, pedido: "IN10079", estado: "en_transito", creado_en: "2026-04-01" },
    ],
    pedido_lineas: lineas,
    contenedor_lineas: [] as Fila[],
    contenedores: [] as Fila[],
  };
}

describe("casarPackingList", () => {
  it("amarra los 14 bloques con sus renglones del pedido, color aplastado incluido", async () => {
    const packing = await importarPackingList(buf, { nombre: "x.xls" });
    const db = baseSimulada(pedidoIN10079());
    const c = await casarPackingList(db, CUENTA, packing, null);

    // Nuestro ID es la referencia del embarque; el ISO es el de la naviera.
    expect(c.numero).toBe("S259-2026");
    expect(c.contenedorExistente).toBe(false);
    expect(c.lineas).toHaveLength(14);
    expect(c.lineas.every((l) => l.estado === "ok")).toBe(true);
    expect(c.totales.cajasAsignar).toBe(769);
    // "M Brown" del archivo contra "MBROWN" del pedido.
    const gt218 = c.lineas.find((l) => l.modelo === "GT218" && l.color === "M BROWN")!;
    expect(gt218.pedidoLineaId).toBe("GT218-MBROWN");
    expect(gt218.pedidoErp).toBe("IN10079");
  });

  it("marca sin_pedido cuando el pedido no está cargado", async () => {
    const packing = await importarPackingList(buf, { nombre: "x.xls" });
    const base = pedidoIN10079();
    base.pedidos = [];
    base.pedido_lineas = [];
    const c = await casarPackingList(baseSimulada(base), CUENTA, packing, "C-2026-09");

    expect(c.numero).toBe("C-2026-09");
    expect(c.lineas.every((l) => l.estado === "sin_pedido")).toBe(true);
    expect(c.totales.cajasAsignar).toBe(0);
    expect(c.lineas[0].detalle).toMatch(/IN10079 no está cargado/);
  });

  it("marca sin_renglon el producto que el pedido no tiene, y deja pasar el resto", async () => {
    const packing = await importarPackingList(buf, { nombre: "x.xls" });
    const c = await casarPackingList(baseSimulada(pedidoIN10079({ sinGT217: true })), CUENTA, packing, null);

    const malos = c.lineas.filter((l) => l.estado !== "ok");
    expect(malos.map((l) => `${l.modelo} ${l.color}`)).toEqual(["GT217 TOFFEE", "GT217 TAN"]);
    expect(malos.every((l) => l.estado === "sin_renglon")).toBe(true);
    expect(c.totales.cajasAsignar).toBe(769 - 50 - 19);
  });

  it("recorta a lo que queda libre cuando otro contenedor ya se llevó parte", async () => {
    const packing = await importarPackingList(buf, { nombre: "x.xls" });
    const base = pedidoIN10079();
    base.contenedor_lineas = [
      { pedido_linea_id: "GT221-M BROWN", contenedor_id: "otro", cajas: 180 },
    ];
    const c = await casarPackingList(baseSimulada(base), CUENTA, packing, null);

    const l = c.lineas.find((x) => x.pedidoLineaId === "GT221-M BROWN")!;
    expect(l.estado).toBe("recorte");
    expect(l.cajasAsignar).toBe(20);
    expect(l.enOtros).toBe(180);
  });

  it("subir dos veces al mismo contenedor no cuenta lo suyo como 'en otros'", async () => {
    const packing = await importarPackingList(buf, { nombre: "x.xls" });
    const base = pedidoIN10079();
    base.contenedores = [{ id: "c1", account_id: CUENTA, numero: "S259-2026" }];
    base.contenedor_lineas = [{ pedido_linea_id: "GT221-M BROWN", contenedor_id: "c1", cajas: 40 }];
    const c = await casarPackingList(baseSimulada(base), CUENTA, packing, null);

    expect(c.contenedorExistente).toBe(true);
    const l = c.lineas.find((x) => x.pedidoLineaId === "GT221-M BROWN")!;
    expect(l.estado).toBe("ok");
    expect(l.enEste).toBe(40);
    expect(l.cajasAsignar).toBe(40);
  });
});

/* -------------------------------------------------------------------------- */

/** Un packing list armado a mano, para probar el amarre sin depender del Excel. */
function packingDe(lineas: { modelo: string; color: string; cajas: number }[]): any {
  return {
    referencia: "S260-2026",
    contenedor: "HMMU4106958",
    lineas: lineas.map((l, i) => ({
      pedidoCrudo: "IN10079-4",
      pedido: "IN10079",
      modelo: l.modelo,
      color: l.color.toUpperCase(),
      colorCrudo: l.color,
      talla: null,
      tallas: {},
      paresPorCaja: 24,
      cajas: l.cajas,
      pares: l.cajas * 24,
      fila: i + 7,
    })),
    totales: { cajas: lineas.reduce((a, l) => a + l.cajas, 0), pares: 0 },
    avisos: [],
  };
}

function pedidoConColores(colores: [string, string, number][]) {
  return {
    pedidos: [{ id: "p1", account_id: CUENTA, pedido: "IN10079", estado: "en_transito", creado_en: "2026-04-01" }],
    pedido_lineas: colores.map(([modelo, color, cajas]) => ({
      id: `${modelo}-${color}`,
      pedido_id: "p1",
      modelo,
      color,
      talla: "",
      cajas,
      pares_por_caja: 24,
    })),
    contenedor_lineas: [] as Fila[],
    contenedores: [] as Fila[],
  };
}

describe("el color con dedazo de la fábrica", () => {
  it('"Toffe" se amarra con TOFFEE del pedido y lo declara (S260-2026: 103 cajas de GT150)', async () => {
    const db = baseSimulada(pedidoConColores([["GT150", "TOFFEE", 120], ["GT150", "M BROWN", 240]]));
    const c = await casarPackingList(db, CUENTA, packingDe([{ modelo: "GT150", color: "Toffe", cajas: 103 }]), null);

    const l = c.lineas[0];
    expect(l.pedidoLineaId).toBe("GT150-TOFFEE");
    expect(l.cajasAsignar).toBe(103);
    expect(l.estado).toBe("ok");
    expect(c.avisos.join(" ")).toContain("una letra de diferencia");
  });

  it("un color que de verdad es otro NO se adivina: M BROWN no es LT BROWN ni DK BROWN", async () => {
    const db = baseSimulada(pedidoConColores([["GT214", "LT BROWN", 40], ["GT214", "DK BROWN", 40], ["GT214", "CREAM", 40]]));
    const c = await casarPackingList(db, CUENTA, packingDe([{ modelo: "GT214", color: "M Brown", cajas: 40 }]), null);

    const l = c.lineas[0];
    expect(l.pedidoLineaId).toBeNull();
    expect(l.cajasAsignar).toBe(0);
    expect(problemasDelCasado(c)).toEqual([
      "GT214 M BROWN: 40 de 40 cajas no entraron. El pedido IN10079 no tiene el renglón GT214 M BROWN.",
    ]);
  });

  it("con dos colores igual de parecidos no se resuelve solo", () => {
    expect(colorParecido("TOFFE", [{ color: "TOFFEE" }, { color: "TOFFEX" }])).toBeNull();
    expect(colorParecido("TOFFE", [{ color: "TOFFEE" }])).toEqual({ color: "TOFFEE" });
  });

  it("una letra de más, de menos o cambiada; dos no", () => {
    expect(aUnaLetra("TOFFE", "TOFFEE")).toBe(true);
    expect(aUnaLetra("MBROWN", "MBROWNN")).toBe(true);
    expect(aUnaLetra("BLACK", "BLACR")).toBe(true);
    expect(aUnaLetra("MBROWN", "LTBROWN")).toBe(false);
    expect(aUnaLetra("MBROWN", "DKBROWN")).toBe(false);
    expect(aUnaLetra("TAN", "BLACK")).toBe(false);
  });

  it("el recorte por cajas ya embarcadas se declara con nombre y números", async () => {
    const base = pedidoConColores([["GT217", "TAN", 50]]);
    base.contenedores = [{ id: "c9", account_id: CUENTA, numero: "S259" }];
    base.contenedor_lineas = [{ pedido_linea_id: "GT217-TAN", contenedor_id: "c9", cajas: 19 }];
    const c = await casarPackingList(baseSimulada(base), CUENTA, packingDe([{ modelo: "GT217", color: "Tan", cajas: 31 }]), null);

    expect(c.lineas[0].cajasAsignar).toBe(31);
    expect(problemasDelCasado(c)).toEqual([]);
  });
});
