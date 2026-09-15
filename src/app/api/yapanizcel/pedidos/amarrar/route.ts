import { NextResponse, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { amarrarSkus } from "@/lib/yapanizcel/pedidos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Amarra SKUs de bodega contra MELI sin guardar nada: la pantalla de cargar
 * pedido lo llama al corregir un renglón para volverlo a pintar.
 * Body: { skus: string[] } → { amarres: { [sku]: skuMeli | null } }.
 */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => null);
  const skus = Array.isArray(body?.skus) ? (body.skus as unknown[]).map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 2000) : [];
  if (!skus.length) return NextResponse.json({ ok: true, amarres: {} });
  try {
    const amarres = await amarrarSkus(ctx.db, ctx.cuenta.id, skus);
    return NextResponse.json({ ok: true, amarres: Object.fromEntries(amarres) });
  } catch (err) {
    return errorJson(err);
  }
}
