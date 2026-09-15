import { NextResponse, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { obtenerDetalleCompras } from "@/lib/yapanizcel/compras";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * El detalle de UN diseño para la pantalla de Pedidos a China: el renglón
 * masticado de `yz_cache` ("compras:d:499"), unos KB. La pantalla lo pide
 * al abrir el diseño en vez de volver a pintar la página entera en el
 * servidor, que es lo que se sentía lento en cada clic.
 */
export async function GET(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const diseno = (req.nextUrl.searchParams.get("diseno") ?? "").trim().toUpperCase();
  if (!diseno) return NextResponse.json({ error: "Falta el diseño." }, { status: 400 });
  try {
    const detalle = await obtenerDetalleCompras(ctx.db, ctx.cuenta.id, diseno);
    if (!detalle) return NextResponse.json({ error: `No hay publicaciones vivas del diseño ${diseno}.` }, { status: 404 });
    // Infinity no viaja en JSON: se manda null y la pantalla lo pinta como ∞.
    return NextResponse.json({
      ok: true,
      detalle: { ...detalle, variantes: detalle.variantes.map((v) => ({ ...v, cobertura: Number.isFinite(v.cobertura) ? v.cobertura : null })) },
    });
  } catch (err) {
    return errorJson(err);
  }
}
