import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { armarPackingListContenedor, excelPackingListContenedor } from "@/lib/servicios/packing-list-contenedor";
import { contenedorDeCuenta, datosDeModelos, renglonesDelContenedor } from "@/lib/servicios/contenedor-datos";

export const dynamic = "force-dynamic";

/**
 * Packing list del contenedor para el agente aduanal (formato del dueño,
 * 18-sep-2026): LOTE PEDIDO | MODELO | COLOR | SKU | PARES | CAJAS | LARGO |
 * ALTO | ANCHO | PESO | PRECIO | NOMBRE | CODIGO FISCAL. Las medidas y el
 * peso vienen del packing list de la fábrica guardado en `contenedor_lineas`;
 * el precio de la caja es costo por par × pares; el código fiscal sale de la
 * categoría de MELI del modelo. El armado vive en
 * `servicios/packing-list-contenedor.ts`.
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

  const contenedor = await contenedorDeCuenta(supabase, cuenta.id, id);
  if (!contenedor) return NextResponse.json({ error: "Contenedor no encontrado." }, { status: 404 });

  const renglones = await renglonesDelContenedor(supabase, contenedor.id);
  if (!renglones.length) {
    return NextResponse.json({ error: "El contenedor no tiene cajas asignadas todavía." }, { status: 400 });
  }

  const modelos = await datosDeModelos(supabase, cuenta.id, [...new Set(renglones.map((r) => r.modelo))]);
  const packing = armarPackingListContenedor(renglones, modelos);
  const buffer = await excelPackingListContenedor(contenedor.numero, contenedor.numero_naviera ?? null, packing);

  const nombre = `packing-list-${contenedor.numero.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
