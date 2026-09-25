import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { leerRevision, type Medida, type ModeloRevisado } from "@/lib/servicios/costos-envio";
import { filasSolicitudMeli } from "@/lib/servicios/evidencia-envio";
import { leerEvidencias } from "@/lib/servicios/evidencia-envio-generar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "$59.60 el 24/9 (pedido $230.25; hermanas $59.60)" */
function cobro(u: { fecha: string; total: number; envio: number; normal: number | null } | undefined): string {
  if (!u) return "";
  const n = (x: number) => `$${x.toFixed(2)}`;
  const [y, m, d] = u.fecha.split("-");
  return `${n(u.envio)} el ${Number(d)}/${Number(m)}/${y.slice(2)} (pedido ${n(u.total)}; ${
    u.normal == null ? "sin hermana a ese precio" : `hermanas ${n(u.normal)}`
  })`;
}

/** "27.9 × 23.8 × 10 cm" — como se lee una caja, no como la manda el API. */
function caja(m: Medida | null): string {
  if (!m) return "";
  const n = (x: number) => String(Math.round(x * 10) / 10);
  return `${n(m.largo)} × ${n(m.ancho)} × ${n(m.alto)} cm`;
}

/**
 * La solicitud de revisión de medidas tal como la pide MELI: una hoja con
 * las columnas obligatorias de su formato (Item ID, Site, Largo, Alto, Ancho,
 * Peso) más el link de evidencia, un renglón por publicación mal medida con
 * la medida CORRECTA (la de sus hermanas). Una segunda hoja dice qué SKUs
 * hay detrás de cada publicación y cuánto cobran de más, para quien arma el
 * caso; MELI solo necesita la primera.
 */
async function excelSolicitudMeli(
  libro: ExcelJS.Workbook,
  modelos: ModeloRevisado[],
  site: string,
  evidencias: Map<string, string>,
) {
  const filas = filasSolicitudMeli(modelos, site, evidencias);

  const hoja = libro.addWorksheet("Solicitud");
  hoja.columns = [
    { header: "Item ID*", key: "itemId", width: 16 },
    { header: "Site*", key: "site", width: 8 },
    { header: "Largo (cm)*", key: "largo", width: 12 },
    { header: "Alto (cm)*", key: "alto", width: 12 },
    { header: "Ancho (cm)*", key: "ancho", width: 12 },
    { header: "Peso (g)*", key: "peso", width: 10 },
    { header: "Link de evidencia", key: "evidencia", width: 70 },
  ];
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  for (const f of filas) {
    const fila = hoja.addRow({
      itemId: f.itemId,
      site: f.site,
      largo: f.largo,
      alto: f.alto,
      ancho: f.ancho,
      peso: f.peso,
      evidencia: f.evidencia,
    });
    if (f.evidencia) {
      fila.getCell("evidencia").value = { text: f.evidencia, hyperlink: f.evidencia };
      fila.getCell("evidencia").font = { color: { argb: "FF1D4ED8" }, underline: true };
    }
  }

  const detalle = libro.addWorksheet("Detalle");
  detalle.columns = [
    { header: "Item ID", key: "itemId", width: 16 },
    { header: "Modelo", key: "modelo", width: 10 },
    { header: "SKUs que cobran de más", key: "skus", width: 60 },
    { header: "Tallas mal medidas", key: "malas", width: 17 },
    { header: "Se cobra de más por venta (suma)", key: "sobrecosto", width: 28 },
    { header: "Medida correcta", key: "correcta", width: 22 },
    { header: "Link de evidencia", key: "evidencia", width: 70 },
  ];
  detalle.getRow(1).font = { bold: true };
  detalle.views = [{ state: "frozen", ySplit: 1 }];
  for (const f of filas) {
    const fila = detalle.addRow({
      itemId: f.itemId,
      modelo: f.modelo,
      skus: f.skus.join(", "),
      malas: f.malas,
      sobrecosto: f.sobrecosto,
      correcta: `${f.largo} × ${f.ancho} × ${f.alto} cm · ${f.peso} g`,
      evidencia: f.evidencia,
    });
    fila.getCell("sobrecosto").numFmt = '"$"#,##0.00';
  }
}

/**
 * El Excel del caso: un renglón por publicación mal medida, con lo que MELI
 * tiene capturado y lo que miden sus hermanas del mismo modelo, más una
 * segunda hoja con el resumen por modelo.
 *
 * `?todo=1` incluye también las publicaciones que están bien, por si se
 * quiere revisar el catálogo entero y no solo lo que hay que reclamar.
 * `?formato=meli` arma en cambio la solicitud en el formato de MELI.
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
  const formatoMeli = req.nextUrl.searchParams.get("formato") === "meli";
  const soloModelo = (req.nextUrl.searchParams.get("modelo") ?? "").trim().toUpperCase();

  let modelos: ModeloRevisado[] = await leerRevision(supabase, cuenta.id);
  if (soloModelo) modelos = modelos.filter((m) => m.modelo === soloModelo);

  const libro = new ExcelJS.Workbook();
  libro.creator = "ERP GETAC";

  if (formatoMeli) {
    await excelSolicitudMeli(libro, modelos, cuenta.site_id, await leerEvidencias(supabase, cuenta.id));
    const buffer = await libro.xlsx.writeBuffer();
    const nombre = soloModelo
      ? `solicitud-medidas-meli-${soloModelo.toLowerCase()}.xlsx`
      : "solicitud-medidas-meli.xlsx";
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    });
  }

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
    { header: "Ventas 60 d", key: "ventas", width: 11 },
    { header: "Envío real (mediana)", key: "realMediana", width: 18 },
    { header: "Último cobro", key: "ultimo", width: 34 },
    { header: "Penúltimo cobro", key: "penultimo", width: 34 },
    { header: "Pagado de más 60 d (real)", key: "pagadoDeMas", width: 22 },
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
        ventas: v.envioReal?.ordenes ?? null,
        realMediana: v.envioReal?.mediana ?? null,
        ultimo: cobro(v.envioReal?.ultimos[0]),
        penultimo: cobro(v.envioReal?.ultimos[1]),
        pagadoDeMas: v.conVentas ? v.pagadoDeMas : null,
      });
      for (const k of ["costo", "normal", "sobrecosto", "precio", "realMediana", "pagadoDeMas"]) {
        fila.getCell(k).numFmt = '"$"#,##0.00';
      }
      if (v.sobrecosto > 0) fila.getCell("sobrecosto").font = { bold: true };
      if (v.pagadoDeMas > 0) fila.getCell("pagadoDeMas").font = { bold: true };
    }
  }

  // ------------------------------------------------------------------ resumen
  const resumen = libro.addWorksheet("Resumen por modelo");
  resumen.columns = [
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Publicaciones", key: "total", width: 14 },
    { header: "Mal medidas", key: "malas", width: 13 },
    { header: "Medida real (hermanas)", key: "real", width: 22 },
    { header: "Costo normal (simulador)", key: "normal", width: 22 },
    { header: "Se cobra de más por venta (simulador)", key: "sobrecosto", width: 30 },
    { header: "Pagado de más 60 d (real)", key: "pagadoDeMas", width: 22 },
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
      pagadoDeMas: m.pagadoDeMas || null,
    });
    fila.getCell("normal").numFmt = '"$"#,##0.00';
    fila.getCell("sobrecosto").numFmt = '"$"#,##0.00';
    fila.getCell("pagadoDeMas").numFmt = '"$"#,##0.00';
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
