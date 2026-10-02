import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { bodegas, producto } from "@/lib/tiktok/api";
import { clienteDeCuenta } from "@/lib/servicios/tiktok";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sonda de UN producto de TikTok, sin escribir nada: las bodegas de la
 * tienda (cuál es la predeterminada y cuál usa el ERP), el producto tal
 * cual lo contesta TikTok (estado y, por SKU, el inventario POR BODEGA) y
 * lo que el ERP cree de cada SKU (kardex, publicado, lo que TikTok dijo
 * tener en la última lectura del catálogo). Nació el 2-oct-2026 porque el
 * Seller Center enseñaba GT117 con 0 existencias mientras el ERP había
 * escrito 6, 16, 26… y el catálogo contestaba esas mismas cantidades.
 *
 *   /api/tiktok/diagnostico/producto?id=1737801521529259225
 *   /api/tiktok/diagnostico/producto?sku=GT117-BROWN-25-MX
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const admin = clienteAdmin();
  let productId = req.nextUrl.searchParams.get("id")?.trim() || "";
  const sku = req.nextUrl.searchParams.get("sku")?.trim().toUpperCase() || "";
  if (!productId && sku) {
    const { data } = await admin
      .from("tiktok_skus")
      .select("product_id")
      .eq("account_id", cuenta.id)
      .or(`seller_sku.ilike.${sku},sku_interno.ilike.${sku}`)
      .limit(1)
      .maybeSingle();
    productId = data?.product_id ? String(data.product_id) : "";
  }
  if (!productId) return NextResponse.json({ error: "Falta ?id= (producto de TikTok) o ?sku=" }, { status: 400 });

  const cliente = await clienteDeCuenta(admin, cuenta.id, 50_000);
  if (!cliente || !cliente.tienda.shopCipher) return NextResponse.json({ error: "TikTok Shop no está conectado." }, { status: 400 });

  const resultado: Record<string, unknown> = { productId, bodegaDelErp: cliente.tienda.warehouseId ?? null };
  try {
    resultado.bodegas = await bodegas(cliente);
  } catch (err) {
    resultado.bodegas = { error: (err as Error).message };
  }

  const { data: nuestros } = await admin
    .from("tiktok_skus")
    .select("sku_id, seller_sku, sku_interno, estado, cantidad_tiktok, actualizado_en")
    .eq("account_id", cuenta.id)
    .eq("product_id", productId);
  const internos = (nuestros ?? []).map((s: any) => s.sku_interno).filter(Boolean);
  const { data: inventario } = internos.length
    ? await admin
        .from("tiktok_inventario")
        .select("sku, saldo, apartado, apartado_web, publicado, publicado_en, tope_estante, contado")
        .eq("account_id", cuenta.id)
        .in("sku", internos)
    : { data: [] as any[] };
  const kardex = new Map((inventario ?? []).map((r: any) => [String(r.sku).toUpperCase(), r]));

  try {
    const crudo = await producto(cliente, productId);
    resultado.estado = crudo?.status ?? null;
    resultado.titulo = crudo?.title ?? null;
    resultado.actualizadoEnTikTok = crudo?.update_time ?? null;
    resultado.skus = (crudo?.skus ?? []).map((s: any) => {
      const nuestro = (nuestros ?? []).find((n: any) => String(n.sku_id) === String(s.id));
      const k = nuestro?.sku_interno ? kardex.get(String(nuestro.sku_interno).toUpperCase()) : null;
      return {
        skuId: s.id,
        sellerSku: s.seller_sku ?? null,
        variante: (s.sales_attributes ?? []).map((a: any) => a?.value_name).filter(Boolean).join(" / "),
        inventarioEnTikTok: (s.inventory ?? []).map((i: any) => ({ bodega: i?.warehouse_id ?? null, cantidad: i?.quantity ?? null })),
        erp: nuestro
          ? {
              skuInterno: nuestro.sku_interno,
              estadoCatalogo: nuestro.estado,
              cantidadTikTokUltimaLectura: nuestro.cantidad_tiktok,
              leidoEn: nuestro.actualizado_en,
              kardex: k ? { saldo: k.saldo, apartado: k.apartado, apartadoWeb: k.apartado_web, publicado: k.publicado, publicadoEn: k.publicado_en, topeEstante: k.tope_estante, contado: k.contado } : null,
            }
          : null,
      };
    });
    resultado.crudo = crudo;
  } catch (err) {
    resultado.producto = { error: (err as Error).message };
  }
  return NextResponse.json(resultado);
}
