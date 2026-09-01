import { NextResponse, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { cambiarEstadoPedido, crearPedido, eliminarPedido, lineasDePedido } from "@/lib/yapanizcel/pedidos";

export const dynamic = "force-dynamic";

/** Detalle de un pedido: ?id= */
export async function GET(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Falta el id." }, { status: 400 });
  const { data: pedido } = await ctx.db.from("yz_pedidos").select("*").eq("account_id", ctx.cuenta.id).eq("id", id).maybeSingle();
  if (!pedido) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true, pedido, lineas: await lineasDePedido(ctx.db, id) });
}

/** Crea el pedido con las líneas ya confirmadas en pantalla. */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => null);
  const lineas = Array.isArray(body?.lineas) ? body.lineas : [];
  try {
    const r = await crearPedido(
      ctx.db,
      ctx.cuenta.id,
      {
        folio: String(body?.folio ?? ""),
        proveedor: body?.proveedor,
        fechaPedido: body?.fechaPedido,
        fechaEstimada: body?.fechaEstimada,
        nota: body?.nota,
        estado: body?.estado === "en_camino" ? "en_camino" : "creado",
      },
      lineas.map((l: any) => ({
        skuBodega: String(l?.skuBodega ?? "").trim().toUpperCase(),
        diseno: String(l?.diseno ?? ""),
        modelo: String(l?.modelo ?? ""),
        color: String(l?.color ?? ""),
        cantidad: Math.max(0, Math.round(Number(l?.cantidad ?? 0))),
        costoUnitario: l?.costoUnitario == null || l?.costoUnitario === "" ? null : Number(l.costoUnitario),
      })),
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return errorJson(err, 400);
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  const estado = String(body?.estado ?? "");
  if (!id || !["creado", "en_camino", "recibido", "cancelado"].includes(estado)) {
    return NextResponse.json({ error: "Falta el id o el estado no es válido." }, { status: 400 });
  }
  try {
    await cambiarEstadoPedido(ctx.db, ctx.cuenta.id, id, estado as never);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorJson(err);
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Falta el id." }, { status: 400 });
  try {
    await eliminarPedido(ctx.db, ctx.cuenta.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorJson(err);
  }
}
