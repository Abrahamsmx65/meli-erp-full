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
