import { NextResponse } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarResumenModelos, excelResumenModelos } from "@/lib/servicios/tiktok-resumen-modelos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * El Excel por modelo del almacén TikTok: modelo, foto, categoría, ID y
 * estado del producto en TikTok, stock en la bodega TikTok, stock por
 * bodega de cajas y ventas de MELI (pedido del dueño, 2-oct-2026). Se lee
 * con el cliente admin porque junta tablas de varias secciones (bodega,
 * costos, Amazon) y el rol de TikTok también lo puede bajar.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  try {
    const resumen = await cargarResumenModelos(clienteAdmin(), cuenta.id);
    const buffer = await excelResumenModelos(resumen);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="tiktok-por-modelo-${resumen.hoy}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
