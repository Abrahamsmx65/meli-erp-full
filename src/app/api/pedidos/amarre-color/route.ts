import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { canonizar, colorPlano } from "@/lib/importar/sku";
import { indexarCatalogo } from "@/lib/etiquetas/resolver";
import { coloresDelModelo } from "@/lib/servicios/amarre-pedido";
import { catalogoBodega, invalidarInventario } from "@/lib/servicios/inventario";
import { invalidar } from "@/lib/servicios/cache";

export const dynamic = "force-dynamic";

/**
 * Liga a mano el color de un pedido con una variante de MELI, o lo confirma
 * como color nuevo, o quita el amarre (`pedido_color_amarres`,
 * `alias-color.ts`). Por modelo + color aplastado: aplica a todos los
 * pedidos y contenedores con esa escritura.
 *
 *   { modelo, color, colorMeli: "BLUE" }   → ligado a BLUE
 *   { modelo, color, colorMeli: null }     → confirmado como color nuevo
 *   { modelo, color, quitar: true }        → se borra el amarre
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const modelo = canonizar(String(body?.modelo ?? ""));
  const colorPedido = String(body?.color ?? "").trim().toUpperCase();
  const color = colorPlano(colorPedido);
  if (!modelo || !color) {
    return NextResponse.json({ error: "Falta el modelo o el color del pedido." }, { status: 400 });
  }

  if (body?.quitar) {
    const { error } = await supabase
      .from("pedido_color_amarres")
      .delete()
      .eq("account_id", cuenta.id)
      .eq("modelo", modelo)
      .eq("color", color);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invalidarInventario(cuenta.id);
    await invalidar(supabase, cuenta.id, `Se quitó el amarre del color ${modelo} ${colorPedido}.`);
    return NextResponse.json({ ok: true, borrado: true });
  }

  const colorMeli = body?.colorMeli == null ? null : String(body.colorMeli).trim().toUpperCase();

  // Solo se liga a un color que MELI de verdad tenga para ese modelo: si no,
  // el amarre solo movería el problema de lugar.
  if (colorMeli) {
    const { skus } = await catalogoBodega(supabase, cuenta.id);
    const publicados = coloresDelModelo(indexarCatalogo(skus as { sku: string }[]), modelo);
    if (!publicados.some((c) => colorPlano(c) === colorPlano(colorMeli))) {
      return NextResponse.json(
        {
          error: `MELI no tiene el color "${colorMeli}" para ${modelo}. Tiene: ${publicados.join(", ") || "ninguno"}.`,
        },
        { status: 400 },
      );
    }
  }

  const { error } = await supabase.from("pedido_color_amarres").upsert(
    {
      account_id: cuenta.id,
      modelo,
      color,
      color_meli: colorMeli,
      color_pedido: colorPedido,
    },
    { onConflict: "account_id,modelo,color" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Lo en camino de ese color cambia de SKU: inventario, plan, Planificación
  // China y Productos nuevos se recalculan por atrás.
  invalidarInventario(cuenta.id);
  await invalidar(
    supabase,
    cuenta.id,
    colorMeli
      ? `Se ligó el color ${modelo} ${colorPedido} con ${colorMeli} de MELI.`
      : `Se confirmó ${modelo} ${colorPedido} como color nuevo.`,
  );
  return NextResponse.json({ ok: true, colorMeli });
}
