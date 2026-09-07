import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { claveOrdenada, indexarCatalogo } from "@/lib/etiquetas/resolver";
import { claveAplastada, claveComparacion } from "@/lib/importar/sku";
import { recalcularSaldos } from "@/lib/servicios/tiktok";
import { pareceSkuDeCalzado } from "@/lib/tiktok/amarre";
import { clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Amarra a mano un SKU de TikTok con uno del ERP.
 *
 * Es la salida para lo que la normalización no alcanza. Además del mapeo, se
 * corrige el renglón del catálogo y los de los pedidos que ya se bajaron, de
 * modo que un pedido viejo que no había podido descontar sí descuente en la
 * siguiente sincronización.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const skuTikTok = String(body?.skuTikTok ?? "").trim();
  const skuCrudo = String(body?.skuInterno ?? "").trim();
  if (!skuTikTok || !skuCrudo) {
    return NextResponse.json({ error: "Faltan el SKU de TikTok y el del ERP." }, { status: 400 });
  }

  const catalogo = await traerTodo<any>(supabase, "skus", "sku", (q) =>
    q.eq("account_id", cuenta.id).eq("activo", true),
  );
  const ix = indexarCatalogo(catalogo ?? []);
  const dado =
    ix.exacto.get(skuCrudo.toUpperCase()) ??
    ix.canonico.get(claveComparacion(skuCrudo)) ??
    ix.aplastado.get(claveAplastada(skuCrudo)) ??
    ix.ordenado.get(claveOrdenada(skuCrudo));

  // El destino también puede ser un SKU del kardex de TikTok (un modelo que
  // MELI no tiene, con el nombre que le puso la bodega) o, si tiene la
  // forma MODELO-COLOR-TALLA, aceptarse tal cual: TikTok es su propio
  // almacén y no todo lo que vende está publicado en MELI.
  let skuInterno = dado?.sku as string | undefined;
  if (!skuInterno) {
    const { data: enKardex } = await supabase
      .from("tiktok_inventario")
      .select("sku")
      .eq("account_id", cuenta.id)
      .ilike("sku", skuCrudo)
      .maybeSingle();
    skuInterno = (enKardex as any)?.sku;
  }
  if (!skuInterno && pareceSkuDeCalzado(skuCrudo)) skuInterno = skuCrudo.toUpperCase();
  if (!skuInterno) {
    return NextResponse.json(
      { error: `"${skuCrudo}" no existe ni en el catálogo del ERP ni en el almacén de TikTok, y no tiene forma de SKU de calzado.` },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("tiktok_mapeo_sku").upsert(
    {
      account_id: cuenta.id,
      sku_tiktok: skuTikTok,
      sku_interno: skuInterno,
      nota: body?.nota ? String(body.nota) : null,
    },
    { onConflict: "account_id,sku_tiktok" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Lo ya bajado se corrige de una vez: si no, el amarre solo serviría para
  // los pedidos futuros y los viejos seguirían sin descontar.
  await Promise.all([
    supabase
      .from("tiktok_skus")
      .update({ sku_interno: skuInterno, origen_amarre: "manual" })
      .eq("account_id", cuenta.id)
      .eq("seller_sku", skuTikTok),
    supabase
      .from("tiktok_orden_items")
      .update({ sku_interno: skuInterno })
      .eq("account_id", cuenta.id)
      .eq("seller_sku", skuTikTok),
  ]);

  await recalcularSaldos(supabase, cuenta.id, [skuInterno]);

  return NextResponse.json({ ok: true, skuInterno });
}
