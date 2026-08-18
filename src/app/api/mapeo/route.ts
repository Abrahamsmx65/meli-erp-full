import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { invalidar } from "@/lib/servicios/cache";

export const dynamic = "force-dynamic";

/** Guarda o borra un amarre manual entre el SKU de bodega y el de MELI. */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const skuConstruido = String(body?.skuConstruido ?? "").trim();
  const skuMeli = String(body?.skuMeli ?? "").trim();

  if (!skuConstruido) {
    return NextResponse.json({ error: "Falta el SKU de bodega." }, { status: 400 });
  }

  // Sin sku_meli se interpreta como "quitar el amarre".
  if (!skuMeli) {
    const { error } = await supabase
      .from("mapeo_sku")
      .delete()
      .eq("account_id", cuenta.id)
      .eq("sku_construido", skuConstruido);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await invalidar(supabase, cuenta.id, "Se cambió el amarre de algún SKU.");
    return NextResponse.json({ ok: true, borrado: true });
  }

  // Solo se aceptan SKUs que de verdad existan en MELI: si no, el amarre
  // manual solo movería el problema de lugar.
  const { data: existe } = await supabase
    .from("skus")
    .select("sku")
    .eq("account_id", cuenta.id)
    .eq("sku", skuMeli)
    .maybeSingle();

  if (!existe) {
    return NextResponse.json(
      { error: `"${skuMeli}" no existe en tu catálogo de Mercado Libre. Revisa que esté bien escrito o sincroniza de nuevo.` },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("mapeo_sku").upsert(
    {
      account_id: cuenta.id,
      sku_construido: skuConstruido,
      sku_meli: skuMeli,
      nota: body?.nota ?? null,
    },
    { onConflict: "account_id,sku_construido" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
