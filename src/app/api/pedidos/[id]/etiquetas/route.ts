import ExcelJS from "exceljs";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import {
  buscarAmazon,
  buscarVariante,
  indexarCatalogo,
  mapaAmazon,
  sinAnotacion,
} from "@/lib/etiquetas/resolver";
import { varianteMeli } from "@/lib/etiquetas/zpl";
import { generarPdf2Etiquetas, generarPdfCarton } from "@/lib/etiquetas/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Sin espacios y en mayúsculas: "blk/brown " → "BLK/BROWN". */
function pegado(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}


/** Para nombre de archivo: la diagonal no puede ir, se vuelve " - ". */
function nombreArchivo(s: string): string {
  return s.replace(/\//g, " - ").replace(/[\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}

/** Tallas en orden natural: 21, 21.5, 22 … y lo no numérico al final. */
function ordenarTallas(tallas: string[]): string[] {
  return [...tallas].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    if (Number.isFinite(na)) return -1;
    if (Number.isFinite(nb)) return 1;
    return a.localeCompare(b);
  });
}

/**
 * El paquete de etiquetas de un pedido, calcado de cómo ya se comparte con
 * la fábrica en China (ejemplo real: IN10128_GT125.zip). Por cada modelo va
 * una carpeta "PEDIDO (MODELO)" con:
 *
 *   - "MODELO COLOR TALLA MX, 2 LABEL.pdf" por variante: página 1 la
 *     etiqueta de Amazon (FNSKU) y página 2 la de MELI (código Full),
 *     las dos de 2 × 1 pulgadas.
 *   - "MODELO.xlsx" con SKU | LABEL MELI | LABEL AMAZON.
 *   - "PEDIDO - BOX LABEL.pdf": una página de 10 × 5 cm por color, con el
 *     código de barras y el texto PEDIDO-MODELO-COLOR, para el cartón.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id, pedido")
    .eq("id", id)
    .eq("account_id", cuenta.id)
    .maybeSingle();
  if (!pedido) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });

  const { data: lineas } = await supabase
    .from("pedido_lineas")
    .select("modelo, color, tallas")
    .eq("pedido_id", id)
    .order("modelo", { ascending: true })
    .order("color", { ascending: true });
  if (!lineas?.length) {
    return NextResponse.json({ error: "El pedido no tiene renglones." }, { status: 400 });
  }

  // El catálogo completo de MELI y los datos de Amazon, indexados con los
  // amarres de siempre: exacto → canónico → aplastado.
  const [catalogo, amazon] = await Promise.all([
    traerTodo<any>(supabase, "skus", "sku, inventory_id, titulo, color, talla", (q) =>
      q.eq("account_id", cuenta.id),
    ),
    mapaAmazon(supabase),
  ]);

  const indice = indexarCatalogo(catalogo ?? []);

  const numeroPedido = pegado(pedido.pedido || "PEDIDO");
  const zip = new JSZip();
  const sinCodigo: string[] = [];

  // Un pedido puede traer varios modelos: cada uno con su carpeta, como los
  // paquetes que ya se comparten.
  const porModelo = new Map<string, typeof lineas>();
  for (const l of lineas) {
    const m = pegado(l.modelo);
    if (!porModelo.has(m)) porModelo.set(m, []);
    porModelo.get(m)!.push(l);
  }

  for (const [modelo, lineasModelo] of porModelo) {
    const carpeta = zip.folder(nombreArchivo(`${numeroPedido} (${modelo})`))!;

    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet("Hoja 1");
    hoja.addRow(["SKU", "LABEL MELI", "LABEL AMAZON"]);
    hoja.getColumn(1).width = 26;
    hoja.getColumn(2).width = 14;
    hoja.getColumn(3).width = 14;

    const coloresCarton: string[] = [];

    for (const l of lineasModelo) {
      const color = pegado(sinAnotacion(l.color ?? ""));
      coloresCarton.push(`${numeroPedido}-${modelo}-${color}`);

      for (const talla of ordenarTallas(Object.keys(l.tallas ?? {}))) {
        const { construido, encontrado } = buscarVariante(indice, l.modelo, l.color ?? "", talla);

        const sku = encontrado?.sku ?? construido;
        const codigoFull = encontrado?.inventory_id ?? null;
        const datoAmazon = buscarAmazon(amazon, sku) ?? buscarAmazon(amazon, construido);

        hoja.addRow([sku, codigoFull ?? "", datoAmazon?.fnsku ?? ""]);
        if (!codigoFull && !datoAmazon) {
          sinCodigo.push(sku);
          continue;
        }
        if (!codigoFull) sinCodigo.push(`${sku} (sin código Full, solo va la de Amazon)`);
        if (!datoAmazon) sinCodigo.push(`${sku} (sin FNSKU, solo va la de MELI)`);

        const titulo = encontrado?.titulo ?? `${l.modelo} ${l.color}`;
        const pdf = await generarPdf2Etiquetas(
          datoAmazon
            ? {
                fnsku: datoAmazon.fnsku,
                titulo: datoAmazon.titulo ?? titulo,
                sku: datoAmazon.sku,
              }
            : null,
          codigoFull
            ? {
                codigo: codigoFull,
                titulo,
                variante: varianteMeli(
                  encontrado?.color ?? sinAnotacion(l.color ?? ""),
                  encontrado?.talla ?? talla,
                ),
                pie: `SKU: ${sku}`,
                cantidad: 1,
              }
            : null,
        );

        carpeta.file(nombreArchivo(`${modelo} ${color} ${talla} MX, 2 LABEL.pdf`), pdf);
      }
    }

    carpeta.file(
      nombreArchivo(`${numeroPedido} - BOX LABEL.pdf`),
      await generarPdfCarton(coloresCarton),
    );
    carpeta.file(nombreArchivo(`${modelo}.xlsx`), Buffer.from(await libro.xlsx.writeBuffer()));
  }

  if (sinCodigo.length) {
    zip.file(
      "FALTANTES.txt",
      "A estas variantes les falta código:\n\n" + sinCodigo.join("\n") + "\n",
    );
  }

  const contenido = await zip.generateAsync({ type: "nodebuffer" });
  return new NextResponse(new Uint8Array(contenido), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nombreArchivo(numeroPedido)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
