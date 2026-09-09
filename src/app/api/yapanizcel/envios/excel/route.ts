import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { mapaCostosUnificado } from "@/lib/servicios/costos-unificados";
import { obtenerPlanYz } from "@/lib/yapanizcel/envios";
import { desglosar } from "@/lib/yapanizcel/sku";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * El Excel del PLAN de envíos a Full de fundas: los mismos renglones que la
 * pantalla (el plan masticado de yz_cache), ordenados por categoría
 * (Fundas / Tabletas / Micas) y SKU en alfabético natural.
 */
export async function GET() {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  try {
    const [plan, config] = await Promise.all([
      obtenerPlanYz(ctx.db, ctx.cuenta.id),
      mapaCostosUnificado(ctx.db, { yzAccountId: ctx.cuenta.id }),
    ]);

    const lineas = plan.lineas
      .filter((l) => l.vendidas + l.enFull + l.enTransferencia + l.enCamino + l.enBodega + l.falta > 0)
      .map((l) => ({
        ...l,
        titulo: plan.titulos.get(l.sku) ?? "",
        categoria: config.get(desglosar(l.sku).diseno.toUpperCase())?.categoria ?? "Sin categoría",
      }))
      .sort(
        (a, b) =>
          (a.categoria === "Sin categoría" ? 1 : 0) - (b.categoria === "Sin categoría" ? 1 : 0) ||
          a.categoria.localeCompare(b.categoria, "es") ||
          a.sku.localeCompare(b.sku, "es", { numeric: true }),
      );

    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet("Plan de envío a Full");
    hoja.columns = [
      { header: "Categoría", key: "categoria", width: 14 },
      { header: "SKU", key: "sku", width: 26 },
      { header: "Título", key: "titulo", width: 50 },
      { header: `Vendidas (${plan.parametros.diasVenta} d)`, key: "vendidas", width: 13 },
      { header: "Venta/día", key: "ventaDiaria", width: 10 },
      { header: "En Full", key: "enFull", width: 9 },
      { header: "Transf. + camino", key: "transito", width: 15 },
      { header: "Cobertura (días)", key: "cobertura", width: 15 },
      { header: `Objetivo (${plan.parametros.diasObjetivo} d)`, key: "objetivo", width: 13 },
      { header: "Falta", key: "falta", width: 9 },
      { header: "En bodega", key: "enBodega", width: 10 },
      { header: "Mandar", key: "mandar", width: 9 },
      { header: "Nota", key: "motivo", width: 28 },
    ];
    hoja.getRow(1).font = { bold: true };
    hoja.views = [{ state: "frozen", ySplit: 1 }];

    const MOTIVO: Record<string, string> = {
      ok: "",
      sin_faltante: "Full ya cubre el objetivo",
      sin_inventario: "No hay en bodega (o sin amarre)",
      menos_de_una_decena: "Menos de una decena en bodega",
      topado_por_bodega: "Sale lo que alcanza en bodega",
    };
    for (const l of lineas) {
      hoja.addRow({
        categoria: l.categoria,
        sku: l.sku,
        titulo: l.titulo,
        vendidas: l.vendidas,
        ventaDiaria: Math.round(l.ventaDiaria * 10) / 10,
        enFull: l.enFull,
        transito: l.enTransferencia + l.enCamino,
        cobertura: Number.isFinite(l.cobertura) ? Math.round(l.cobertura) : "",
        objetivo: l.objetivo,
        falta: l.falta,
        enBodega: l.enBodega,
        mandar: l.mandar,
        motivo: MOTIVO[l.motivo] ?? l.motivo,
      });
    }
    const total = hoja.addRow({
      sku: "TOTAL",
      vendidas: lineas.reduce((a, l) => a + l.vendidas, 0),
      mandar: lineas.reduce((a, l) => a + l.mandar, 0),
    });
    total.font = { bold: true };

    const buf = await libro.xlsx.writeBuffer();
    const nombre = `plan-envio-full-fundas-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombre}"`,
      },
    });
  } catch (err) {
    return errorJson(err);
  }
}
