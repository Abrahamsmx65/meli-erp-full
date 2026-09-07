/**
 * Contra el packing list REAL de JIAXING (S259-2026, contenedor MIEU3920536,
 * pedido IN10079 en su tercer embarque).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { contenedorDeTexto, importarPackingList, pedidoBase } from "./packing-list";

const buf = readFileSync(join(process.cwd(), "fixtures", "packing-list-IN10079.xls"));
const nombre = "S2592026_Packing_List_IN10079_MIEU3920536.xls";

describe("piezas sueltas", () => {
  it("quita el sufijo de embarque parcial del pedido", () => {
    expect(pedidoBase("IN10079-3")).toBe("IN10079");
    expect(pedidoBase("in10151")).toBe("IN10151");
    expect(pedidoBase("BK26-0527")).toBe("BK26-0527");
  });

  it("reconoce el número de contenedor ISO", () => {
    expect(contenedorDeTexto("S259-2026 Packing List (Container :MIEU3920536 / Seal :CN8033803 )")).toBe(
      "MIEU3920536",
    );
    expect(contenedorDeTexto("CONTAINER NO. MSKU 1234567")).toBe("MSKU1234567");
    expect(contenedorDeTexto("Packing List")).toBeNull();
  });
});

describe("packing list real (.xls)", () => {
  it("lee contenedor, sello y referencia", async () => {
    const p = await importarPackingList(buf, { nombre });
    expect(p.contenedor).toBe("MIEU3920536");
    expect(p.sello).toBe("CN8033803");
    expect(p.referencia).toBe("S259-2026");
  });

  it("saca un bloque por color con el pedido y el modelo heredados", async () => {
    const p = await importarPackingList(buf, { nombre });
    expect(p.lineas).toHaveLength(14);
    expect(p.pedidos).toEqual(["IN10079"]);
    expect(p.lineas.every((l) => l.pedidoCrudo === "IN10079-3")).toBe(true);
    expect(p.lineas.map((l) => `${l.modelo} ${l.color}`)).toEqual([
      "GT221 M BROWN", "GT221 TAN", "GT221 BLACK",
      "GT219 BLACK", "GT219 M BROWN", "GT219 CREAM",
      "GT218 CREAM", "GT218 M BROWN", "GT218 TAN",
      "GT151 BLACK", "GT151 M BROWN", "GT151 DK BROWN",
      "GT217 TOFFEE", "GT217 TAN",
    ]);
  });

  it("arma la corrida de cada bloque con las filas de talla de abajo", async () => {
    const p = await importarPackingList(buf, { nombre });
    const l = p.lineas[0];
    expect(l.tallas).toEqual({ "23": 4, "24": 7, "25": 7, "26": 4, "27": 2 });
    expect(l.paresPorCaja).toBe(24);
    expect(l.talla).toBeNull();
    expect(l.cajas).toBe(40);
    expect(l.pares).toBe(960);
  });

  it("los totales cuadran con el renglón Total del archivo", async () => {
    const p = await importarPackingList(buf, { nombre });
    expect(p.totales.cajas).toBe(769);
    expect(p.totales.pares).toBe(18456);
    expect(p.avisos).toEqual([]);
    const gt217Tan = p.lineas.find((l) => l.modelo === "GT217" && l.color === "TAN")!;
    expect(gt217Tan.cajas).toBe(19);
    expect(gt217Tan.pares).toBe(456);
  });
});

describe("packing list del propio ERP (SKU | Cajas)", () => {
  async function libro(filas: (string | number)[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Contenedor C-2026-01");
    for (const f of filas) ws.addRow(f);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("lee modelo, color y talla del SKU", async () => {
    const b = await libro([
      ["SKU", "Cajas"],
      ["GT104-1-BLK", 40],
      ["GT104-1-BLK-24", 5],
      ["TOTAL", 45],
    ]);
    const p = await importarPackingList(b, { nombre: "packing-list-c-2026-01.xlsx" });
    expect(p.lineas).toHaveLength(2);
    // El modelo con guion no se puede partir sin adivinar: el amarre real va
    // por el SKU completo, que aquí se conserva.
    expect(p.lineas[0]).toMatchObject({ sku: "GT104-1-BLK", talla: null, cajas: 40 });
    expect(p.lineas[1]).toMatchObject({ sku: "GT104-1-BLK-24", talla: "24", cajas: 5 });
    expect(p.lineas[0].pedido).toBeNull();
  });

  it("toma el pedido si viene en su columna", async () => {
    const b = await libro([
      ["PEDIDO", "SKU", "CAJAS"],
      ["IN10151-2", "GT104-1-BLK", 40],
    ]);
    const p = await importarPackingList(b, { nombre: "x.xlsx" });
    expect(p.lineas[0].pedido).toBe("IN10151");
    expect(p.pedidos).toEqual(["IN10151"]);
  });
});
