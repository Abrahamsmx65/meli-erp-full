import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { clienteDeCuenta } from "@/lib/yapanizcel/cuenta";
import { cambiarAtributoVariante, cambiarTitulo, leerDiseno } from "@/lib/yapanizcel/listados";
import { unificarAtributo } from "@/lib/servicios/listados";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Lee EN VIVO las publicaciones de un diseño con sus variantes y atributos. */
export async function GET(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const diseno = req.nextUrl.searchParams.get("diseno")?.trim() ?? "";
  if (!diseno) return NextResponse.json({ error: "Falta el diseño." }, { status: 400 });
  try {
    const cliente = await clienteDeCuenta(clienteAdmin(), ctx.cuenta.id);
    const grupo = await leerDiseno(cliente, ctx.db, ctx.cuenta.id, diseno);
    if (!grupo) return NextResponse.json({ error: `No hay publicaciones del diseño "${diseno}" en el catálogo.` }, { status: 404 });
    return NextResponse.json({ ok: true, grupo });
  } catch (err) {
    return errorJson(err, 502);
  }
}

/** Solo publicaciones del propio catálogo: el id llega del navegador. */
async function propias(ctx: { db: any; cuenta: { id: string } }, itemIds: string[]): Promise<string[]> {
  const { data } = await ctx.db.from("yz_skus").select("item_id").eq("account_id", ctx.cuenta.id).in("item_id", itemIds);
  const conocidas = new Set((data ?? []).map((f: { item_id: string }) => f.item_id));
  return itemIds.filter((id) => !conocidas.has(id));
}

/**
 * Escribe en MELI:
 *   { itemIds, atributoId, valor }                  -> el atributo en TODA cada publicación
 *   { itemId, variationId, atributoId, valor }      -> solo en una variante
 *   { itemId, titulo }                              -> el título
 */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const atributoId = typeof body.atributoId === "string" ? body.atributoId.trim() : "";
  const valor = typeof body.valor === "string" ? body.valor.trim() : "";
  const esMlm = (x: unknown): x is string => typeof x === "string" && /^ML[A-Z]\d{4,}$/.test(x);

  try {
    const cliente = await clienteDeCuenta(clienteAdmin(), ctx.cuenta.id);

    if (typeof body.titulo === "string" && esMlm(body.itemId)) {
      const ajenas = await propias(ctx, [body.itemId]);
      if (ajenas.length) return NextResponse.json({ error: "Publicación fuera del catálogo." }, { status: 400 });
      const r = await cambiarTitulo(cliente, body.itemId, body.titulo.trim());
      return NextResponse.json({ ok: r.estado !== "error", resultados: [r] });
    }

    if (!atributoId || !valor) return NextResponse.json({ error: "Faltan el atributo y el valor." }, { status: 400 });

    if (esMlm(body.itemId) && body.variationId) {
      const ajenas = await propias(ctx, [body.itemId]);
      if (ajenas.length) return NextResponse.json({ error: "Publicación fuera del catálogo." }, { status: 400 });
      const r = await cambiarAtributoVariante(cliente, body.itemId, String(body.variationId), atributoId, valor);
      return NextResponse.json({ ok: r.estado !== "error", resultados: [r] });
    }

    const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter(esMlm) : [];
    if (!itemIds.length) return NextResponse.json({ error: "Faltan las publicaciones." }, { status: 400 });
    const ajenas = await propias(ctx, itemIds);
    if (ajenas.length) return NextResponse.json({ error: `Publicaciones fuera del catálogo: ${ajenas.join(", ")}.` }, { status: 400 });

    const resultados = await unificarAtributo(cliente, itemIds, atributoId, valor);
    return NextResponse.json({ ok: resultados.every((r) => r.estado !== "error"), resultados });
  } catch (err) {
    return errorJson(err, 502);
  }
}
