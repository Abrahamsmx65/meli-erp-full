import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { recalcularEstadoPedido } from "@/lib/servicios/pedidos";
import { invalidar } from "@/lib/servicios/cache";
import { invalidarInventario } from "@/lib/servicios/inventario";

export const dynamic = "force-dynamic";

async function contexto(id: string) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No has iniciado sesión.", status: 401 as const };

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: "Conecta Mercado Libre.", status: 400 as const };

  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id, pedido")
    .eq("id", id)
    .eq("account_id", cuenta.id)
    .maybeSingle();
  if (!pedido) return { error: "Pedido no encontrado.", status: 404 as const };

  return { supabase, cuenta, pedido };
}

async function asignadasDe(supabase: any, lineaId: string): Promise<number> {
  const { data } = await supabase
    .from("contenedor_lineas")
    .select("cajas")
    .eq("pedido_linea_id", lineaId);
  return (data ?? []).reduce((a: number, x: any) => a + (x.cajas ?? 0), 0);
}

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

/**
 * Corrige un renglón del pedido: menos cajas de las que la fábrica dijo
 * (por ejemplo, una parte ya no se fabricó). Los pares se recalculan con
 * los pares por caja del propio renglón, y nunca se puede bajar de lo que
 * ya está embarcado en contenedores.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contexto(id);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  const body = await req.json().catch(() => null);
  if (!body?.lineaId) return NextResponse.json({ error: "Falta el renglón." }, { status: 400 });
  const cajas = Math.max(0, Math.round(Number(body.cajas) || 0));

  const { data: linea } = await c.supabase
    .from("pedido_lineas")
    .select("id, modelo, color, talla, cajas, pares_por_caja")
    .eq("id", body.lineaId)
    .eq("pedido_id", c.pedido.id)
    .maybeSingle();
  if (!linea) return NextResponse.json({ error: "Ese renglón no es de este pedido." }, { status: 404 });

  const asignadas = await asignadasDe(c.supabase, linea.id);
  if (cajas < asignadas) {
    return NextResponse.json(
      {
        error: `No puede quedar en ${cajas}: ya hay ${asignadas} cajas embarcadas en contenedores. Quítalas primero del contenedor.`,
      },
      { status: 400 },
    );
  }

  const paresPorCaja = linea.pares_por_caja ?? 0;
  const pares = cajas * paresPorCaja;
  const cambios: Record<string, unknown> = { cajas, pares };
  // En renglones de talla única, `tallas` guarda los pares TOTALES de esa
  // talla: se actualiza junto con los pares para que el "en camino" por
  // talla siga exacto. La receta de los renglones de corrida no se toca.
  if (linea.talla) cambios.tallas = { [linea.talla]: pares };

  const { error } = await c.supabase.from("pedido_lineas").update(cambios).eq("id", linea.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await recalcularEstadoPedido(c.supabase, c.pedido.id);
  invalidarInventario(c.cuenta.id);
  await invalidar(c.supabase, c.cuenta.id, `Se corrigió un renglón del pedido ${c.pedido.pedido}.`);

  return NextResponse.json({ ok: true, cajas, pares });
}

/**
 * Quita un renglón completo del pedido (esa parte ya no se va a surtir).
 * Solo si no tiene cajas embarcadas; las corridas no se tocan.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contexto(id);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  const lineaId = new URL(req.url).searchParams.get("linea");
  if (!lineaId) return NextResponse.json({ error: "Falta el renglón." }, { status: 400 });

  const { data: linea } = await c.supabase
    .from("pedido_lineas")
    .select("id, modelo, color, talla")
    .eq("id", lineaId)
    .eq("pedido_id", c.pedido.id)
    .maybeSingle();
  if (!linea) return NextResponse.json({ error: "Ese renglón no es de este pedido." }, { status: 404 });

  const asignadas = await asignadasDe(c.supabase, linea.id);
  if (asignadas > 0) {
    return NextResponse.json(
      {
        error: `Tiene ${asignadas} cajas embarcadas en contenedores. Quítalas primero del contenedor.`,
      },
      { status: 400 },
    );
  }

  const { error } = await c.supabase.from("pedido_lineas").delete().eq("id", linea.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await recalcularEstadoPedido(c.supabase, c.pedido.id);
  invalidarInventario(c.cuenta.id);
  await invalidar(c.supabase, c.cuenta.id, `Se quitó un renglón del pedido ${c.pedido.pedido}.`);

  return NextResponse.json({ ok: true });
}
