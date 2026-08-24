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

  const { data: contenedor } = await supabase
    .from("contenedores")
    .select("id, numero")
    .eq("id", id)
    .eq("account_id", cuenta.id)
    .maybeSingle();
  if (!contenedor) return { error: "Contenedor no encontrado.", status: 404 as const };

  return { supabase, cuenta, contenedor };
}

/**
 * El contenido de un contenedor, renglón por renglón, con el tope de cajas
 * que cada uno puede llevar (lo del pedido menos lo embarcado en OTROS
 * contenedores). Es lo que la ventana de edición necesita para corregir un
 * embarque mal capturado sin poder pasarse.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contexto(id);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  const { data: cls } = await c.supabase
    .from("contenedor_lineas")
    .select("pedido_linea_id, cajas")
    .eq("contenedor_id", c.contenedor.id);

  const enEste = new Map((cls ?? []).map((x) => [x.pedido_linea_id, x.cajas ?? 0]));

  // TODAS las líneas de los pedidos que este contenedor toca, para poder
  // AGREGAR renglones que faltaban, no solo editar los que ya están.
  const idsLineas = [...enEste.keys()];
  const { data: lineasBase } = idsLineas.length
    ? await c.supabase.from("pedido_lineas").select("pedido_id").in("id", idsLineas)
    : { data: [] as { pedido_id: string }[] };
  const pedidoIds = [...new Set((lineasBase ?? []).map((l) => l.pedido_id))];

  const { data: lineas } = pedidoIds.length
    ? await c.supabase
        .from("pedido_lineas")
        .select("id, pedido_id, modelo, color, talla, cajas, pares_por_caja")
        .in("pedido_id", pedidoIds)
        .order("modelo", { ascending: true })
    : { data: [] as any[] };

  const { data: pedidos } = pedidoIds.length
    ? await c.supabase.from("pedidos").select("id, pedido").in("id", pedidoIds)
    : { data: [] as { id: string; pedido: string }[] };
  const nombrePedido = new Map((pedidos ?? []).map((p) => [p.id, p.pedido]));

  // Lo asignado en OTROS contenedores, por línea.
  const todosIds = (lineas ?? []).map((l: any) => l.id);
  const { data: otras } = todosIds.length
    ? await c.supabase
        .from("contenedor_lineas")
        .select("pedido_linea_id, contenedor_id, cajas")
        .in("pedido_linea_id", todosIds)
    : { data: [] as any[] };

  const enOtros = new Map<string, number>();
  for (const o of otras ?? []) {
    if (o.contenedor_id === c.contenedor.id) continue;
    enOtros.set(o.pedido_linea_id, (enOtros.get(o.pedido_linea_id) ?? 0) + (o.cajas ?? 0));
  }

  return NextResponse.json({
    numero: c.contenedor.numero,
    lineas: (lineas ?? []).map((l: any) => ({
      pedidoLineaId: l.id,
      pedido: nombrePedido.get(l.pedido_id) ?? "",
      modelo: l.modelo,
      color: l.color,
      talla: l.talla || null,
      cajasPedido: l.cajas ?? 0,
      paresPorCaja: l.pares_por_caja ?? 0,
      enEste: enEste.get(l.id) ?? 0,
      enOtros: enOtros.get(l.id) ?? 0,
    })),
  });
}

/**
 * Corrige lo embarcado: pone las cajas de cada renglón en el número que se
 * mande (0 = quitarlo del contenedor). Nunca deja pasar más de lo que el
 * pedido tiene menos lo embarcado en otros contenedores.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contexto(id);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  const body = await req.json().catch(() => null);
  const cambios: { pedidoLineaId?: string; cajas?: number }[] = Array.isArray(body?.cambios)
    ? body.cambios
    : [];
  if (!cambios.length) {
    return NextResponse.json({ error: "No hay cambios que aplicar." }, { status: 400 });
  }

  const pedidosTocados = new Set<string>();
  const recortes: string[] = [];

  for (const cambio of cambios) {
    if (!cambio?.pedidoLineaId) continue;
    const cajas = Math.max(0, Math.round(Number(cambio.cajas) || 0));

    // La línea tiene que ser de un pedido de esta cuenta.
    const { data: linea } = await c.supabase
      .from("pedido_lineas")
      .select("id, pedido_id, modelo, color, talla, cajas, pedidos!inner(account_id)")
      .eq("id", cambio.pedidoLineaId)
      .maybeSingle();
    if (!linea || (linea.pedidos as any)?.account_id !== c.cuenta.id) continue;

    const { data: yaAsignado } = await c.supabase
      .from("contenedor_lineas")
      .select("cajas, contenedor_id")
      .eq("pedido_linea_id", linea.id);

    const enOtros = (yaAsignado ?? [])
      .filter((x) => x.contenedor_id !== c.contenedor.id)
      .reduce((s, x) => s + (x.cajas ?? 0), 0);
    const tope = Math.max(0, (linea.cajas ?? 0) - enOtros);
    const finales = Math.min(cajas, tope);
    if (finales < cajas) {
      recortes.push(
        `${linea.modelo} ${linea.color}${linea.talla ? ` T${linea.talla}` : ""}: solo caben ${finales} (pedido ${linea.cajas ?? 0}, en otros contenedores ${enOtros}).`,
      );
    }

    if (finales <= 0) {
      await c.supabase
        .from("contenedor_lineas")
        .delete()
        .eq("contenedor_id", c.contenedor.id)
        .eq("pedido_linea_id", linea.id);
    } else {
      await c.supabase.from("contenedor_lineas").upsert(
        { contenedor_id: c.contenedor.id, pedido_linea_id: linea.id, cajas: finales },
        { onConflict: "contenedor_id,pedido_linea_id" },
      );
    }
    pedidosTocados.add(linea.pedido_id);
  }

  for (const pid of pedidosTocados) {
    await recalcularEstadoPedido(c.supabase, pid);
  }
  invalidarInventario(c.cuenta.id);
  await invalidar(c.supabase, c.cuenta.id, `Se corrigió el contenido del contenedor ${c.contenedor.numero}.`);

  return NextResponse.json({ ok: true, recortes });
}
