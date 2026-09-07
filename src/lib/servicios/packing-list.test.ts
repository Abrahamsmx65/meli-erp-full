/**
 * Casar el packing list real (IN10079-3, contenedor MIEU3920536) contra
 * una base simulada con el pedido IN10079 cargado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importarPackingList } from "../importar/packing-list";
import { casarPackingList } from "./packing-list";

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
      maybeSingle: async () => ({ data: filas[0] ?? null }),
      then: (res: (v: { data: Fila[] }) => void) => res({ data: filas }),
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
