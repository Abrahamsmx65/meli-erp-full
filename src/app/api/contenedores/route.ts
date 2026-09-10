import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { recalcularEstadoPedido } from "@/lib/servicios/pedidos";
import { invalidar } from "@/lib/servicios/cache";
import { invalidarInventario } from "@/lib/servicios/inventario";

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
      "id, numero, numero_naviera, naviera, fecha_salida, fecha_llegada_est, fecha_llegada_real, almacen_destino, estado, notas, contenedor_lineas(id, cajas, pedido_linea_id)",
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
        numero_naviera: body.numeroNaviera ?? null,
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
        numero_naviera: body.numeroNaviera ?? undefined,
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

/**
 * Edita un contenedor ya dado de alta, o confirma su llegada.
 *
 * Confirmar la llegada NO da de alta existencias: el inventario de bodega
 * llega del API de Industher; aquí solo se marca `recibido`, se apunta la
 * fecha real y el pedido deja de contar como "en camino".
 */
export async function PATCH(req: NextRequest) {
  const c = await ctx();
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  const body = await req.json().catch(() => null);
  if (!body?.id) {
    return NextResponse.json({ error: "Falta el id del contenedor." }, { status: 400 });
  }

  const { data: contenedor } = await c.supabase
    .from("contenedores")
    .select("id, numero, estado")
    .eq("id", body.id)
    .eq("account_id", c.cuenta.id)
    .maybeSingle();
  if (!contenedor) {
    return NextResponse.json({ error: "Contenedor no encontrado." }, { status: 404 });
  }

  const cambios: Record<string, unknown> = {};
  if (body.numeroNaviera !== undefined) cambios.numero_naviera = body.numeroNaviera || null;
  if (body.naviera !== undefined) cambios.naviera = body.naviera || null;
  if (body.fechaSalida !== undefined) cambios.fecha_salida = body.fechaSalida || null;
  if (body.fechaLlegadaEst !== undefined) cambios.fecha_llegada_est = body.fechaLlegadaEst || null;
  if (body.almacenDestino !== undefined) cambios.almacen_destino = body.almacenDestino || null;
  if (body.notas !== undefined) cambios.notas = body.notas || null;
  if (body.estado !== undefined) cambios.estado = body.estado;
  // Los renglones del packing list que no amarraron: la pantalla los va
  // quitando conforme el dueño los confirma contra el renglón que sí es.
  if (body.pendientes !== undefined) {
    cambios.pendientes = Array.isArray(body.pendientes) && body.pendientes.length ? body.pendientes : null;
  }

  if (body.accion === "confirmarLlegada") {
    cambios.estado = "recibido";
    // El día de hoy en horario de México (offset fijo -06:00, como el resto
    // del sistema), salvo que venga la fecha real capturada.
    cambios.fecha_llegada_real =
      body.fechaLlegadaReal || new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  }

  if (!Object.keys(cambios).length) {
    return NextResponse.json({ error: "No hay nada que cambiar." }, { status: 400 });
  }

  const { error } = await c.supabase.from("contenedores").update(cambios).eq("id", contenedor.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Si cambió el estado, los pedidos que trae pueden pasar a "recibido" (o
  // regresar a en tránsito) y el "en camino" del planeador cambia con ellos.
  if (cambios.estado !== undefined) {
    const { data: cls } = await c.supabase
      .from("contenedor_lineas")
      .select("pedido_linea_id")
      .eq("contenedor_id", contenedor.id);
    const lineaIds = [...new Set((cls ?? []).map((x) => x.pedido_linea_id))];
    if (lineaIds.length) {
      const { data: lineas } = await c.supabase
        .from("pedido_lineas")
        .select("pedido_id")
        .in("id", lineaIds);
      for (const pid of new Set((lineas ?? []).map((l) => l.pedido_id))) {
        await recalcularEstadoPedido(c.supabase, pid);
      }
    }
    invalidarInventario(c.cuenta.id);
    await invalidar(c.supabase, c.cuenta.id, `Cambió el estado del contenedor ${contenedor.numero}.`);
  }

  return NextResponse.json({ ok: true });
}
