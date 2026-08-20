import ExcelJS from "exceljs";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import {
  canonizar,
  claveAplastada,
  claveComparacion,
  construirSkuMeli,
} from "@/lib/importar/sku";
import { mapaFnsku } from "@/lib/etiquetas/resolver";
import { varianteMeli } from "@/lib/etiquetas/zpl";
import {
  generarPdfCarton,
  generarPdfDatos,
  type DatosEtiqueta,
} from "@/lib/etiquetas/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "M BROWN" → "MBROWN": para nombres de archivo y la etiqueta de cartón. */
function pegado(s: string): string {
  return canonizar(s).replace(/-/g, "");
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
 * El paquete de etiquetas de un pedido a China, en un ZIP:
 *
 *   - Un PDF por modelo+color con la etiqueta de MELI (código Full) y la de
 *     Amazon (FNSKU) de cada talla, una tras otra y del mismo tamaño, en el
 *     formato de "Etiquetas de producto" de MELI (hoja A4, 24 por hoja).
 *   - `codigos.xlsx` con el código Full y el FNSKU de cada variante.
 *   - La carpeta `CTNS LABELS` con una etiqueta grande por modelo+color con
 *     el texto PEDIDO-MODELO-COLOR (p. ej. IN10199-GT142-BLK), para el cartón.
 *
 * Es lo que se le manda a la fábrica para que etiquete el pedido.
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
    .order("modelo", { ascending: true });
  if (!lineas?.length) {
    return NextResponse.json({ error: "El pedido no tiene renglones." }, { status: 400 });
  }

  // El catálogo completo de MELI y los FNSKU de Amazon, indexados con los
  // mismos amarres de siempre: exacto → canónico → aplastado.
  const [catalogo, fnskus] = await Promise.all([
    traerTodo<any>(supabase, "skus", "sku, inventory_id, titulo, color, talla", (q) =>
      q.eq("account_id", cuenta.id),
    ),
    mapaFnsku(supabase),
  ]);

  const exacto = new Map<string, any>();
  const canonico = new Map<string, any>();
  const aplastado = new Map<string, any>();
  for (const s of catalogo ?? []) {
    exacto.set(s.sku.trim().toUpperCase(), s);
    const c = claveComparacion(s.sku);
    if (!canonico.has(c)) canonico.set(c, s);
    const a = claveAplastada(s.sku);
    if (!aplastado.has(a)) aplastado.set(a, s);
  }

  const numeroPedido = pegado(pedido.pedido || "PEDIDO");
  const zip = new JSZip();
  const carpetaCarton = zip.folder("CTNS LABELS")!;

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Códigos");
  hoja.columns = [
    { header: "Pedido", key: "pedido", width: 12 },
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Color", key: "color", width: 16 },
    { header: "Talla", key: "talla", width: 8 },
    { header: "SKU MELI", key: "sku", width: 26 },
    { header: "Código Full", key: "full", width: 16 },
    { header: "FNSKU", key: "fnsku", width: 16 },
  ];
  hoja.getRow(1).font = { bold: true };

  const sinCodigo: string[] = [];

  for (const l of lineas) {
    const tallas = ordenarTallas(Object.keys(l.tallas ?? {}));
    if (!tallas.length) continue;

    const datos: DatosEtiqueta[] = [];
    for (const talla of tallas) {
      const construido = construirSkuMeli(l.modelo, l.color, talla);
      const encontrado =
        exacto.get(construido) ??
        canonico.get(claveComparacion(construido)) ??
        aplastado.get(claveAplastada(construido));

      const sku = encontrado?.sku ?? construido;
      const codigoFull = encontrado?.inventory_id ?? null;
      const fnsku =
        fnskus.get(claveComparacion(sku)) ?? fnskus.get(claveComparacion(construido)) ?? null;
      const titulo = encontrado?.titulo ?? `${l.modelo} ${l.color}`;
      const variante = varianteMeli(encontrado?.color ?? l.color, encontrado?.talla ?? talla);

      hoja.addRow({
        pedido: pedido.pedido,
        modelo: l.modelo,
        color: l.color,
        talla,
        sku,
        full: codigoFull ?? "",
        fnsku: fnsku ?? "",
      });
      if (!codigoFull && !fnsku) {
        sinCodigo.push(sku);
        continue;
      }

      // La etiqueta de MELI y la de Amazon de la misma talla, una tras otra
      // y del mismo tamaño.
      if (codigoFull) {
        datos.push({ codigo: codigoFull, titulo, variante, pie: `SKU: ${sku}`, cantidad: 1 });
      }
      if (fnsku) {
        datos.push({ codigo: fnsku, titulo, variante, pie: "Nuevo", cantidad: 1 });
      }
    }

    const nombreBase = `${pegado(l.modelo)}-${pegado(l.color)}`;
    if (datos.length) {
      zip.file(`${nombreBase}.pdf`, await generarPdfDatos(datos));
    }

    const textoCarton = `${numeroPedido}-${nombreBase}`;
    carpetaCarton.file(`${textoCarton}.pdf`, await generarPdfCarton(textoCarton));
  }

  if (sinCodigo.length) {
    zip.file(
      "SIN-CODIGO.txt",
      "Estas variantes no tienen código Full ni FNSKU todavía, así que no llevan etiqueta:\n\n" +
        sinCodigo.join("\n") +
        "\n",
    );
  }

  zip.file("codigos.xlsx", Buffer.from(await libro.xlsx.writeBuffer()));

  const contenido = await zip.generateAsync({ type: "nodebuffer" });
  return new NextResponse(new Uint8Array(contenido), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="etiquetas-${numeroPedido}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
