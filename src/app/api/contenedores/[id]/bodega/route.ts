import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { armarArchivosBodega, csvPackingBodega, csvProductosBodega } from "@/lib/servicios/bodega-contenedor";
import {
  completarMedidas,
  contenedorDeCuenta,
  datosDeModelos,
  renglonesDelContenedor,
  skusDeContenedoresAnteriores,
} from "@/lib/servicios/contenedor-datos";

export const dynamic = "force-dynamic";

/**
 * Los dos archivos para la bodega (`servicios/bodega-contenedor.ts`):
 * `?archivo=productos` (alta de productos, sin los que ya viajaron en un
 * contenedor anterior) o `?archivo=packing` (lo que llega). Contesta JSON con
 * el CSV, su nombre y los avisos, para que la pantalla los enseñe al bajarlo.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const archivo = req.nextUrl.searchParams.get("archivo") === "packing" ? "packing" : "productos";

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const contenedor = await contenedorDeCuenta(supabase, cuenta.id, id);
  if (!contenedor) return NextResponse.json({ error: "Contenedor no encontrado." }, { status: 404 });

  let renglones = await renglonesDelContenedor(supabase, contenedor.id);
  if (!renglones.length) return NextResponse.json({ error: "El contenedor no tiene cajas asignadas todavía." }, { status: 400 });

  const numero = contenedor.numero.replace(/-\d{4}$/, "");
  if (archivo === "packing") {
    const armado = armarArchivosBodega(renglones, new Map(), new Set());
    return NextResponse.json({ nombre: `PACKING_LIST_${numero}.csv`, csv: csvPackingBodega(armado.packing), avisos: [] });
  }

  renglones = await completarMedidas(supabase, renglones);
  const [modelos, anteriores] = await Promise.all([
    datosDeModelos(supabase, cuenta.id, [...new Set(renglones.map((r) => r.modelo))]),
    skusDeContenedoresAnteriores(supabase, cuenta.id, contenedor),
  ]);
  const armado = armarArchivosBodega(renglones, modelos, anteriores);
  const avisos = [...armado.avisos];
  if (armado.yaDadosDeAlta.length) {
    avisos.unshift(`${armado.yaDadosDeAlta.length} productos ya venían en un contenedor anterior y no se repiten: ${armado.yaDadosDeAlta.join(", ")}.`);
  }
  return NextResponse.json({ nombre: `${numero}-PRODUCTOS.csv`, csv: csvProductosBodega(armado.productos), avisos, productos: armado.productos.length });
}
