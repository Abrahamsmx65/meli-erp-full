import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { partirSku } from "@/lib/tiktok/despacho";
import { clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Las salidas de un corte en CSV (SKU, modelo, color, talla, pares, pedido),
 * para que el 3PL las capture a mano mientras no tiene el endpoint. Cuando
 * lo tenga, esto sobra.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const { id } = await ctx.params;
  const corteId = Number(id);
  const filas = await traerTodo<any>(supabase, "tiktok_salidas_3pl", "order_id, sku, pares, confirmada_en, id", (q) =>
    q.eq("account_id", cuenta.id).eq("corte_id", corteId),
  );

  const lineas = ["sku,modelo,color,talla,pares,pedido,confirmada_en_3pl"];
  for (const f of filas ?? []) {
    const { modelo, color, talla } = partirSku(f.sku);
    const c = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    lineas.push([c(f.sku), c(modelo), c(color), c(talla), f.pares, c(f.order_id), c(f.confirmada_en ?? "")].join(","));
  }
  return new NextResponse("\ufeff" + lineas.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="corte-${corteId}-salidas.csv"`,
    },
  });
}
