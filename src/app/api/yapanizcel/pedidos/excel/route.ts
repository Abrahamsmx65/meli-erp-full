import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { DIAS_OBJETIVO_PEDIDO, obtenerCompras, variantesParaExcel } from "@/lib/yapanizcel/compras";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * El Excel de pedidos a China: una fila por SKU con ventas de 30 días, lo
 * que hay en Full (disponible y en transferencia), en camino a Full, en
 * bodega, en camino desde China, la cobertura y cuánto pedir para 120 días.
 * `?diseno=499` limita a un diseño; sin parámetro salen todos.
 */
export async function GET(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const diseno = (req.nextUrl.searchParams.get("diseno") ?? "").trim().toUpperCase();

  try {
    const compras = await obtenerCompras(ctx.db, ctx.cuenta.id);
    const filas = variantesParaExcel(compras).filter((v) => !diseno || v.diseno === diseno);

    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet(diseno ? `Pedido ${diseno}`.slice(0, 31) : "Pedido a China");
    hoja.columns = [
      { header: "Diseño", key: "diseno", width: 9 },
      { header: "SKU", key: "sku", width: 26 },
      { header: "Modelo", key: "modelo", width: 16 },
      { header: "Color", key: "color", width: 12 },
      { header: "Título", key: "titulo", width: 50 },
      { header: "Ventas 30 días", key: "vendidas", width: 14 },
      { header: "Venta/día", key: "ventaDiaria", width: 10 },
      { header: "En Full", key: "enFull", width: 9 },
      { header: "En transferencia", key: "enTransferencia", width: 15 },
      { header: "En camino a Full", key: "enCaminoFull", width: 15 },
      { header: "En bodega", key: "enBodega", width: 10 },
      { header: "En camino desde China", key: "enCaminoChina", width: 20 },
      { header: "Existencia total", key: "total", width: 15 },
      { header: "Cobertura (días)", key: "cobertura", width: 15 },
      { header: `Pedir (${DIAS_OBJETIVO_PEDIDO} días)`, key: "pedir", width: 14 },
      { header: "Costo unitario", key: "costo", width: 13 },
    ];
    hoja.getRow(1).font = { bold: true };
    hoja.views = [{ state: "frozen", ySplit: 1 }];

    for (const v of filas) {
      hoja.addRow({
        diseno: v.diseno,
        sku: v.skuMeli,
        modelo: v.modelo,
        color: v.color,
        titulo: v.titulo ?? "",
        vendidas: v.vendidas30,
        ventaDiaria: Math.round(v.ventaDiaria * 10) / 10,
        enFull: v.enFull,
        enTransferencia: v.enTransferencia,
        enCaminoFull: v.enCaminoFull,
        enBodega: v.enBodega,
        enCaminoChina: v.enCaminoChina,
        total: v.posicionTotal,
        cobertura: Number.isFinite(v.cobertura) ? Math.round(v.cobertura) : "",
        pedir: v.sugerido,
        costo: v.costoUnitario ?? "",
      });
    }
    const total = hoja.addRow({ sku: "TOTAL", vendidas: filas.reduce((a, v) => a + v.vendidas30, 0), pedir: filas.reduce((a, v) => a + v.sugerido, 0) });
    total.font = { bold: true };

    const buf = await libro.xlsx.writeBuffer();
    const nombre = `pedido-china-${diseno || "todos"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
