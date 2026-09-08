import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarInventario } from "@/lib/servicios/inventario";
import { filtrarBodega } from "@/lib/reporte/filtro";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * El Excel de Bodega: EXACTAMENTE lo que la pantalla muestra, con los mismos
 * filtros — `?q=` (la misma búsqueda por palabras), `?almacen=` y
 * `?conCeros=1` cuando la vista incluye los SKUs sin existencia. Antes solo
 * respetaba el almacén y «Excel de esta vista» mentía.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const almacen = req.nextUrl.searchParams.get("almacen") || "";
  const conCeros = req.nextUrl.searchParams.get("conCeros") === "1";
  const inv = await cargarInventario(supabase, cuenta.id, { sinCrudos: true });

  // LA MISMA función que filtra la pantalla (contrato de reporte/filtro.ts,
  // con prueba de paridad): el archivo trae exactamente lo que se ve.
  const filas = filtrarBodega(inv.renglones, {
    q: req.nextUrl.searchParams.get("q"),
    almacen,
    conCeros,
  });

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(almacen ? `Bodega ${almacen}`.slice(0, 31) : "Bodega");
  hoja.columns = [
    { header: "Modelo", key: "modelo", width: 14 },
    { header: "Color", key: "color", width: 16 },
    { header: "Talla", key: "talla", width: 8 },
    { header: "SKU", key: "sku", width: 26 },
    { header: "Pares en bodega", key: "bodega", width: 15 },
    { header: "Pares desde China", key: "china", width: 16 },
    { header: "Cajas", key: "cajas", width: 8 },
    { header: "Pedidos", key: "pedidos", width: 26 },
    { header: "Almacenes", key: "almacenes", width: 22 },
  ];
  hoja.getRow(1).font = { bold: true };

  for (const r of filas) {
    const pedidos = almacen ? r.pedidos.filter((p) => p.almacen === almacen) : r.pedidos;
    hoja.addRow({
      modelo: r.modelo,
      color: r.color,
      talla: r.talla,
      sku: r.sku,
      bodega: r.enBodega,
      china: r.enCamino,
      cajas: pedidos.reduce((a, p) => a + (p.cajas ?? 0), 0),
      pedidos: [...new Set(pedidos.map((p) => p.pedido))].join(", "),
      almacenes: [...new Set(pedidos.map((p) => p.almacen))].join(", "),
    });
  }

  // Renglón de totales al final, en negritas.
  const total = hoja.addRow({
    modelo: "TOTAL",
    bodega: filas.reduce((a, r) => a + r.enBodega, 0),
    china: filas.reduce((a, r) => a + r.enCamino, 0),
    cajas: filas.reduce(
      (a, r) =>
        a +
        (almacen ? r.pedidos.filter((p) => p.almacen === almacen) : r.pedidos).reduce(
          (s, p) => s + (p.cajas ?? 0),
          0,
        ),
      0,
    ),
  });
  total.font = { bold: true };

  const buffer = await libro.xlsx.writeBuffer();
  const nombre = almacen ? `bodega-${almacen.toLowerCase().replace(/\s+/g, "-")}.xlsx` : "bodega.xlsx";
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
