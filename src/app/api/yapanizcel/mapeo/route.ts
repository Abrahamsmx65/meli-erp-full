import { NextResponse, after, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { invalidarYz } from "@/lib/yapanizcel/cache";
import { recalcularInventarioAmarrado, recalcularInventarioPantalla } from "@/lib/yapanizcel/inventario-pantalla";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Tras cambiar un amarre: se invalida todo lo que lo usa y el amarre y la
 * bodega se recalculan en el fondo con `after()` (la pantalla de SKUs los
 * lee masticados y el usuario que confirma quiere ver el efecto pronto, no
 * hasta el siguiente cron). Compras y plan los levanta el cron.
 */
function refrescarAmarreAlFondo(db: Parameters<typeof invalidarYz>[0], accountId: string): void {
  after(async () => {
    try {
      await recalcularInventarioAmarrado(db, accountId);
      await recalcularInventarioPantalla(db, accountId);
    } catch (err) {
      console.error("mapeo: recálculo de fondo:", (err as Error).message);
    }
  });
}

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
      await invalidarYz(db, cuenta.id, "Cambió un amarre de SKU.", ["compras", "plan", "inventario", "amarre"]);
      refrescarAmarreAlFondo(db, cuenta.id);
      return NextResponse.json({ ok: true });
    }

    const skuMeli = String(body?.skuMeli ?? "").trim();
    if (!skuMeli) {
      const { error } = await db.from("yz_mapeo_skus").delete().eq("account_id", cuenta.id).eq("sku_bodega", skuBodega);
      if (error) throw new Error(error.message);
      await invalidarYz(db, cuenta.id, "Se borró un amarre de SKU.", ["compras", "plan", "inventario", "amarre"]);
      refrescarAmarreAlFondo(db, cuenta.id);
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
    await invalidarYz(db, cuenta.id, "Cambió un amarre de SKU.", ["compras", "plan", "inventario", "amarre"]);
    refrescarAmarreAlFondo(db, cuenta.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorJson(err);
  }
}
