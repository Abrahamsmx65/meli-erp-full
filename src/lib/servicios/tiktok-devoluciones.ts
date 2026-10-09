/**
 * Devoluciones de TikTok Shop: leerlas de TikTok, guardarlas masticadas y
 * confirmar el paquete recibido.
 *
 * El cron de TikTok (cada 15 min) baja las devoluciones de la ventana y las
 * deja en `tiktok_devoluciones`; la pantalla solo lee la tabla. Al confirmar
 * un paquete, el ERP le avisa a TikTok (`APPROVE_RECEIVED_PACKAGE`, con eso
 * reembolsa al cliente) y mueve el kardex según lo que decidió quien recibió:
 * el par vuelve al stock (devolución) o se tira (devolución + merma). Los
 * paquetes llegan a Industher, así que su foto cuenta el par y el kardex
 * cuadra solo; a TikTok se le vuelve a ofrecer en la siguiente publicación.
 * Decisión del dueño, 9-oct-2026.
 */
import { porTandas, traerTodo, type DB } from "../datos/repos";
import { buscarDevoluciones, confirmarPaqueteDevuelto } from "../tiktok/api";
import {
  ACCION_CONFIRMAR_PAQUETE,
  ESTADO_CLIENTE_ENVIO,
  movimientosDeDecision,
  normalizarDevolucion,
  ordenarDevoluciones,
  type DecisionDevolucion,
  type Devolucion,
  type RenglonDevolucion,
} from "../tiktok/devoluciones";
import { clienteDeCuenta, registrarMovimientos, sincronizarTikTok } from "./tiktok";

/** Desde cuándo se leen devoluciones la primera vez (dueño: «dame todo septiembre»). */
export const DEVOLUCIONES_DESDE = "2026-09-01T06:00:00.000Z";
/** Ventana que se relee en cada corrida: una devolución vive semanas entre que se pide y se cierra. */
export const DIAS_VENTANA_DEVOLUCIONES = 60;
const TANDA_IDS = 300;

export interface DevolucionGuardada extends Devolucion {
  id: number;
  decisiones: DecisionDevolucion[];
  confirmadaEn: string | null;
  confirmadaPor: string | null;
  error: string | null;
  /** número de corte del pedido, si salió en uno */
  corte: number | null;
}

function aFila(accountId: string, d: Devolucion, crudo: unknown) {
  return {
    account_id: accountId,
    return_id: d.returnId,
    order_id: d.orderId,
    estado: d.estado,
    tipo: d.tipo,
    siguiente_accion: d.siguienteAccion,
    plazo: d.plazo,
    guia: d.guia,
    paqueteria: d.paqueteria,
    motivo: d.motivo,
    motivo_texto: d.motivoTexto,
    reembolso: d.reembolso,
    moneda: d.moneda,
    renglones: d.renglones,
    creada_tiktok_en: d.creadaEn,
    actualizada_tiktok_en: d.actualizadaEn,
    crudo,
    leida_en: new Date().toISOString(),
  };
}

function deFila(f: any): DevolucionGuardada {
  return {
    id: Number(f.id),
    returnId: String(f.return_id),
    orderId: String(f.order_id),
    estado: String(f.estado ?? ""),
    tipo: f.tipo ?? null,
    siguienteAccion: f.siguiente_accion ?? null,
    plazo: f.plazo ?? null,
    guia: f.guia ?? null,
    paqueteria: f.paqueteria ?? null,
    motivo: f.motivo ?? null,
    motivoTexto: f.motivo_texto ?? null,
    reembolso: f.reembolso != null ? Number(f.reembolso) : null,
    moneda: f.moneda ?? null,
    renglones: (f.renglones ?? []) as RenglonDevolucion[],
    creadaEn: f.creada_tiktok_en ?? null,
    actualizadaEn: f.actualizada_tiktok_en ?? null,
    decisiones: (f.decisiones ?? []) as DecisionDevolucion[],
    confirmadaEn: f.confirmada_en ?? null,
    confirmadaPor: f.confirmada_por ?? null,
    error: f.error ?? null,
    corte: f.corte ?? null,
  };
}

/** El SKU del ERP de cada renglón de pedido (`line_item_id` → `sku_interno`) de estos pedidos. */
async function skusPorRenglonDePedido(db: DB, accountId: string, orderIds: string[]): Promise<Map<string, string>> {
  const filas = await porTandas([...new Set(orderIds)], TANDA_IDS, (tanda) =>
    traerTodo<any>(db, "tiktok_orden_items", "line_item_id, sku_interno", (q) => q.eq("account_id", accountId).in("order_id", tanda)),
  );
  const mapa = new Map<string, string>();
  for (const f of filas ?? []) if (f.line_item_id != null && f.sku_interno) mapa.set(String(f.line_item_id), String(f.sku_interno));
  return mapa;
}

export interface ResultadoSyncDevoluciones {
  leidas: number;
  guardadas: number;
  sinSku: number;
  completo: boolean;
  paginas: number;
  error: string | null;
}

/**
 * Baja de TikTok las devoluciones creadas en la ventana y las guarda. Solo
 * se pisan los campos que vienen de TikTok: las decisiones y la constancia
 * de confirmación del ERP se conservan.
 */
export async function sincronizarDevoluciones(
  admin: any,
  accountId: string,
  opciones: { msPresupuesto?: number } = {},
): Promise<ResultadoSyncDevoluciones> {
  const inicio = new Date().toISOString();
  const r: ResultadoSyncDevoluciones = { leidas: 0, guardadas: 0, sinSku: 0, completo: false, paginas: 0, error: null };
  try {
    const cliente = await clienteDeCuenta(admin, accountId, opciones.msPresupuesto ?? 60_000);
    if (!cliente || !cliente.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
    const desdeMs = Math.max(Date.parse(DEVOLUCIONES_DESDE), Date.now() - DIAS_VENTANA_DEVOLUCIONES * 86_400_000);
    const b = await buscarDevoluciones(cliente, { desdeMs });
    r.leidas = b.devoluciones.length;
    r.completo = b.completo;
    r.paginas = b.paginas;
    if (b.devoluciones.length) {
      const skus = await skusPorRenglonDePedido(admin, accountId, b.devoluciones.map((x) => String(x?.order_id ?? "")));
      const filas = [];
      for (const crudo of b.devoluciones) {
        const d = normalizarDevolucion(crudo, skus);
        if (!d.returnId || !d.orderId) continue;
        if (d.renglones.some((x) => !x.sku)) r.sinSku++;
        filas.push(aFila(accountId, d, crudo));
      }
      for (let i = 0; i < filas.length; i += 200) {
        const { error } = await admin.from("tiktok_devoluciones").upsert(filas.slice(i, i + 200), { onConflict: "account_id,return_id" });
        if (error) throw new Error(`tiktok_devoluciones: ${error.message}`);
        r.guardadas += Math.min(200, filas.length - i);
      }
    }
  } catch (err) {
    r.error = (err as Error).message;
  }
  await admin
    .from("tiktok_sync_log")
    .insert({ account_id: accountId, tarea: "devoluciones", inicio, fin: new Date().toISOString(), estado: r.error ? "error" : "ok", detalle: r })
    .then(() => undefined, () => undefined);
  return r;
}

/** Todas las devoluciones guardadas de la cuenta, ordenadas para la pantalla. */
export async function listarDevoluciones(db: DB, accountId: string): Promise<DevolucionGuardada[]> {
  const filas = await traerTodo<any>(
    db,
    "tiktok_devoluciones",
    "id, return_id, order_id, estado, tipo, siguiente_accion, plazo, guia, paqueteria, motivo, motivo_texto, reembolso, moneda, renglones, decisiones, confirmada_en, confirmada_por, error, creada_tiktok_en, actualizada_tiktok_en",
    (q) => q.eq("account_id", accountId),
  );
  const lista = (filas ?? []).map(deFila);
  // El corte en que salió el pedido, para encontrarlo en Despacho.
  const ordenes = await porTandas([...new Set(lista.map((d) => d.orderId))], TANDA_IDS, (tanda) =>
    traerTodo<any>(db, "tiktok_ordenes", "order_id, corte_id", (q) => q.eq("account_id", accountId).in("order_id", tanda)),
  );
  const corteIds = [...new Set((ordenes ?? []).map((o: any) => o.corte_id).filter((x: any) => x != null))];
  const cortes = corteIds.length
    ? await traerTodo<any>(db, "tiktok_cortes", "id, numero", (q) => q.eq("account_id", accountId).in("id", corteIds))
    : [];
  const numeroDeCorte = new Map((cortes ?? []).map((c: any) => [Number(c.id), Number(c.numero)]));
  const cortePorPedido = new Map((ordenes ?? []).map((o: any) => [String(o.order_id), o.corte_id != null ? numeroDeCorte.get(Number(o.corte_id)) ?? null : null]));
  for (const d of lista) d.corte = cortePorPedido.get(d.orderId) ?? null;
  return ordenarDevoluciones(lista);
}

export interface ResultadoConfirmacion {
  returnId: string;
  movimientos: number;
  avisos: string[];
}

/**
 * Confirma en TikTok que el paquete devuelto llegó y mueve el kardex según
 * la decisión por par. TikTok primero: si rechaza, no se mueve nada y el
 * mensaje queda en el renglón. Después, la publicación a TikTok pasa por
 * `sincronizarTikTok` con `soloPedidos` (regla de oro: nunca se le escribe
 * sin leer antes sus pedidos recientes).
 */
export async function confirmarDevolucionRecibida(
  admin: any,
  accountId: string,
  returnId: string,
  decisiones: DecisionDevolucion[],
  usuario: string | null,
): Promise<ResultadoConfirmacion> {
  const { data: fila } = await admin
    .from("tiktok_devoluciones")
    .select("id, return_id, order_id, estado, tipo, siguiente_accion, plazo, guia, paqueteria, motivo, motivo_texto, reembolso, moneda, renglones, decisiones, confirmada_en, confirmada_por, error, creada_tiktok_en, actualizada_tiktok_en")
    .eq("account_id", accountId)
    .eq("return_id", returnId)
    .maybeSingle();
  if (!fila) throw new Error("Esa devolución no está en el ERP. Dale a «Actualizar» para leerla de TikTok.");
  const d = deFila(fila);
  if (d.confirmadaEn) throw new Error(`Esta devolución ya se confirmó el ${new Date(d.confirmadaEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}.`);
  if (d.estado !== ESTADO_CLIENTE_ENVIO && d.siguienteAccion !== ACCION_CONFIRMAR_PAQUETE) {
    throw new Error(`TikTok no está esperando que confirmes este paquete (estado ${d.estado}).`);
  }
  const limpias: DecisionDevolucion[] = [];
  for (const x of decisiones ?? []) {
    if (!x?.returnLineItemId || (x.destino !== "stock" && x.destino !== "basura")) continue;
    if (!limpias.some((y) => y.returnLineItemId === x.returnLineItemId)) limpias.push({ returnLineItemId: String(x.returnLineItemId), destino: x.destino });
  }
  const fecha = new Date().toISOString();
  const plan = movimientosDeDecision(d, limpias, fecha);
  if (plan.sinDecision.length) throw new Error(`Falta decidir qué se hace con ${plan.sinDecision.length} ${plan.sinDecision.length === 1 ? "par" : "pares"}.`);
  if (plan.sinSku.length) {
    throw new Error(
      `${plan.sinSku.length === 1 ? "Un par no tiene" : `${plan.sinSku.length} pares no tienen`} SKU del ERP (${plan.sinSku.map((r) => r.sellerSku ?? r.skuId ?? "?").join(", ")}): amárralo en Almacén TikTok antes de confirmar.`,
    );
  }

  const cliente = await clienteDeCuenta(admin, accountId, 60_000);
  if (!cliente || !cliente.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
  let respuesta: unknown;
  try {
    respuesta = await confirmarPaqueteDevuelto(cliente, returnId);
  } catch (err) {
    const mensaje = (err as Error).message;
    await admin.from("tiktok_devoluciones").update({ error: mensaje }).eq("id", d.id);
    throw new Error(`TikTok no aceptó la confirmación: ${mensaje}`);
  }

  const avisos: string[] = [];
  const r = await registrarMovimientos(admin, accountId, plan.movimientos, usuario);
  const { error } = await admin
    .from("tiktok_devoluciones")
    .update({ decisiones: limpias, confirmada_en: fecha, confirmada_por: usuario, respuesta_tiktok: respuesta ?? null, error: null })
    .eq("id", d.id);
  if (error) avisos.push(`La constancia no se guardó: ${error.message}`);
  // Lo que vuelve al stock se le ofrece a TikTok ya, pasando por la lectura de pedidos.
  if (plan.movimientos.some((m) => m.tipo === "devolucion")) {
    try {
      const s = await sincronizarTikTok(admin, accountId, { soloPedidos: true });
      avisos.push(...(s.avisos ?? []));
    } catch (err) {
      avisos.push(`No se pudo publicar a TikTok ahora (lo hace el cron): ${(err as Error).message}`);
    }
  }
  return { returnId, movimientos: r.registrados, avisos };
}
