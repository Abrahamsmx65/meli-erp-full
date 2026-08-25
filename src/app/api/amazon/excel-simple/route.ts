import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cargarAmazon, cuentaAmazon, normalizarDias, SIN_LIMITE } from "@/lib/servicios/amazon";
import { aplicarEnCamino, enCaminoFba } from "@/lib/servicios/fba-en-camino";
import { esCalzado, OBJETIVO_DIAS_FBA, RIESGO_DIAS_FBA } from "@/lib/servicios/fba";
import { aISO } from "@/lib/engine/fechas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * El Excel SIMPLE de FBA: un renglón por SKU con lo esencial para verificar a
 * ojo — ventas, stock, en camino y faltante a cubrir. La misma matemática
 * que el plan de cajas (objetivo + riesgo del envío), sin cajas de por medio.
 */
export async function GET(request: NextRequest) {
  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta de Amazon conectada." }, { status: 400 });
  }

  const dias = normalizarDias(request.nextUrl.searchParams.get("dias") ?? undefined);
  const [{ renglones: crudos }, enCamino] = await Promise.all([
    cargarAmazon(supabase, dias, "", SIN_LIMITE),
    enCaminoFba(supabase, cuenta.id),
  ]);
  // "En camino" real: los envíos sin movimiento en semanas ya no tapan faltantes.
  const renglones = aplicarEnCamino(crudos, enCamino);

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Faltantes FBA");
  hoja.columns = [
    { header: "SKU (Amazon)", key: "sku", width: 26 },
    { header: `Ventas (${dias} días)`, key: "ventas", width: 13 },
    { header: "Venta diaria", key: "diaria", width: 11 },
    { header: "Stock FBA", key: "stock", width: 10 },
    { header: "En camino", key: "camino", width: 10 },
    { header: "Faltante a cubrir", key: "faltante", width: 14 },
    { header: "Cobertura (días)", key: "cobertura", width: 13 },
  ];

  const filas = renglones
    .filter((r) => esCalzado(r.sku))
    .map((r) => {
      const ventaDiaria = r.unidades / dias;
      const posicion = r.disponible + r.enTransferencia;
      const faltante = Math.ceil(
        Math.max(0, ventaDiaria * (OBJETIVO_DIAS_FBA + RIESGO_DIAS_FBA) - posicion),
      );
      return {
        sku: r.sku,
        ventas: r.unidades,
        diaria: Number(ventaDiaria.toFixed(2)),
        stock: r.disponible,
        camino: r.enTransferencia,
        faltante,
        cobertura: ventaDiaria > 0 ? Number((posicion / ventaDiaria).toFixed(1)) : null,
      };
    })
    .sort((a, b) => b.faltante - a.faltante);

  for (const f of filas) hoja.addRow(f);

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
      "Content-Disposition": `attachment; filename="faltantes-fba-${aISO(new Date())}.xlsx"`,
    },
  });
}
