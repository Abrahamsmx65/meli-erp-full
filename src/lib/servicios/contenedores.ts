/**
 * Contenedores en tránsito.
 *
 * La llave del negocio es `numero`: NUESTRO propio ID de contenedor, el que
 * se usa en las conversaciones con la fábrica y el agente aduanal. El número
 * que da la naviera va aparte (`numero_naviera`), solo para rastreo.
 *
 * Confirmar la llegada de un contenedor NO da de alta existencias: el
 * inventario de bodega llega del API de Industher. Aquí solo se deja de
 * contar como "en camino".
 */
import type { DB } from "../datos/repos";
import { recalcularEstadoPedido } from "./pedidos";

export interface ContenedorVista {
  id: string;
  numero: string;
  numeroNaviera: string | null;
  naviera: string | null;
  fechaSalida: string | null;
  llegadaEst: string | null;
  llegadaReal: string | null;
  almacenDestino: string | null;
  estado: string;
  notas: string | null;
  cajas: number;
  pedidos: { pedido: string; cajas: number }[];
}

export async function listarContenedores(db: DB, accountId: string): Promise<ContenedorVista[]> {
  const { data: conts } = await db
    .from("contenedores")
    .select(
      "id, numero, numero_naviera, naviera, fecha_salida, fecha_llegada_est, fecha_llegada_real, almacen_destino, estado, notas, contenedor_lineas(cajas, pedido_linea_id)",
    )
    .eq("account_id", accountId)
    .order("fecha_llegada_est", { ascending: true, nullsFirst: false });

  if (!conts?.length) return [];

  // Amarrar cada renglón del contenedor con SU pedido, para decir qué trae.
  const lineaIds = [
    ...new Set(
      conts.flatMap((c: any) =>
        ((c.contenedor_lineas ?? []) as { pedido_linea_id: string }[]).map(
          (l) => l.pedido_linea_id,
        ),
      ),
    ),
  ];

  const { data: lineas } = lineaIds.length
    ? await db.from("pedido_lineas").select("id, pedido_id").in("id", lineaIds)
    : { data: [] as { id: string; pedido_id: string }[] };

  const pedidoIds = [...new Set((lineas ?? []).map((l) => l.pedido_id))];
  const { data: pedidos } = pedidoIds.length
    ? await db.from("pedidos").select("id, pedido").in("id", pedidoIds)
    : { data: [] as { id: string; pedido: string }[] };

  const nombrePedido = new Map((pedidos ?? []).map((p) => [p.id, p.pedido]));
  const pedidoDeLinea = new Map((lineas ?? []).map((l) => [l.id, l.pedido_id]));

  return conts.map((c: any) => {
    const porPedido = new Map<string, number>();
    let cajas = 0;
    for (const cl of (c.contenedor_lineas ?? []) as { cajas: number; pedido_linea_id: string }[]) {
      cajas += cl.cajas ?? 0;
      const nombre = nombrePedido.get(pedidoDeLinea.get(cl.pedido_linea_id) ?? "");
      if (!nombre) continue;
      porPedido.set(nombre, (porPedido.get(nombre) ?? 0) + (cl.cajas ?? 0));
    }
    return {
      id: c.id,
      numero: c.numero,
      numeroNaviera: c.numero_naviera ?? null,
      naviera: c.naviera ?? null,
      fechaSalida: c.fecha_salida ?? null,
      llegadaEst: c.fecha_llegada_est ?? null,
      llegadaReal: c.fecha_llegada_real ?? null,
      almacenDestino: c.almacen_destino ?? null,
      estado: c.estado,
      notas: c.notas ?? null,
      cajas,
      pedidos: [...porPedido.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([pedido, cajasP]) => ({ pedido, cajas: cajasP })),
    };
  });
}

/* -------------------------------------------------------------------------- */

export interface DatosContenedor {
  numero: string;
  numeroNaviera?: string | null;
  naviera?: string | null;
  fechaSalida?: string | null;
  fechaLlegadaEst?: string | null;
  estado?: string | null;
  notas?: string | null;
}

/**
 * Da de alta el contenedor (o reusa el que ya existe con ese número: es
 * normal irle agregando pedidos) y pone las cajas de cada renglón de pedido
 * que se manden. Misma regla que la ventana manual: nunca se embarca más de
 * lo que el pedido tiene menos lo que ya va en OTROS contenedores, y un 0
 * quita el renglón de este contenedor.
 */
export async function asignarCajasAContenedor(
  db: DB,
  accountId: string,
  datos: DatosContenedor,
  asignaciones: { pedidoLineaId: string; cajas: number }[],
): Promise<{
  contenedorId: string;
  numero: string;
  existia: boolean;
  recortes: string[];
  pedidosTocados: string[];
}> {
  const numero = datos.numero.trim().toUpperCase();
  if (!numero) throw new Error("Falta el número de contenedor.");

  const { data: existente } = await db
    .from("contenedores")
    .select("id")
    .eq("account_id", accountId)
    .eq("numero", numero)
    .maybeSingle();

  let contenedorId = existente?.id as string | undefined;

  if (!contenedorId) {
    const { data, error } = await db
      .from("contenedores")
      .insert({
        account_id: accountId,
        numero,
        numero_naviera: datos.numeroNaviera || null,
        naviera: datos.naviera || null,
        fecha_salida: datos.fechaSalida || null,
        fecha_llegada_est: datos.fechaLlegadaEst || null,
        estado: datos.estado || "en_transito",
        notas: datos.notas || null,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`No se pudo crear el contenedor: ${error?.message ?? "sin detalle"}`);
    }
    contenedorId = data.id;
  } else {
    // Solo se pisa lo que venga con valor: reusar no borra lo capturado.
    const cambios: Record<string, unknown> = {};
    if (datos.numeroNaviera) cambios.numero_naviera = datos.numeroNaviera;
    if (datos.naviera) cambios.naviera = datos.naviera;
    if (datos.fechaSalida) cambios.fecha_salida = datos.fechaSalida;
    if (datos.fechaLlegadaEst) cambios.fecha_llegada_est = datos.fechaLlegadaEst;
    if (datos.estado) cambios.estado = datos.estado;
    if (datos.notas) cambios.notas = datos.notas;
    if (Object.keys(cambios).length) {
      await db.from("contenedores").update(cambios).eq("id", contenedorId);
    }
  }

  const recortes: string[] = [];
  const pedidosTocados = new Set<string>();

  for (const a of asignaciones) {
    if (!a?.pedidoLineaId) continue;
    const cajas = Math.max(0, Math.round(Number(a.cajas) || 0));

    const { data: linea } = await db
      .from("pedido_lineas")
      .select("id, pedido_id, modelo, color, talla, cajas, pedidos!inner(account_id)")
      .eq("id", a.pedidoLineaId)
      .maybeSingle();
    if (!linea || (linea.pedidos as unknown as { account_id?: string })?.account_id !== accountId) {
      continue;
    }

    const { data: yaAsignado } = await db
      .from("contenedor_lineas")
      .select("cajas, contenedor_id")
      .eq("pedido_linea_id", linea.id);

    const enOtros = (yaAsignado ?? [])
      .filter((x) => x.contenedor_id !== contenedorId)
      .reduce((s, x) => s + (x.cajas ?? 0), 0);
    const tope = Math.max(0, (linea.cajas ?? 0) - enOtros);
    const finales = Math.min(cajas, tope);
    if (finales < cajas) {
      recortes.push(
        `${linea.modelo} ${linea.color}${linea.talla ? ` T${linea.talla}` : ""}: solo caben ${finales} (pedido ${linea.cajas ?? 0}, en otros contenedores ${enOtros}).`,
      );
    }

    if (finales <= 0) {
      await db
        .from("contenedor_lineas")
        .delete()
        .eq("contenedor_id", contenedorId)
        .eq("pedido_linea_id", linea.id);
    } else {
      const { error } = await db.from("contenedor_lineas").upsert(
        { contenedor_id: contenedorId, pedido_linea_id: linea.id, cajas: finales },
        { onConflict: "contenedor_id,pedido_linea_id" },
      );
      if (error) throw new Error(`No se pudo guardar ${linea.modelo} ${linea.color}: ${error.message}`);
    }
    pedidosTocados.add(linea.pedido_id);
  }

  for (const pid of pedidosTocados) {
    await recalcularEstadoPedido(db, pid);
  }

  return {
    contenedorId: contenedorId as string,
    numero,
    existia: Boolean(existente),
    recortes,
    pedidosTocados: [...pedidosTocados],
  };
}
