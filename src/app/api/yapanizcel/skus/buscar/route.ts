import { NextResponse, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { patronBusquedaSku } from "@/lib/yapanizcel/sku";

export const dynamic = "force-dynamic";

/** Cuántas sugerencias devuelve el type-ahead. */
const LIMITE = 20;

/**
 * Type-ahead de SKUs de Mercado Libre para el amarre manual (pantalla de
 * SKUs): antes la página mandaba el catálogo completo (~15 mil SKUs) en un
 * <datalist>; ahora el navegador pide los 20 que coinciden con lo tecleado.
 *
 *   GET ?q=462-A5  →  { skus: ["462-A54", "462-A55", …] }
 */
export async function GET(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const patron = patronBusquedaSku(req.nextUrl.searchParams.get("q") ?? "");
  if (!patron) return NextResponse.json({ skus: [] });
  try {
    const { data, error } = await ctx.db
      .from("yz_skus")
      .select("sku")
      .eq("account_id", ctx.cuenta.id)
      .ilike("sku", patron)
      .order("sku")
      .limit(LIMITE);
    if (error) throw new Error(error.message);
    return NextResponse.json({ skus: (data ?? []).map((f: { sku: string }) => f.sku) });
  } catch (err) {
    return errorJson(err);
  }
}
