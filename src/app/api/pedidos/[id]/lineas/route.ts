import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { recalcularEstadoPedido } from "@/lib/servicios/pedidos";
import { invalidar } from "@/lib/servicios/cache";
import { invalidarInventario } from "@/lib/servicios/inventario";
import { normalizarTalla } from "@/lib/importar/sku";

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

function limpiarTexto(v: unknown): string {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

/** "24", "24.5" o vacío (corrida). Cualquier otra cosa se rechaza. */
function limpiarTalla(v: unknown): string | null {
  const t = limpiarTexto(v);
  if (!t || t === "CORRIDA") return "";
  return /^\d{1,2}(\.\d)?$/.test(t) ? normalizarTalla(t) : null;
}

/**
 * ¿Ya hay otro renglón de este pedido con ese modelo + color + talla?
 * El índice único lo rechazaría igual, pero con un mensaje que no dice
 * nada; aquí se explica antes.
 */
async function renglonRepetido(
  supabase: any,
  pedidoId: string,
  modelo: string,
  color: string,
  talla: string,
  exceptoId?: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("pedido_lineas")
    .select("id")
    .eq("pedido_id", pedidoId)
    .eq("modelo", modelo)
    .eq("color", color)
    .eq("talla", talla);
  return (data ?? []).some((x: { id: string }) => x.id !== exceptoId);
}

/**
 * Corrige un renglón del pedido: modelo, color o talla (un SKU mal
 * capturado en la proforma), las cajas (una parte ya no se fabricó) o los
 * pares por caja de una caja de talla única. Los pares se recalculan solos
 * y nunca se puede bajar de lo que ya está embarcado en contenedores.
 *
 * Si cambia el modelo o el color de un renglón de CORRIDA, la corrida de
 * ese pedido se renombra con él: es la misma caja, con el nombre bien.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contexto(id);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  const body = await req.json().catch(() => null);
  if (!body?.lineaId) return NextResponse.json({ error: "Falta el renglón." }, { status: 400 });

  const { data: linea } = await c.supabase
    .from("pedido_lineas")
    .select("id, modelo, color, talla, cajas, pares_por_caja, tallas")
    .eq("id", body.lineaId)
    .eq("pedido_id", c.pedido.id)
    .maybeSingle();
  if (!linea) return NextResponse.json({ error: "Ese renglón no es de este pedido." }, { status: 404 });

  const modelo = body.modelo !== undefined ? limpiarTexto(body.modelo) : linea.modelo;
  const color = body.color !== undefined ? limpiarTexto(body.color) : (linea.color ?? "");
  const talla = body.talla !== undefined ? limpiarTalla(body.talla) : (linea.talla ?? "");
  if (!modelo) return NextResponse.json({ error: "El modelo no puede quedar vacío." }, { status: 400 });
  if (talla === null) {
    return NextResponse.json({ error: "La talla tiene que ser un número (24, 25.5) o quedar vacía para corrida." }, { status: 400 });
  }
  const cajas = body.cajas !== undefined ? Math.max(0, Math.round(Number(body.cajas) || 0)) : (linea.cajas ?? 0);

  const asignadas = await asignadasDe(c.supabase, linea.id);
  if (cajas < asignadas) {
    return NextResponse.json(
      {
        error: `No puede quedar en ${cajas}: ya hay ${asignadas} cajas embarcadas en contenedores. Quítalas primero del contenedor.`,
      },
      { status: 400 },
    );
  }

  // Pares por caja: editable solo en cajas de una sola talla. En una
  // corrida es la suma de su receta y esa se captura en Corridas.
  let paresPorCaja = linea.pares_por_caja ?? 0;
  if (body.paresPorCaja !== undefined) {
    const nuevo = Math.max(0, Math.round(Number(body.paresPorCaja) || 0));
    if (!talla && nuevo !== paresPorCaja) {
      return NextResponse.json(
        { error: "En un renglón de corrida los pares por caja salen de la corrida; edítala en Corridas." },
        { status: 400 },
      );
    }
    paresPorCaja = nuevo;
  }

  const cambiaClave = modelo !== linea.modelo || color !== (linea.color ?? "") || talla !== (linea.talla ?? "");
  if (cambiaClave && (await renglonRepetido(c.supabase, c.pedido.id, modelo, color, talla, linea.id))) {
    return NextResponse.json(
      { error: `El pedido ya tiene un renglón ${modelo} ${color}${talla ? ` talla ${talla}` : ""}. Súmale las cajas a ese y quita este.` },
      { status: 400 },
    );
  }

  const pares = cajas * paresPorCaja;
  const cambios: Record<string, unknown> = { modelo, color, talla, cajas, pares, pares_por_caja: paresPorCaja };
  // En renglones de talla única, `tallas` guarda los pares TOTALES de esa
  // talla: se actualiza junto con los pares para que el "en camino" por
  // talla siga exacto. Un renglón que pasa de talla única a corrida se
  // queda sin receta hasta que exista su corrida.
  if (talla) cambios.tallas = { [talla]: pares };
  else if (linea.talla) cambios.tallas = {};

  const { error } = await c.supabase.from("pedido_lineas").update(cambios).eq("id", linea.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // La corrida sigue al renglón: mismo pedido, nombre nuevo. Si ya hay
  // una corrida con el nombre nuevo, esa manda y la vieja se deja.
  if (!linea.talla && !talla && (modelo !== linea.modelo || color !== (linea.color ?? ""))) {
    const { data: yaHay } = await c.supabase
      .from("corridas")
      .select("pedido")
      .eq("account_id", c.cuenta.id)
      .eq("pedido", c.pedido.pedido)
      .eq("modelo", modelo)
      .eq("color", color)
      .maybeSingle();
    if (!yaHay) {
      await c.supabase
        .from("corridas")
        .update({ modelo, color, actualizado_en: new Date().toISOString() })
        .eq("account_id", c.cuenta.id)
        .eq("pedido", c.pedido.pedido)
        .eq("modelo", linea.modelo)
        .eq("color", linea.color ?? "");
    }
  }

  await recalcularEstadoPedido(c.supabase, c.pedido.id);
  invalidarInventario(c.cuenta.id);
  await invalidar(c.supabase, c.cuenta.id, `Se corrigió un renglón del pedido ${c.pedido.pedido}.`);

  return NextResponse.json({ ok: true, cajas, pares });
}

/**
 * Agrega un renglón que la proforma no traía (o que se leyó mal y se
 * quitó). Si es de corrida y el pedido ya tiene la corrida de ese modelo y
 * color, se toma su receta; si no, queda sin receta hasta capturarla en
 * Corridas, como cualquier caja opaca.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contexto(id);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  const body = await req.json().catch(() => null);
  const modelo = limpiarTexto(body?.modelo);
  const color = limpiarTexto(body?.color);
  const talla = limpiarTalla(body?.talla);
  const cajas = Math.max(0, Math.round(Number(body?.cajas) || 0));
  let paresPorCaja = Math.max(0, Math.round(Number(body?.paresPorCaja) || 0));

  if (!modelo) return NextResponse.json({ error: "Falta el modelo." }, { status: 400 });
  if (talla === null) {
    return NextResponse.json({ error: "La talla tiene que ser un número (24, 25.5) o quedar vacía para corrida." }, { status: 400 });
  }
  if (cajas <= 0) return NextResponse.json({ error: "Las cajas tienen que ser más de cero." }, { status: 400 });
  if (await renglonRepetido(c.supabase, c.pedido.id, modelo, color, talla)) {
    return NextResponse.json(
      { error: `El pedido ya tiene un renglón ${modelo} ${color}${talla ? ` talla ${talla}` : ""}: edítale las cajas.` },
      { status: 400 },
    );
  }

  let tallas: Record<string, number> = {};
  if (talla) {
    if (paresPorCaja <= 0) {
      return NextResponse.json({ error: "Una caja de talla única necesita sus pares por caja." }, { status: 400 });
    }
    tallas = { [talla]: cajas * paresPorCaja };
  } else {
    const { data: corrida } = await c.supabase
      .from("corridas")
      .select("tallas, total")
      .eq("account_id", c.cuenta.id)
      .eq("pedido", c.pedido.pedido)
      .eq("modelo", modelo)
      .eq("color", color)
      .maybeSingle();
    if (corrida) {
      tallas = (corrida.tallas ?? {}) as Record<string, number>;
      paresPorCaja = corrida.total ?? Object.values(tallas).reduce((a, b) => a + (Number(b) || 0), 0);
    }
  }

  const { data: nueva, error } = await c.supabase
    .from("pedido_lineas")
    .insert({
      pedido_id: c.pedido.id,
      modelo,
      color,
      talla,
      tallas,
      pares_por_caja: paresPorCaja,
      cajas,
      pares: cajas * paresPorCaja,
    })
    .select("id")
    .single();
  if (error || !nueva) return NextResponse.json({ error: error?.message ?? "No se pudo agregar." }, { status: 400 });

  await recalcularEstadoPedido(c.supabase, c.pedido.id);
  invalidarInventario(c.cuenta.id);
  await invalidar(c.supabase, c.cuenta.id, `Se agregó un renglón al pedido ${c.pedido.pedido}.`);

  return NextResponse.json({
    ok: true,
    id: nueva.id,
    sinCorrida: !talla && !Object.keys(tallas).length,
  });
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
