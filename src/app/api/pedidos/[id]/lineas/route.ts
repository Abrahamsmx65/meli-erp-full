import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";

export const dynamic = "force-dynamic";

/**
 * Renglones de un pedido, con cuántas cajas de cada uno ya van en algún
 * contenedor. Es lo que la ventana de asignación necesita para no dejar
 * embarcar de más.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  // El pedido tiene que ser de esta cuenta; los renglones cuelgan de él.
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id")
    .eq("id", id)
    .eq("account_id", cuenta.id)
    .maybeSingle();

  if (!pedido) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });

  const { data: lineas } = await supabase
    .from("pedido_lineas")
    .select("id, modelo, color, talla, cajas, pares, pares_por_caja")
    .eq("pedido_id", id)
    .order("modelo", { ascending: true });

  const ids = (lineas ?? []).map((l) => l.id);
  const asignadas = new Map<string, number>();

  if (ids.length) {
    const { data } = await supabase
      .from("contenedor_lineas")
      .select("pedido_linea_id, cajas")
      .in("pedido_linea_id", ids);

    for (const a of data ?? []) {
      asignadas.set(a.pedido_linea_id, (asignadas.get(a.pedido_linea_id) ?? 0) + (a.cajas ?? 0));
    }
  }

  return NextResponse.json({
    lineas: (lineas ?? []).map((l) => ({
      id: l.id,
      modelo: l.modelo,
      color: l.color,
      talla: l.talla || null,
      cajas: l.cajas ?? 0,
      pares: l.pares ?? 0,
      paresPorCaja: l.pares_por_caja ?? 0,
      yaAsignadas: asignadas.get(l.id) ?? 0,
    })),
  });
}
