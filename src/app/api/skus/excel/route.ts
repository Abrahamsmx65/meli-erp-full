import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaActiva as cuentaFundas } from "@/lib/yapanizcel/cuenta";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import {
  CANALES,
  esCanal,
  leerCatalogoAmazon,
  leerCatalogoCalzado,
  leerCatalogoFundas,
} from "@/lib/servicios/catalogo-skus";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Columna = { header: string; key: string; width: number };

function hoja(libro: ExcelJS.Workbook, nombre: string, columnas: Columna[], filas: Record<string, unknown>[]) {
  const h = libro.addWorksheet(nombre);
  h.columns = columnas;
  h.getRow(1).font = { bold: true };
  h.views = [{ state: "frozen", ySplit: 1 }];
  h.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
  for (const f of filas) {
    const fila = h.addRow(f);
    if ("precio" in f && typeof f.precio === "number") fila.getCell("precio").numFmt = '"$"#,##0.00';
  }
  return h;
}

/**
 * El catálogo de un canal en Excel: `?canal=calzado|fundas|amazon`. Cada
 * canal sale por separado, con lo que ese canal sabe de cada SKU (código de
 * Full o ASIN, título, talla o variante, FNSKU).
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const canal = req.nextUrl.searchParams.get("canal");
  if (!esCanal(canal)) {
    return NextResponse.json({ error: "Canal desconocido: calzado, fundas o amazon." }, { status: 400 });
  }

  const libro = new ExcelJS.Workbook();
  libro.creator = "ERP GETAC";

  if (canal === "calzado") {
    const cuenta = await cuentaActiva(supabase);
    if (!cuenta) return NextResponse.json({ error: "Sin cuenta de Mercado Libre conectada." }, { status: 400 });
    const filas = await leerCatalogoCalzado(supabase, cuenta.id);
    hoja(
      libro,
      "MELI calzado",
      [
        { header: "SKU", key: "sku", width: 22 },
        { header: "Modelo", key: "modelo", width: 10 },
        { header: "Color", key: "color", width: 14 },
        { header: "Talla", key: "talla", width: 7 },
        { header: "Título", key: "titulo", width: 60 },
        { header: "Código Full", key: "codigoFull", width: 14 },
        { header: "Item ID", key: "itemId", width: 16 },
        { header: "Variación", key: "variationId", width: 16 },
        { header: "User product", key: "userProductId", width: 16 },
        { header: "Estado", key: "estado", width: 10 },
        { header: "Precio", key: "precio", width: 11 },
        { header: "FNSKU (Amazon)", key: "fnsku", width: 14 },
        { header: "ASIN", key: "asin", width: 13 },
        { header: "SKU Amazon", key: "skuAmazon", width: 22 },
      ],
      filas as unknown as Record<string, unknown>[],
    );
  } else if (canal === "fundas") {
    const cuenta = await cuentaFundas(supabase);
    if (!cuenta) return NextResponse.json({ error: "Sin cuenta de YAPANIZCEL conectada." }, { status: 400 });
    const filas = await leerCatalogoFundas(supabase, cuenta.id);
    hoja(
      libro,
      "MELI fundas",
      [
        { header: "SKU", key: "sku", width: 24 },
        { header: "Diseño", key: "diseno", width: 9 },
        { header: "Modelo (celular)", key: "modelo", width: 16 },
        { header: "Color", key: "color", width: 14 },
        { header: "Título", key: "titulo", width: 60 },
        { header: "Código Full", key: "codigoFull", width: 14 },
        { header: "Item ID", key: "itemId", width: 16 },
        { header: "Variación", key: "variationId", width: 16 },
        { header: "User product", key: "userProductId", width: 16 },
        { header: "Estado", key: "estado", width: 10 },
        { header: "Precio", key: "precio", width: 11 },
      ],
      filas as unknown as Record<string, unknown>[],
    );
  } else {
    const [cuenta, meli] = await Promise.all([cuentaAmazon(supabase), cuentaActiva(supabase)]);
    if (!cuenta) return NextResponse.json({ error: "Sin cuenta de Amazon conectada." }, { status: 400 });
    const filas = await leerCatalogoAmazon(supabase, cuenta.id, meli?.id ?? null);
    hoja(
      libro,
      "Amazon",
      [
        { header: "SKU Amazon", key: "sku", width: 22 },
        { header: "ASIN", key: "asin", width: 13 },
        { header: "FNSKU", key: "fnsku", width: 14 },
        { header: "Modelo", key: "modelo", width: 10 },
        { header: "Color", key: "color", width: 14 },
        { header: "Talla", key: "talla", width: 7 },
        { header: "Título", key: "titulo", width: 60 },
        { header: "Estado", key: "estado", width: 11 },
        { header: "Logística", key: "logistica", width: 12 },
        { header: "Precio", key: "precio", width: 11 },
        { header: "Disponible FBA", key: "disponibleFba", width: 14 },
        { header: "SKU MELI", key: "skuMeli", width: 22 },
      ],
      filas as unknown as Record<string, unknown>[],
    );
  }

  const archivo = CANALES.find((c) => c.canal === canal)!.archivo;
  const buffer = await libro.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${archivo}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
