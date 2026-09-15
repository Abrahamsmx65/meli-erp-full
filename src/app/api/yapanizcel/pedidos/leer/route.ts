import { NextResponse, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { amarrarLineas, leerPedido } from "@/lib/yapanizcel/pedidos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lee el Excel del pedido y devuelve lo que entraría, SIN guardar: se confirma en pantalla. */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return NextResponse.json({ error: "No recibí el archivo del pedido." }, { status: 400 });
  }
  try {
    const leido = await leerPedido(Buffer.from(await archivo.arrayBuffer()), archivo.name);
    // Se amarra contra MELI aquí mismo para avisar de lo que no contaría
    // como en camino; si el catálogo no se puede leer, el pedido se lee igual.
    const r = await amarrarLineas(ctx.db, ctx.cuenta.id, leido).catch(() => leido);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return errorJson(err, 400);
  }
}
