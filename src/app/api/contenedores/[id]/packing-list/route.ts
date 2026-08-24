import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { construirSkuMeli } from "@/lib/importar/sku";

export const dynamic = "force-dynamic";

/**
 * Packing list de un contenedor: SKU | Cajas, igual que el que se manda a
 * MELI. El SKU va en formato MELI: MODELO-COLOR para renglones de corrida y
 * MODELO-COLOR-TALLA para las cajas de una sola talla.
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

  const { data: contenedor } = await supabase
    .from("contenedores")
    .select("id, numero")
    .eq("id", id)
    .eq("account_id", cuenta.id)
    .maybeSingle();
  if (!contenedor) return NextResponse.json({ error: "Contenedor no encontrado." }, { status: 404 });

  const { data: cls } = await supabase
    .from("contenedor_lineas")
    .select("cajas, pedido_linea_id")
    .eq("contenedor_id", contenedor.id);

  if (!cls?.length) {
    return NextResponse.json(
      { error: "El contenedor no tiene cajas asignadas todavía." },
      { status: 400 },
    );
  }

  const { data: lineas } = await supabase
    .from("pedido_lineas")
    .select("id, modelo, color, talla")
    .in("id", [...new Set(cls.map((x) => x.pedido_linea_id))]);
  const porId = new Map((lineas ?? []).map((l) => [l.id, l]));

  // Un renglón por SKU: si dos pedidos suben el mismo modelo-color al mismo
  // contenedor, sus cajas se suman en una fila, como en el packing real.
  const filas = new Map<string, number>();
  for (const cl of cls) {
    const l = porId.get(cl.pedido_linea_id);
    if (!l) continue;
    // construirSkuMeli ignora la talla vacía: los renglones de corrida salen
    // como MODELO-COLOR y los de talla única como MODELO-COLOR-TALLA.
    const sku = construirSkuMeli(l.modelo, l.color ?? "", l.talla ?? "");
    filas.set(sku, (filas.get(sku) ?? 0) + (cl.cajas ?? 0));
  }

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(`Contenedor ${contenedor.numero}`.slice(0, 31));
  hoja.columns = [
    { header: "SKU", key: "sku", width: 28 },
    { header: "Cajas", key: "cajas", width: 10 },
  ];
  hoja.getRow(1).font = { bold: true };

  for (const [sku, cajas] of [...filas.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    hoja.addRow({ sku, cajas });
  }

  const total = hoja.addRow({
    sku: "TOTAL",
    cajas: [...filas.values()].reduce((a, b) => a + b, 0),
  });
  total.font = { bold: true };

  const buffer = await libro.xlsx.writeBuffer();
  const nombre = `packing-list-${contenedor.numero.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.xlsx`;
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
