import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { conSesion } from "@/lib/yapanizcel/api";
import { lineasDeEnvio } from "@/lib/yapanizcel/envios";
import { todo } from "@/lib/yapanizcel/db";

export const dynamic = "force-dynamic";

/** El Excel del envío: SKU, título y unidades, para el almacén. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const { id } = await params;

  const { data: envio } = await ctx.db.from("yz_envios").select("id, folio, creado_en").eq("account_id", ctx.cuenta.id).eq("id", id).maybeSingle();
  if (!envio) return NextResponse.json({ error: "Envío no encontrado." }, { status: 404 });

  const [lineas, skus] = await Promise.all([
    lineasDeEnvio(ctx.db, id),
    todo<{ sku: string; titulo: string | null }>(ctx.db, "yz_skus", "sku, titulo", (q) => q.eq("account_id", ctx.cuenta.id)),
  ]);
  const titulos = new Map(skus.map((s) => [s.sku, s.titulo]));

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Envío a Full");
  hoja.columns = [
    { header: "SKU", key: "sku", width: 28 },
    { header: "Título", key: "titulo", width: 60 },
    { header: "Unidades", key: "unidades", width: 12 },
  ];
  hoja.getRow(1).font = { bold: true };
  for (const l of lineas) hoja.addRow({ sku: l.sku_meli, titulo: titulos.get(l.sku_meli) ?? "", unidades: l.unidades });
  hoja.addRow({});
  hoja.addRow({ sku: "TOTAL", unidades: lineas.reduce((a, l) => a + l.unidades, 0) }).font = { bold: true };

  const buf = await libro.xlsx.writeBuffer();
  const nombre = `envio-full-${envio.folio ?? envio.creado_en.slice(0, 10)}.xlsx`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
    },
  });
}
