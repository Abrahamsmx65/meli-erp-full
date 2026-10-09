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
import { porTandas, traerTodo, type DB } from "../datos/repos";
import { recalcularEstadoPedido } from "./pedidos";

// Los tipos y las funciones puras de la vista viven en un módulo sin
// dependencias del servidor: la tabla del navegador los importa de ahí sin
// arrastrar la base ni los servicios a su paquete. Se reexportan aquí.
export {
  detalleModelos,
  leerPendientes,
  modelosDeContenedor,
  resumenModelos,
  type ContenedorVista,
  type PendientePacking,
} from "./contenedores-vista";
import { leerPendientes, modelosDeContenedor, type ContenedorVista } from "./contenedores-vista";

export async function listarContenedores(db: DB, accountId: string): Promise<ContenedorVista[]> {
  // traerTodo pagina (PostgREST corta en 1,000 filas SIN avisar) y ordena
  // por la llave; el orden por llegada se rehace aquí (nulos al final).
  // Los nombres de los pedidos de la cuenta se piden A LA PAR de los
  // contenedores (antes eran el cuarto salto en fila, después de las líneas).
  const [conts, pedidos] = await Promise.all([
    traerTodo<any>(
      db,
      "contenedores",
      "id, numero, numero_naviera, naviera, fecha_salida, fecha_llegada_est, fecha_llegada_real, almacen_destino, estado, notas, pendientes",
      (q) => q.eq("account_id", accountId),
    ),
    traerTodo<{ id: string; pedido: string }>(db, "pedidos", "id, pedido", (q) => q.eq("account_id", accountId)),
  ]);
  conts.sort((a, b) =>
    String(a.fecha_llegada_est ?? "9999").localeCompare(String(b.fecha_llegada_est ?? "9999")),
  );

  if (!conts?.length) return [];

  // contenedor_lineas DIRECTO, no embebido: el tope db-max-rows también
  // corta los recursos embebidos y sin señal (HTTP 200; PostgREST #2776).
  const contLineas = await porTandas(conts.map((c: any) => c.id as string), 200, (tanda) =>
    traerTodo<{ contenedor_id: string; pedido_linea_id: string; cajas: number | null }>(
      db,
      "contenedor_lineas",
      "contenedor_id, pedido_linea_id, cajas",
      (q) => q.in("contenedor_id", tanda),
    ),
  );

  // Amarrar cada renglón del contenedor con SU pedido, para decir qué trae.
  // Tandas de 500 ids: id es único, así que cada tanda regresa a lo más 500
  // filas y ni el tope ni el largo de la URL alcanzan a morder.
  const lineaIds = [...new Set(contLineas.map((l) => l.pedido_linea_id))];
  const lineas = await porTandas(lineaIds, 500, async (tanda) => {
    const { data, error } = await db
      .from("pedido_lineas")
      .select("id, pedido_id, modelo, color, cajas, pares")
      .in("id", tanda);
    if (error) throw new Error(`pedido_lineas: ${error.message}`);
    return (data ?? []) as {
      id: string;
      pedido_id: string;
      modelo: string;
      color: string | null;
      cajas: number | null;
      pares: number | null;
    }[];
  });

  const nombrePedido = new Map((pedidos ?? []).map((p) => [p.id, p.pedido]));
  const pedidoDeLinea = new Map((lineas ?? []).map((l) => [l.id, l.pedido_id]));
  const lineaPorId = new Map((lineas ?? []).map((l) => [l.id, l]));
  const lineasPorCont = new Map<string, { cajas: number | null; pedido_linea_id: string }[]>();
  for (const cl of contLineas) {
    const lista = lineasPorCont.get(cl.contenedor_id) ?? [];
    lista.push(cl);
    lineasPorCont.set(cl.contenedor_id, lista);
  }

  return conts.map((c: any) => {
    const porPedido = new Map<string, number>();
    let cajas = 0;
    for (const cl of lineasPorCont.get(c.id) ?? []) {
      cajas += cl.cajas ?? 0;
      const nombre = nombrePedido.get(pedidoDeLinea.get(cl.pedido_linea_id) ?? "");
      if (!nombre) continue;
      porPedido.set(nombre, (porPedido.get(nombre) ?? 0) + (cl.cajas ?? 0));
    }
    // Pares por caja del renglón del pedido: lo que embarca el contenedor
    // son cajas, y los pares se derivan de la receta del pedido.
    const modelos = modelosDeContenedor(
      (lineasPorCont.get(c.id) ?? []).flatMap((cl) => {
        const l = lineaPorId.get(cl.pedido_linea_id);
        if (!l) return [];
        const paresPorCaja = (l.cajas ?? 0) > 0 && (l.pares ?? 0) > 0 ? (l.pares ?? 0) / (l.cajas ?? 1) : 0;
        return [{ modelo: l.modelo, color: l.color, cajas: cl.cajas ?? 0, paresPorCaja }];
      }),
    );
    return {
      modelos,
      pendientes: leerPendientes(c.pendientes),
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

export interface AsignacionCaja {
  pedidoLineaId: string;
  cajas: number;
  /**
   * Medidas (cm) y peso bruto (kg) de la caja, cuando vienen del packing
   * list de la fábrica. Si no vienen, no se tocan las que ya tenga el renglón.
   */
  medidas?: { largoCm: number; anchoCm: number; altoCm: number } | null;
  pesoKg?: number | null;
}

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
  asignaciones: AsignacionCaja[],
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
      const fila: Record<string, unknown> = { contenedor_id: contenedorId, pedido_linea_id: linea.id, cajas: finales };
      if (a.medidas) {
        fila.largo_cm = a.medidas.largoCm;
        fila.ancho_cm = a.medidas.anchoCm;
        fila.alto_cm = a.medidas.altoCm;
      }
      if (a.pesoKg != null && a.pesoKg > 0) fila.peso_kg = a.pesoKg;
      const { error } = await db.from("contenedor_lineas").upsert(fila, { onConflict: "contenedor_id,pedido_linea_id" });
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
