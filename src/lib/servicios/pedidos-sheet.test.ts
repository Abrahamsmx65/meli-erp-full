/**
 * El sheet de pedidos pendientes, contra una exportación REAL de la
 * pestaña INTERNET (fixtures/pedidos-pendientes-sheet.xlsx).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leerHoja } from "../importar/leer-hoja";
import {
  confirmacionDePedidos,
  esNumeroDePedido,
  leerCsv,
  pedidosDeFilas,
  urlCsvSheets,
  URL_SHEET_PEDIDOS_OMISION,
} from "./pedidos-sheet";

describe("urlCsvSheets", () => {
  it("baja la pestaña del gid de la URL como CSV", () => {
    expect(urlCsvSheets(URL_SHEET_PEDIDOS_OMISION)).toBe(
      "https://docs.google.com/spreadsheets/d/18Pr9b6q2hDqZIWkX0uBX4g-ihfdi6tSpx6KKmYby7C8/export?format=csv&gid=0",
    );
    expect(urlCsvSheets("https://docs.google.com/spreadsheets/d/abc_-1/edit#gid=1234")).toContain(
      "gid=1234",
    );
  });

  it("rechaza URLs que no son de Google Sheets", () => {
    expect(() => urlCsvSheets("https://ejemplo.com/x.csv")).toThrow(/Google Sheets/);
  });
});

describe("leerCsv", () => {
  it("respeta comillas, comas adentro y saltos de línea", () => {
    const filas = leerCsv('IN10164,"GT250, GT297 GT298 GT303",7680\r\nIN10131,GT104-1,1920\n');
    expect(filas).toEqual([
      ["IN10164", "GT250, GT297 GT298 GT303", "7680"],
      ["IN10131", "GT104-1", "1920"],
    ]);
  });
});

describe("esNumeroDePedido", () => {
  it("reconoce IN##### y AR#####, y nada más", () => {
    expect(esNumeroDePedido("IN10127")).toBe(true);
    expect(esNumeroDePedido("AR10003")).toBe(true);
    expect(esNumeroDePedido("GT268-GT271")).toBe(false);
    expect(esNumeroDePedido("Jinjiang")).toBe(false);
    expect(esNumeroDePedido("June 24")).toBe(false);
  });
});

describe("pedidosDeFilas con la exportación real", () => {
  const buf = readFileSync(join(process.cwd(), "fixtures", "pedidos-pendientes-sheet.xlsx"));

  it("lee los 33 pedidos IN y deja fuera los dos AR", async () => {
    const filas = await leerHoja(buf, { nombre: "pendientes.xlsx" });
    const { pedidos, ignorados } = pedidosDeFilas(filas);
    expect(ignorados).toEqual(["AR10003", "AR10037"]);
    expect(pedidos).toHaveLength(33);
    expect(pedidos.map((p) => p.pedido)).toContain("IN10079");
    expect(pedidos.map((p) => p.pedido)).not.toContain("AR10003");
  });

  it("le pega a cada pedido su fábrica, modelos, pares y embarque", async () => {
    const filas = await leerHoja(buf, { nombre: "pendientes.xlsx" });
    const { pedidos } = pedidosDeFilas(filas);
    const p = pedidos.find((x) => x.pedido === "IN10151")!;
    expect(p.fabrica).toBe("Jinjiang");
    expect(p.modelos).toBe("GT104");
    expect(p.pares).toBe(18240);
    // En el xlsx la celda es fecha; en el CSV llega como texto ("Sep20").
    expect(p.embarque).toMatch(/^(2026-09-20|Sep ?20)$/);

    const primero = pedidos.find((x) => x.pedido === "IN10127")!;
    expect(primero.fabrica).toBe("Chaozhou / Jieyang");

    const ultimo = pedidos.find((x) => x.pedido === "IN10165")!;
    expect(ultimo.fabrica).toBe("Zhejiang");
  });

  it("no toma los renglones de totales como pedidos ni como fábricas", async () => {
    const filas = await leerHoja(buf, { nombre: "pendientes.xlsx" });
    const { pedidos } = pedidosDeFilas(filas);
    const fabricas = new Set(pedidos.map((p) => p.fabrica));
    expect(fabricas.has("Total")).toBe(false);
    expect(fabricas.has("Qtys")).toBe(false);
  });
});

describe("confirmación de China (el pedido subido al sheet)", () => {
  // La pestaña real del 21-oct-2026: columnas PEDIDO, MODELOS, Qtys, Confirm,
  // CBM, LABEL, PLAN SHIP DATE, BOX LABEL.
  const csv =
    "Chaozhou / Jieyang,,Qtys,Confirm,CBM,LABEL,PLAN SHIP DATE,BOX LABEL\n" +
    "IN10184,GT114,8016,Oct 21,26.85,SENT,,\n" +
    "IN10189,GT128,4560,,9.81,SENT,,\n" +
    ",,,,,,,\n" +
    "Jinjiang,,,,,,,\n" +
    'IN10190,"GT104-3, 104-4, 104-5",5232,Oct 21,9.6,SENT,,\n';

  it("lee la columna Confirm como la fecha de confirmación", () => {
    const { pedidos } = pedidosDeFilas(leerCsv(csv));
    expect(pedidos.find((p) => p.pedido === "IN10184")?.confirmado).toBe("Oct 21");
    expect(pedidos.find((p) => p.pedido === "IN10189")?.confirmado).toBeNull();
    expect(pedidos.find((p) => p.pedido === "IN10190")?.fabrica).toBe("Jinjiang");
  });

  it("marca confirmado lo que está en el sheet y falta lo que no, solo en pedidos sin barco", () => {
    const { pedidos } = pedidosDeFilas(leerCsv(csv));
    const erp = [
      { pedido: "IN10192", estado: "creado", pares: 3000, modelosLista: ["GT142"], creadoEn: "2026-10-21T15:00:00Z" },
      { pedido: "IN10190", estado: "creado", pares: 5232, modelosLista: ["GT104-3", "GT104-4", "GT104-5"], creadoEn: "2026-10-20T15:00:00Z" },
      { pedido: "IN10189", estado: "creado", pares: 4500, modelosLista: ["GT128"], creadoEn: "2026-10-19T15:00:00Z" },
      { pedido: "IN10184", estado: "con_contenedor", pares: 8016, modelosLista: ["GT114"], creadoEn: "2026-10-10T15:00:00Z" },
      { pedido: "IN10100", estado: "recibido", pares: 100, modelosLista: ["GT100"], creadoEn: "2026-05-10T15:00:00Z" },
      // Viejo, sin barco y ya no está en el sheet: China lo quitó de pendientes.
      { pedido: "IN10161", estado: "creado", pares: 4080, modelosLista: ["GT142"], creadoEn: "2026-09-04T15:00:00Z" },
    ];
    const r = confirmacionDePedidos(erp, pedidos, Date.parse("2026-10-22T14:00:00Z"));
    // Los que faltan primero, luego los confirmados, al final los que ya no
    // están en el sheet; los embarcados no se juzgan.
    expect(r.map((c) => `${c.pedido}:${c.estado}`)).toEqual([
      "IN10192:falta",
      "IN10190:confirmado",
      "IN10189:confirmado",
      "IN10161:fuera",
    ]);
    const in10190 = r.find((c) => c.pedido === "IN10190")!;
    expect(in10190.fechaConfirm).toBe("Oct 21");
    expect(in10190.fabrica).toBe("Jinjiang");
    expect(in10190.paresSheet).toBe(5232);
    // En el sheet sin fecha en Confirm: confirmado (ya lo subieron) pero sin fecha,
    // y los pares distintos se conservan para avisar.
    const in10189 = r.find((c) => c.pedido === "IN10189")!;
    expect(in10189.fechaConfirm).toBeNull();
    expect(in10189.paresSheet).toBe(4560);
    expect(in10189.paresErp).toBe(4500);
  });

  it("amarra el número de pedido sin importar mayúsculas ni espacios", () => {
    const { pedidos } = pedidosDeFilas(leerCsv(csv));
    const r = confirmacionDePedidos(
      [{ pedido: "in10190 ", estado: "creado", pares: 1, modelosLista: [], creadoEn: "2026-10-21" }],
      pedidos,
    );
    expect(r[0].estado).toBe("confirmado");
  });

  it("un pedido nuevo (hasta 30 días) fuera del sheet FALTA; uno más viejo está «fuera»", () => {
    const ahora = Date.parse("2026-10-22T14:00:00Z");
    const juzgar = (creadoEn: string) =>
      confirmacionDePedidos([{ pedido: "IN10199", estado: "creado", pares: 1, modelosLista: [], creadoEn }], [], ahora)[0].estado;
    expect(juzgar("2026-10-21T15:00:00Z")).toBe("falta");
    expect(juzgar("2026-09-23T15:00:00Z")).toBe("falta");
    expect(juzgar("2026-09-21T15:00:00Z")).toBe("fuera");
  });
});
