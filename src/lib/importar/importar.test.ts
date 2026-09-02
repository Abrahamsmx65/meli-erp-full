/**
 * Estas pruebas corren contra los archivos REALES de la operación
 * (fixtures/), no contra ejemplos inventados. Si un export cambia de forma,
 * aquí se nota antes de que rompa la planeación.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importarCorridas, importarExistencias, type FilaExistencia } from "./excel";
import { construirCajas } from "./cajas";
import { canonizar, construirSkuMeli, construirIndice, normalizarTalla } from "./sku";

const dir = join(process.cwd(), "fixtures");
const bufCorridas = readFileSync(join(dir, "CORRIDAS_BASE.xlsx"));
const bufExist = readFileSync(join(dir, "ExistenciasGlobales.xlsx"));

describe("normalización de SKU", () => {
  it("canoniza colores escritos de formas distintas", () => {
    expect(canonizar("DK BROWN")).toBe("DK-BROWN");
    expect(canonizar("dk-brown")).toBe("DK-BROWN");
    expect(canonizar("Dk  Brown")).toBe("DK-BROWN");
    expect(canonizar("GREY/BLK")).toBe("GREY-BLK");
  });

  it("construye el SKU de MELI como MODELO-COLOR-TALLA", () => {
    expect(construirSkuMeli("GT107", "CAMEL", 25)).toBe("GT107-CAMEL-25");
    expect(construirSkuMeli("GT104-4", "NAVY", "26")).toBe("GT104-4-NAVY-26");
    expect(construirSkuMeli("GT114", "DK BROWN", 24)).toBe("GT114-DK-BROWN-24");
  });

  it("distingue corrida de talla individual", () => {
    expect(normalizarTalla("Corrida")).toBe("CORRIDA");
    expect(normalizarTalla("corrida")).toBe("CORRIDA");
    expect(normalizarTalla(29)).toBe("29");
  });
});

describe("importación de CORRIDAS BASE (archivo real)", () => {
  it("lee las corridas y detecta las 8 tallas", async () => {
    const r = await importarCorridas(bufCorridas);
    expect(r.tallas).toEqual(["23", "24", "25", "26", "27", "28", "29", "30"]);
    expect(r.corridas.length).toBeGreaterThan(750);
  });

  it("las tallas de cada corrida suman su total", async () => {
    const r = await importarCorridas(bufCorridas);
    for (const c of r.corridas) {
      const suma = Object.values(c.tallas).reduce((a, b) => a + b, 0);
      expect(suma).toBe(c.total);
      expect(suma).toBeGreaterThan(0);
    }
  });

  it("colapsa los duplicados idénticos sin inventar avisos", async () => {
    const r = await importarCorridas(bufCorridas);
    const claves = new Set(r.corridas.map((c) => `${c.pedido}|${c.modelo}|${c.color}`));
    expect(claves.size).toBe(r.corridas.length);
    // 26 duplicados en el archivo, de los cuales 25 son idénticos.
    expect(r.avisos.length).toBeLessThan(5);
  });
});

describe("importación de EXISTENCIAS (archivo real)", () => {
  it("lee los 3 almacenes", async () => {
    const r = await importarExistencias(bufExist);
    expect(r.almacenes.sort()).toEqual(["Caseshop", "EnvioPack", "Industher"]);
    expect(r.filas.length).toBeGreaterThan(450);
  });

  it("respeta cajas disponibles = físicas − apartadas", async () => {
    const r = await importarExistencias(bufExist);
    for (const f of r.filas) {
      expect(f.cajasDisponibles).toBe(f.cajasFisicas - f.cajasApartadas);
    }
  });

  it("separa cajas de corrida de cajas de talla única", async () => {
    const r = await importarExistencias(bufExist);
    const corridas = r.filas.filter((f) => f.talla === "CORRIDA");
    const individuales = r.filas.filter((f) => f.talla !== "CORRIDA");
    expect(corridas.length).toBeGreaterThan(250);
    expect(individuales.length).toBeGreaterThan(150);
  });
});

describe("armado del catálogo de cajas (datos reales)", () => {
  it("cruza corridas con existencias y deja el faltante a la vista", async () => {
    const corr = await importarCorridas(bufCorridas);
    const exist = await importarExistencias(bufExist);
    const r = construirCajas(exist.filas, corr.corridas);

    expect(r.cajas.length).toBeGreaterThan(300);
    expect(r.resumen.cajasTotales).toBeGreaterThan(5000);

    // Los renglones sin corrida se reportan, no se tragan en silencio.
    expect(r.sinCorrida.length).toBeGreaterThan(0);
    expect(r.sinCorrida.length).toBeLessThan(40);
  });

  it("las cajas de corrida tocan varias tallas y las individuales solo una", async () => {
    const corr = await importarCorridas(bufCorridas);
    const exist = await importarExistencias(bufExist);
    const r = construirCajas(exist.filas, corr.corridas);

    const deCorrida = r.cajas.filter((c) => c.esCorrida);
    const individuales = r.cajas.filter((c) => !c.esCorrida);

    expect(deCorrida.length).toBeGreaterThan(0);
    expect(individuales.length).toBeGreaterThan(0);
    for (const c of individuales) expect(c.items).toHaveLength(1);
    // La mayoría de las corridas reparte en 3 o más tallas.
    const multi = deCorrida.filter((c) => c.items.length >= 3);
    expect(multi.length / deCorrida.length).toBeGreaterThan(0.5);
  });

  it("los pares por caja cuadran con el reporte de existencias", async () => {
    const corr = await importarCorridas(bufCorridas);
    const exist = await importarExistencias(bufExist);
    const r = construirCajas(exist.filas, corr.corridas);

    // El aviso solo debe aparecer cuando de verdad no cuadra.
    const descuadres = r.avisos.filter((a) => a.mensaje.includes("pero el reporte dice"));
    expect(descuadres).toEqual([]);
  });

  it("filtra por almacén cuando se le pide", async () => {
    const corr = await importarCorridas(bufCorridas);
    const exist = await importarExistencias(bufExist);
    const todos = construirCajas(exist.filas, corr.corridas);
    const solo = construirCajas(exist.filas, corr.corridas, { almacenes: ["Caseshop"] });

    expect(solo.cajas.length).toBeLessThan(todos.cajas.length);
    for (const c of solo.cajas) expect(c.almacen).toBe("Caseshop");
  });

  it("reporta los SKUs que no existen en el catálogo de MELI", async () => {
    const corr = await importarCorridas(bufCorridas);
    const exist = await importarExistencias(bufExist);

    // Catálogo de MELI que solo conoce un modelo: todo lo demás debe salir
    // listado como pendiente de amarrar, no desaparecer.
    const indice = construirIndice(["GT107-CAMEL-25", "GT107-CAMEL-26"]);
    const r = construirCajas(exist.filas, corr.corridas, { indice });

    expect(r.sinAmarre.length).toBeGreaterThan(50);
    const total = r.sinAmarre.reduce((a, s) => a + s.paresAfectados, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("el mapeo manual amarra lo que la normalización no alcanza", async () => {
    const corr = await importarCorridas(bufCorridas);
    const exist = await importarExistencias(bufExist);

    // GT100-MINT-23 sí existe en los datos reales, pero en MELI está
    // capturado con otro código: justo el caso que el mapeo manual resuelve.
    const indice = construirIndice(["SKU-RARO-DE-MELI"]);
    const mapeoManual = new Map([["GT100-MINT-23", "SKU-RARO-DE-MELI"]]);
    const r = construirCajas(exist.filas, corr.corridas, { indice, mapeoManual });

    const amarrada = r.cajas.find((c) => c.detalle.some((d) => d.origen === "manual"));
    expect(amarrada).toBeDefined();
  });
});

describe("la bodega de TikTok no es bodega de calzado", () => {
  const fila = (almacen: string): FilaExistencia => ({
    almacen,
    codigoAlmacen: "",
    skuCaja: "GT135-DK-23",
    pedido: "IN10001",
    modelo: "GT135",
    color: "DK",
    talla: "23",
    contenedor: "",
    cajasFisicas: 3,
    cajasApartadas: 0,
    enCamino: 0,
    cajasDisponibles: 3,
    paresPorCaja: 12,
    paresDisponibles: 0,
  });

  it("se descarta aunque no se pida filtro de almacén o venga en la lista", () => {
    const filas = [fila("Industher"), fila("TIKTOK"), fila("Tik Tok Shop")];
    for (const opts of [{}, { almacenes: ["Industher", "TIKTOK", "Tik Tok Shop"] }]) {
      const r = construirCajas(filas, [], opts);
      expect(r.cajas.map((c) => c.almacen)).toEqual(["Industher"]);
    }
  });

  it("solo el kardex de TikTok la pide expresamente", () => {
    const r = construirCajas([fila("Industher"), fila("TIKTOK")], [], {
      almacenes: ["TIKTOK"],
      incluirTikTok: true,
    });
    expect(r.cajas.map((c) => c.almacen)).toEqual(["TIKTOK"]);
  });
});

describe("filas incompletas en corridas: nada se supone, todo se avisa", () => {
  async function libroCorridas(filas: (string | number | null)[][]): Promise<Buffer> {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["PEDIDO", "MODELO", "COLOR", 23, 24, 25, "TOTAL"]);
    for (const f of filas) ws.addRow(f);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("una fila sin PEDIDO (vacío o con guion) se salta y se avisa con conteo", async () => {
    const buf = await libroCorridas([
      [null, "GT110", "NAVY", 12, 12, 24, 48],
      ["-", "GT114", "TABACO BROWN", "-", 24, "-", 24],
      ["IN10001", "GT152", "BLK", 8, 8, 8, 24],
    ]);

    const r = await importarCorridas(buf);
    expect(r.corridas).toHaveLength(1);
    expect(r.corridas[0].pedido).toBe("IN10001");
    expect(r.avisos.some((a) => a.mensaje.includes("2 filas sin PEDIDO"))).toBe(true);
  });

  it("las filas sin MODELO o sin pares se saltan pero se avisan", async () => {
    const buf = await libroCorridas([
      ["IN10001", "GT152", "BLK", 8, 8, 8, 24],
      ["IN10002", null, "NAVY", 8, 8, 8, 24],
      ["IN10003", "GT200", "CREAM", "-", "-", "-", null],
    ]);

    const r = await importarCorridas(buf);
    expect(r.corridas).toHaveLength(1);
    expect(r.avisos.some((a) => a.mensaje.includes("sin MODELO"))).toBe(true);
    expect(r.avisos.some((a) => a.mensaje.includes("sin ningún par"))).toBe(true);
  });

  it("una caja SOLO usa la corrida de su pedido exacto; sin ella queda como hueco", async () => {
    const corridas = [
      { pedido: "IN10001", modelo: "GT110", color: "NAVY", tallas: { "25": 24 }, total: 24 },
    ];
    const caja = (pedido: string): any => ({
      almacen: "Industher",
      codigoAlmacen: "",
      skuCaja: `${pedido}-GT110-NAVY`,
      pedido,
      modelo: "GT110",
      color: "NAVY",
      talla: "CORRIDA",
      contenedor: "",
      cajasFisicas: 1,
      cajasApartadas: 0,
      enCamino: 0,
      cajasDisponibles: 1,
      paresPorCaja: 24,
      paresDisponibles: 24,
    });

    const r = construirCajas([caja("RT04"), caja("IN10001")], corridas as any);

    // IN10001 arma su caja con SU corrida; RT04 no tiene y queda reportada
    // como hueco, nunca rellenada con la receta de otro pedido.
    expect(r.cajas.map((c) => c.pedido)).toEqual(["IN10001"]);
    expect(r.sinCorrida).toHaveLength(1);
    expect(r.sinCorrida[0].pedido).toBe("RT04");
  });
});
