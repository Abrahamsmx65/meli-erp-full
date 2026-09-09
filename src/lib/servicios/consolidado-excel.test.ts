import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { armarConsolidado, type BloqueCanal } from "./consolidado";
import { compatibilidadGastosEmpresariales } from "./consolidado-cargar";
import { excelDelConsolidado } from "./consolidado-excel";

describe("excelDelConsolidado", () => {
  it("muestra cada gasto empresarial y la utilidad antes y después de descontarlos", async () => {
    const bloque: BloqueCanal = {
      canal: "amazon",
      unidades: 1,
      ordenes: 1,
      ventaBruta: 500,
      neto: 400,
      fuenteNeto: "SKU Economics",
      coberturaNeto: 1,
      descuentos: [],
      devoluciones: 0,
      costoRecuperado: 0,
      costoProducto: 100,
      unidadesConCosto: 1,
      adsPorModelo: 20,
      adsGenerales: 0,
      gastos: [],
      porModelo: [{ modelo: "A1", categoria: "Fundas", unidades: 1, importe: 500, neto: 400, costo: 100, ads: 20 }],
      avisos: [],
      exacto: true,
    };
    const consolidado = armarConsolidado({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      bloques: [bloque],
      gastosEmpresariales: [
        { id: 1, fecha: "2026-08-15", categoria: "Nómina", concepto: "Primera quincena", monto: 50 },
        { id: 2, fecha: "2026-08-20", categoria: "Bodega", concepto: "Renta mensual", monto: 30 },
      ],
    });

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await excelDelConsolidado(consolidado)) as unknown as ArrayBuffer);
    const resumen = libro.getWorksheet("Resumen")!;
    const columnaTotal = consolidado.canales.length + 2;
    const filas = resumen.getRows(1, resumen.rowCount)!.map((fila) => [fila.getCell(1).value, fila.getCell(columnaTotal).value]);

    expect(filas).toContainEqual(["UTILIDAD ANTES DE GASTOS EMPRESARIALES", 280]);
    expect(filas).toContainEqual(["GASTOS EMPRESARIALES", -80]);
    expect(filas).toContainEqual(["UTILIDAD NETA DESPUÉS DE GASTOS EMPRESARIALES", 200]);
    expect(filas).toContainEqual(["2026-08-15 · Nómina · Primera quincena", -50]);
    expect(filas).toContainEqual(["2026-08-20 · Bodega · Renta mensual", -30]);
  });

  it("exporta un corte histórico sin inventar el desglose que todavía no se guardaba", async () => {
    const bloque: BloqueCanal = {
      canal: "amazon",
      unidades: 1,
      ordenes: 1,
      ventaBruta: 100,
      neto: 80,
      fuenteNeto: "Neto histórico",
      coberturaNeto: 1,
      descuentos: [{ concepto: "Deducciones guardadas", monto: 20 }],
      devoluciones: 0,
      costoRecuperado: 0,
      costoProducto: 30,
      unidadesConCosto: 1,
      adsPorModelo: 0,
      adsGenerales: 0,
      gastos: [],
      porModelo: [{ modelo: "A1", categoria: "Fundas", unidades: 1, importe: 100, neto: 80, costo: 30, ads: 0 }],
      avisos: [],
      exacto: true,
    };
    const historico = structuredClone(armarConsolidado({
      periodo: "2026-07",
      desde: "2026-07-01",
      hasta: "2026-07-31",
      bloques: [bloque],
    })) as any;
    delete historico.canales[0].desglosePlataforma;
    delete historico.canales[0].desgloseDisponible;
    for (const campo of ["comision", "envio", "isr", "iva", "otros", "ajusteLiquidacion", "devolucionesIncluidasEnNeto"]) {
      delete historico.total[campo];
    }
    delete historico.total.desgloseDisponible;

    const compatible = compatibilidadGastosEmpresariales(historico);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await excelDelConsolidado(compatible)) as unknown as ArrayBuffer);
    const resumen = libro.getWorksheet("Resumen")!;
    const conceptos = resumen.getColumn(1).values;

    expect(compatible.total.neto).toBe(80);
    expect(compatible.total.descuentosPlataforma).toBe(20);
    expect(compatible.total.desgloseDisponible).toBe(false);
    expect(conceptos).toContain("Desglose no disponible: este corte fue guardado antes de separar comisión, envío e impuestos.");
  });
});