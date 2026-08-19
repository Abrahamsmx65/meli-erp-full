/**
 * Pedidos a China.
 *
 * Ciclo: se carga la proforma -> se confirma -> queda CREADO (sin contenedor)
 * -> se le asigna uno o varios contenedores -> EN TRÁNSITO -> RECIBIDO.
 *
 * Una decisión importante: al recibirse un contenedor NO se dan de alta
 * existencias. El inventario de bodega sigue saliendo del reporte de
 * existencias, que es el que refleja lo que de verdad está en el piso. Si el
 * sistema además creara sus propios renglones, el mismo producto se contaría
 * dos veces el día que el almacén lo reporte. Lo que sí hace el pedido es
 * decir qué viene en camino y cuándo.
 */
import { canonizar } from "../importar/sku";
import type { Proforma } from "../importar/proforma";
import type { DB } from "../datos/repos";

export type EstadoPedido = "creado" | "con_contenedor" | "en_transito" | "recibido" | "cancelado";

export interface PedidoResumen {
  id: string;
  pedido: string;
  proveedor: string | null;
  fechaPi: string | null;
  estado: EstadoPedido;
  cajas: number;
  pares: number;
  modelos: number;
  cajasAsignadas: number;
  contenedores: { numero: string; estado: string; llegadaEst: string | null; cajas: number }[];
  creadoEn: string;
}

/**
 * Guarda una proforma ya confirmada.
 *
 * Da de alta tres cosas de un jalón: el pedido, sus renglones, y LAS CORRIDAS.
 * Esto último es lo que evita la captura a mano: la proforma ya trae el
 * reparto de tallas por caja, así que el pedido nuevo llega con sus corridas
 * puestas y el planeador puede usarlo desde el primer día.
 */
export async function guardarProforma(
  db: DB,
  accountId: string,
  proforma: Proforma,
  opts?: { fechaPi?: string | null; notas?: string | null; archivo?: string | null },
): Promise<{ pedidoId: string; corridasCreadas: number; lineasCreadas: number }> {
  const { data: existente } = await db
    .from("pedidos")
    .select("id")
    .eq("account_id", accountId)
    .eq("pedido", proforma.pedido)
    .maybeSingle();

  if (existente) {
    throw new Error(
      `El pedido ${proforma.pedido} ya está cargado. Bórralo primero si quieres volver a subirlo.`,
    );
  }

  const { data: pedido, error } = await db
    .from("pedidos")
    .insert({
      account_id: accountId,
      pedido: proforma.pedido,
      proveedor: proforma.proveedor,
      fecha_pi: opts?.fechaPi ?? null,
      importe: proforma.totales.importe,
      estado: "creado",
      notas: opts?.notas ?? null,
      archivo: opts?.archivo ?? null,
    })
    .select("id")
    .single();

  if (error || !pedido) {
    throw new Error(`No se pudo crear el pedido: ${error?.message ?? "sin detalle"}`);
  }

  // Renglones. Si la proforma repite modelo+color, se suman las cajas: la
  // tabla tiene una restricción de unicidad ahí y fallaría al insertar.
  const porClave = new Map<string, (typeof proforma.lineas)[number]>();
  for (const l of proforma.lineas) {
    if (l.unitalla) continue;
    const k = `${canonizar(l.modelo)}|${canonizar(l.color)}`;
    const previa = porClave.get(k);
    if (previa) {
      previa.cajas += l.cajas;
      previa.pares += l.pares;
    } else {
      porClave.set(k, { ...l });
    }
  }

  // Solo las líneas de corrida definen la corrida del modelo. Se aparta la
  // lista ANTES de sumarle las unitallas.
  const lineasDeCorrida = [...porClave.values()];

  // Las cajas unitalla se resumen en un renglón por modelo+color, con los
  // pares TOTALES por talla (cajas de una talla = pares ÷ pares por caja).
  // Si el mismo color también trae corrida, sus totales se suman ahí.
  const unitallas = new Map<string, (typeof proforma.lineas)[number]>();
  for (const l of proforma.lineas) {
    if (!l.unitalla) continue;
    const k = `${canonizar(l.modelo)}|${canonizar(l.color)}`;
    const enCorrida = porClave.get(k);
    if (enCorrida && !unitallas.has(k)) {
      enCorrida.cajas += l.cajas;
      enCorrida.pares += l.pares;
      continue;
    }
    const acc =
      unitallas.get(k) ??
      ({
        ...l,
        tallas: {},
        cajas: 0,
        pares: 0,
        descripcion: `${l.descripcion || ""} (cajas de una sola talla)`.trim(),
      } as (typeof proforma.lineas)[number]);
    acc.tallas[l.unitalla] = (acc.tallas[l.unitalla] ?? 0) + l.pares;
    acc.cajas += l.cajas;
    acc.pares += l.pares;
    unitallas.set(k, acc);
  }

  const lineas = [...lineasDeCorrida, ...unitallas.values()];

  const { error: errLineas } = await db.from("pedido_lineas").insert(
    lineas.map((l) => ({
      pedido_id: pedido.id,
      modelo: l.modelo,
      color: l.color,
      descripcion: l.descripcion || null,
      tallas: l.tallas,
      pares_por_caja: l.paresPorCaja,
      cajas: l.cajas,
      pares: l.pares,
      precio_unitario: l.precioUnitario,
    })),
  );
  if (errLineas) throw new Error(`No se pudieron guardar los renglones: ${errLineas.message}`);

  // Las corridas. Aquí está el ahorro: se dan de alta solas. Las unitallas
  // quedan fuera: una caja de pura talla 24 no es la corrida del modelo.
  const { error: errCorridas } = await db.from("corridas").upsert(
    lineasDeCorrida.map((l) => ({
      account_id: accountId,
      pedido: proforma.pedido,
      modelo: l.modelo,
      color: l.color,
      tallas: l.tallas,
      total: l.paresPorCaja,
      origen: "proforma",
      actualizado_en: new Date().toISOString(),
    })),
    { onConflict: "account_id,pedido,modelo,color" },
  );
  if (errCorridas) {
    throw new Error(`El pedido se creó pero las corridas no: ${errCorridas.message}`);
  }

  return {
    pedidoId: pedido.id,
    lineasCreadas: lineas.length,
    corridasCreadas: lineasDeCorrida.length,
  };
}

export async function listarPedidos(db: DB, accountId: string): Promise<PedidoResumen[]> {
  const { data: pedidos } = await db
    .from("pedidos")
    .select("id, pedido, proveedor, fecha_pi, estado, creado_en")
    .eq("account_id", accountId)
    .order("creado_en", { ascending: false });

  if (!pedidos?.length) return [];

  const ids = pedidos.map((p) => p.id);

  const [{ data: lineas }, { data: contenedores }] = await Promise.all([
    db.from("pedido_lineas").select("id, pedido_id, modelo, cajas, pares").in("pedido_id", ids),
    db
      .from("contenedores")
      .select("id, numero, estado, fecha_llegada_est, contenedor_lineas(cajas, pedido_linea_id)")
      .eq("account_id", accountId),
  ]);

  const lineasPorPedido = new Map<string, { cajas: number; pares: number; modelos: Set<string> }>();
  const pedidoDeLinea = new Map<string, string>();

  for (const l of lineas ?? []) {
    pedidoDeLinea.set(l.id, l.pedido_id);
    const acc =
      lineasPorPedido.get(l.pedido_id) ?? { cajas: 0, pares: 0, modelos: new Set<string>() };
    acc.cajas += l.cajas ?? 0;
    acc.pares += l.pares ?? 0;
    acc.modelos.add(l.modelo);
    lineasPorPedido.set(l.pedido_id, acc);
  }

  // Qué contenedores tocan qué pedido, y con cuántas cajas.
  const contPorPedido = new Map<
    string,
    Map<string, { numero: string; estado: string; llegadaEst: string | null; cajas: number }>
  >();

  for (const c of contenedores ?? []) {
    for (const cl of (c.contenedor_lineas ?? []) as { cajas: number; pedido_linea_id: string }[]) {
      const pedidoId = pedidoDeLinea.get(cl.pedido_linea_id);
      if (!pedidoId) continue;
      const mapa = contPorPedido.get(pedidoId) ?? new Map();
      const prev = mapa.get(c.id) ?? {
        numero: c.numero,
        estado: c.estado,
        llegadaEst: c.fecha_llegada_est,
        cajas: 0,
      };
      prev.cajas += cl.cajas ?? 0;
      mapa.set(c.id, prev);
      contPorPedido.set(pedidoId, mapa);
    }
  }

  return pedidos.map((p) => {
    const agg = lineasPorPedido.get(p.id);
    const conts = [...(contPorPedido.get(p.id)?.values() ?? [])];
    return {
      id: p.id,
      pedido: p.pedido,
      proveedor: p.proveedor,
      fechaPi: p.fecha_pi,
      estado: p.estado as EstadoPedido,
      cajas: agg?.cajas ?? 0,
      pares: agg?.pares ?? 0,
      modelos: agg?.modelos.size ?? 0,
      cajasAsignadas: conts.reduce((a, c) => a + c.cajas, 0),
      contenedores: conts,
      creadoEn: p.creado_en,
    };
  });
}

/**
 * Recalcula el estado de un pedido a partir de sus contenedores.
 *
 * El estado no se captura a mano: se deduce de los hechos. Un pedido con
 * todas sus cajas asignadas a contenedores ya llegados está recibido, aunque
 * nadie haya ido a marcarlo.
 */
export async function recalcularEstadoPedido(db: DB, pedidoId: string): Promise<EstadoPedido> {
  const { data: lineas } = await db
    .from("pedido_lineas")
    .select("id, cajas")
    .eq("pedido_id", pedidoId);

  const totalCajas = (lineas ?? []).reduce((a, l) => a + (l.cajas ?? 0), 0);
  const ids = (lineas ?? []).map((l) => l.id);

  if (!ids.length) return "creado";

  const { data: asignaciones } = await db
    .from("contenedor_lineas")
    .select("cajas, contenedores(estado)")
    .in("pedido_linea_id", ids);

  const asignadas = (asignaciones ?? []).reduce((a, x) => a + (x.cajas ?? 0), 0);
  const recibidas = (asignaciones ?? [])
    .filter((x) => (x.contenedores as unknown as { estado?: string })?.estado === "recibido")
    .reduce((a, x) => a + (x.cajas ?? 0), 0);

  let estado: EstadoPedido = "creado";
  if (asignadas === 0) estado = "creado";
  else if (recibidas >= totalCajas && totalCajas > 0) estado = "recibido";
  else if (asignadas >= totalCajas) estado = "en_transito";
  else estado = "con_contenedor";

  await db
    .from("pedidos")
    .update({ estado, actualizado_en: new Date().toISOString() })
    .eq("id", pedidoId);

  return estado;
}
