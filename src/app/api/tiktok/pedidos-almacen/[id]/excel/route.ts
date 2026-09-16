import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarPedidoAlmacen, excelDePedidoAlmacen } from "@/lib/servicios/tiktok-pedidos-almacen";
import { clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** El Excel del pedido de almacén: pedido completo, una hoja por bodega, faltantes y por modelo. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const { id } = await ctx.params;
  const pedidoId = Number(id);
  if (!Number.isFinite(pedidoId)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  try {
    const pedido = await cargarPedidoAlmacen(supabase, cuenta.id, pedidoId);
    const buffer = await excelDePedidoAlmacen(pedido);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="pedido-almacen-tiktok-${pedido.numero}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
