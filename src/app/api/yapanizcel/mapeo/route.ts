import { NextResponse, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";

export const dynamic = "force-dynamic";

/**
 * Amarre manual bodega -> MELI, y la lista de ignorados.
 *
 *   { skuBodega, skuMeli }          guarda el amarre
 *   { skuBodega, skuMeli: "" }      lo borra
 *   { skuBodega, ignorar: true }    lo manda a ignorados (y quita el amarre)
 *   { skuBodega, ignorar: false }   lo saca de ignorados
 */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const { db, cuenta } = ctx;

  const body = await req.json().catch(() => null);
  const skuBodega = String(body?.skuBodega ?? "").trim();
  if (!skuBodega) return NextResponse.json({ error: "Falta el SKU de bodega." }, { status: 400 });

  try {
    if (typeof body?.ignorar === "boolean") {
      if (body.ignorar) {
        await db.from("yz_mapeo_skus").delete().eq("account_id", cuenta.id).eq("sku_bodega", skuBodega);
        const { error } = await db
          .from("yz_skus_ignorados")
          .upsert({ account_id: cuenta.id, sku_bodega: skuBodega, motivo: String(body?.motivo ?? "").trim() || null }, { onConflict: "account_id,sku_bodega" });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db.from("yz_skus_ignorados").delete().eq("account_id", cuenta.id).eq("sku_bodega", skuBodega);
        if (error) throw new Error(error.message);
      }
      return NextResponse.json({ ok: true });
    }

    const skuMeli = String(body?.skuMeli ?? "").trim();
    if (!skuMeli) {
      const { error } = await db.from("yz_mapeo_skus").delete().eq("account_id", cuenta.id).eq("sku_bodega", skuBodega);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, borrado: true });
    }

    // Solo SKUs que de verdad existan en MELI: si no, el amarre manual solo
    // movería el problema de lugar.
    const { data: existe } = await db.from("yz_skus").select("sku").eq("account_id", cuenta.id).eq("sku", skuMeli).maybeSingle();
    if (!existe) {
      return NextResponse.json(
        { error: `"${skuMeli}" no existe en el catálogo de Mercado Libre de YAPANIZCEL. Revisa que esté bien escrito o sincroniza de nuevo.` },
        { status: 400 },
      );
    }

    await db.from("yz_skus_ignorados").delete().eq("account_id", cuenta.id).eq("sku_bodega", skuBodega);
    const { error } = await db
      .from("yz_mapeo_skus")
      .upsert({ account_id: cuenta.id, sku_bodega: skuBodega, sku_meli: skuMeli, nota: String(body?.nota ?? "").trim() || null }, { onConflict: "account_id,sku_bodega" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorJson(err);
  }
}
