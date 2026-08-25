import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { obtenerPlan } from "@/lib/servicios/cache";
import { aISO } from "@/lib/engine/fechas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * El Excel SIMPLE del plan de Full: un renglón por SKU con lo esencial para
 * verificar a ojo — qué se vendió, qué hay, qué falta. El Excel grande de
 * cajas sigue en /api/plan/excel; este es la radiografía sin vueltas.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  }

  const { plan } = await obtenerPlan(supabase, cuenta.id);

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Faltantes Full");
  hoja.columns = [
    { header: "SKU", key: "sku", width: 26 },
    { header: "Modelo", key: "modelo", width: 10 },
    { header: "Color", key: "color", width: 14 },
    { header: "Talla", key: "talla", width: 7 },
    { header: "Ventas (90 días)", key: "ventas", width: 13 },
    { header: "Venta diaria", key: "diaria", width: 11 },
    { header: "Stock Full", key: "stock", width: 10 },
    { header: "En camino", key: "camino", width: 10 },
    { header: "Faltante a cubrir", key: "faltante", width: 14 },
    { header: "Cobertura (días)", key: "cobertura", width: 13 },
    { header: "Estado", key: "estado", width: 12 },
  ];

  const lineas = [...plan.lineas].sort((a, b) => b.sugerido - a.sugerido);
  for (const l of lineas) {
    hoja.addRow({
      sku: l.sku,
      modelo: l.modelo,
      color: l.color,
      talla: l.talla,
      ventas: l.unidadesTotales,
      diaria: Number(l.demandaDiaria.toFixed(2)),
      stock: l.disponible,
      camino: l.enTransferencia,
      faltante: l.sugerido,
      cobertura: l.coberturaDias == null ? null : Number(l.coberturaDias.toFixed(1)),
      estado: l.estado,
    });
  }

  const fila = hoja.getRow(1);
  fila.font = { bold: true, color: { argb: "FFFFFFFF" } };
  fila.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2A78D6" },
  } as ExcelJS.Fill;
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };

  const buffer = await libro.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="faltantes-full-${aISO(new Date())}.xlsx"`,
    },
  });
}
