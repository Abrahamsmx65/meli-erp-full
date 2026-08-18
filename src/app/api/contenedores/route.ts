import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { recalcularEstadoPedido } from "@/lib/servicios/pedidos";

export const dynamic = "force-dynamic";

async function ctx() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No has iniciado sesión.", status: 401 as const };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: "Conecta primero Mercado Libre.", status: 400 as const };
  return { supabase, cuenta };
}

export async function GET() {
  const c = await ctx();
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  const { data } = await c.supabase
    .from("contenedores")
    .select(
      "id, numero, naviera, fecha_salida, fecha_llegada_est, fecha_llegada_real, almacen_destino, estado, notas, contenedor_lineas(id, cajas, pedido_linea_id)",
    )
    .eq("account_id", c.cuenta.id)
    .order("fecha_llegada_est", { ascending: true, nullsFirst: false });

  return NextResponse.json({ contenedores: data ?? [] });
}

/**
 * Da de alta un contenedor y le asigna cajas de un pedido.
 *
 * Un pedido puede repartirse en varios contenedores y un contenedor puede
 * traer varios pedidos, así que la asignación es por renglón: de la línea
 * tal, tantas cajas. Lo que no se asigna sigue pendiente de embarcar.
 */
export async function POST(req: NextRequest) {
  const c = await ctx();
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  const body = await req.json().catch(() => null);
  if (!body?.numero) {
    return NextResponse.json({ error: "Falta el número de contenedor." }, { status: 400 });
  }

  const numero = String(body.numero).trim().toUpperCase();

  // Reusar el contenedor si ya existe: es normal irle agregando pedidos.
  const { data: existente } = await c.supabase
    .from("contenedores")
    .select("id")
    .eq("account_id", c.cuenta.id)
    .eq("numero", numero)
    .maybeSingle();

  let contenedorId = existente?.id as string | undefined;

  if (!contenedorId) {
    const { data, error } = await c.supabase
      .from("contenedores")
      .insert({
        account_id: c.cuenta.id,
        numero,
        naviera: body.naviera ?? null,
        fecha_salida: body.fechaSalida ?? null,
        fecha_llegada_est: body.fechaLlegadaEst ?? null,
        almacen_destino: body.almacenDestino ?? null,
        estado: body.estado ?? "en_transito",
        notas: body.notas ?? null,
      })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: `No se pudo crear el contenedor: ${error?.message}` },
        { status: 400 },
      );
    }
    contenedorId = data.id;
  } else {
    await c.supabase
      .from("contenedores")
      .update({
        naviera: body.naviera ?? undefined,
        fecha_salida: body.fechaSalida ?? undefined,
        fecha_llegada_est: body.fechaLlegadaEst ?? undefined,
        fecha_llegada_real: body.fechaLlegadaReal ?? undefined,
        almacen_destino: body.almacenDestino ?? undefined,
        estado: body.estado ?? undefined,
        notas: body.notas ?? undefined,
      })
      .eq("id", contenedorId);
  }

  // Asignaciones: [{ pedidoLineaId, cajas }]
  const asignaciones = Array.isArray(body.lineas) ? body.lineas : [];
  const pedidosTocados = new Set<string>();

  for (const a of asignaciones) {
    if (!a?.pedidoLineaId) continue;
    const cajas = Number(a.cajas) || 0;

    const { data: linea } = await c.supabase
      .from("pedido_lineas")
      .select("id, pedido_id, cajas")
      .eq("id", a.pedidoLineaId)
      .maybeSingle();
    if (!linea) continue;

    // No se puede embarcar más de lo que el pedido tiene.
    const { data: yaAsignado } = await c.supabase
      .from("contenedor_lineas")
      .select("cajas, contenedor_id")
      .eq("pedido_linea_id", linea.id);

    const enOtros = (yaAsignado ?? [])
      .filter((x) => x.contenedor_id !== contenedorId)
      .reduce((s, x) => s + (x.cajas ?? 0), 0);

    const tope = Math.max(0, (linea.cajas ?? 0) - enOtros);
    const finales = Math.min(cajas, tope);

    if (finales <= 0) {
      await c.supabase
        .from("contenedor_lineas")
        .delete()
        .eq("contenedor_id", contenedorId)
        .eq("pedido_linea_id", linea.id);
    } else {
      await c.supabase.from("contenedor_lineas").upsert(
        { contenedor_id: contenedorId, pedido_linea_id: linea.id, cajas: finales },
        { onConflict: "contenedor_id,pedido_linea_id" },
      );
    }

    pedidosTocados.add(linea.pedido_id);
  }

  for (const pid of pedidosTocados) {
    await recalcularEstadoPedido(c.supabase, pid);
  }

  return NextResponse.json({ ok: true, contenedorId, numero });
}
