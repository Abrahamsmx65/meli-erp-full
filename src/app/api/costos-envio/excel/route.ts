import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { leerRevision, type Medida, type ModeloRevisado } from "@/lib/servicios/costos-envio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "27.9 × 23.8 × 10 cm" — como se lee una caja, no como la manda el API. */
function caja(m: Medida | null): string {
  if (!m) return "";
  const n = (x: number) => String(Math.round(x * 10) / 10);
  return `${n(m.largo)} × ${n(m.ancho)} × ${n(m.alto)} cm`;
}

/**
 * El Excel del caso: un renglón por publicación mal medida, con lo que MELI
 * tiene capturado y lo que miden sus hermanas del mismo modelo, más una
 * segunda hoja con el resumen por modelo.
 *
 * `?todo=1` incluye también las publicaciones que están bien, por si se
 * quiere revisar el catálogo entero y no solo lo que hay que reclamar.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const todo = req.nextUrl.searchParams.get("todo") === "1";
  const soloModelo = (req.nextUrl.searchParams.get("modelo") ?? "").trim().toUpperCase();

  let modelos: ModeloRevisado[] = await leerRevision(supabase, cuenta.id);
  if (soloModelo) modelos = modelos.filter((m) => m.modelo === soloModelo);

  const libro = new ExcelJS.Workbook();
  libro.creator = "ERP GETAC";

  // ------------------------------------------------------------------ detalle
  const hoja = libro.addWorksheet(todo ? "Publicaciones" : "Cobros de más");
  hoja.columns = [
    { header: "SKU", key: "sku", width: 26 },
    { header: "Código Full", key: "full", width: 14 },
    { header: "Publicación (MLM)", key: "mlm", width: 17 },
    { header: "Modelo", key: "modelo", width: 10 },
    { header: "Color", key: "color", width: 15 },
    { header: "Talla", key: "talla", width: 7 },
    { header: "Medida en sistema", key: "sistema", width: 22 },
    { header: "Peso en sistema (g)", key: "pesoSistema", width: 17 },
    { header: "Quién la midió", key: "fuente", width: 15 },
    { header: "Medida real (hermanas)", key: "real", width: 22 },
    { header: "Peso real (g)", key: "pesoReal", width: 13 },
    { header: "Quién paga el envío", key: "paga", width: 18 },
    { header: "Costo de envío hoy", key: "costo", width: 17 },
    { header: "Costo que debería", key: "normal", width: 17 },
    { header: "Se cobra de más", key: "sobrecosto", width: 15 },
    { header: "Peso facturable (g)", key: "facturable", width: 17 },
    { header: "Precio", key: "precio", width: 10 },
  ];
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];

  for (const m of modelos) {
    for (const v of todo ? m.variantes : m.malas) {
      const fila = hoja.addRow({
        sku: v.sku,
        full: v.inventoryId ?? "",
        mlm: v.itemId ?? "",
        modelo: v.modelo,
        color: v.color ?? "",
        talla: v.talla ?? "",
        sistema: caja(v.medida),
        pesoSistema: v.medida?.peso ?? null,
        fuente: v.fuente === "MEASUREMENT" ? "Lo midió MELI" : v.fuente === "SELLER" ? "Lo declaré yo" : "",
        real: caja(v.medidaReal),
        paga: v.envioGratis ? "Yo (envío gratis)" : "El comprador",
        pesoReal: v.medidaReal?.peso ?? null,
        costo: v.costo,
        normal: v.costoNormal,
        sobrecosto: v.sobrecosto || null,
        facturable: v.pesoFacturable,
        precio: v.precio,
      });
      for (const k of ["costo", "normal", "sobrecosto", "precio"]) {
        fila.getCell(k).numFmt = '"$"#,##0.00';
      }
      if (v.sobrecosto > 0) fila.getCell("sobrecosto").font = { bold: true };
    }
  }

  // ------------------------------------------------------------------ resumen
  const resumen = libro.addWorksheet("Resumen por modelo");
  resumen.columns = [
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Publicaciones", key: "total", width: 14 },
    { header: "Mal medidas", key: "malas", width: 13 },
    { header: "Medida real (hermanas)", key: "real", width: 22 },
    { header: "Costo normal", key: "normal", width: 14 },
    { header: "Se cobra de más (suma)", key: "sobrecosto", width: 21 },
  ];
  resumen.getRow(1).font = { bold: true };
  resumen.views = [{ state: "frozen", ySplit: 1 }];

  for (const m of modelos) {
    if (!todo && !m.malas.length) continue;
    const fila = resumen.addRow({
      modelo: m.modelo,
      total: m.variantes.length,
      malas: m.malas.length,
      real: caja(m.medidaReal),
      normal: m.costoNormal,
      sobrecosto: m.sobrecosto || null,
    });
    fila.getCell("normal").numFmt = '"$"#,##0.00';
    fila.getCell("sobrecosto").numFmt = '"$"#,##0.00';
  }

  const buffer = await libro.xlsx.writeBuffer();
  const nombre = soloModelo
    ? `costos-envio-${soloModelo.toLowerCase()}.xlsx`
    : todo
      ? "costos-envio-catalogo.xlsx"
      : "costos-envio-cobros-de-mas.xlsx";

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
