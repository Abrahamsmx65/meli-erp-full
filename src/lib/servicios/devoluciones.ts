/**
 * Revisión de devoluciones y cancelaciones, orden por orden.
 *
 * El barrido de ventas escribe una orden el día que se paga y ahí se queda:
 * si el comprador la cancela a los tres días o la devuelve a las tres
 * semanas, la venta seguía contando y el neto también. Para que el corte del
 * mes sea exacto, cada orden se vuelve a leer DESPUÉS de vendida:
 *
 *   - `/orders/{id}` dice si sigue pagada o ya está cancelada.
 *   - `/collections/{pago}` (Mercado Pago, el mismo endpoint del que sale el
 *     neto) dice el estado del pago (approved / refunded / charged_back /
 *     in_mediation), cuánto se le devolvió al comprador
 *     (transaction_amount_refunded) y el neto tal como MP lo reporta HOY.
 *
 * Una orden se revisa dos veces: a los 10 días de vendida (cancelaciones y
 * devoluciones rápidas) y a los 40 (la ventana de devolución de MELI México
 * son 30 días desde la entrega). Al hacer el corte de un mes se revisa todo
 * lo que falte de ese mes sin esperar los plazos.
 *
 * Una orden que resultó CANCELADA saca su día del barrido otra vez
 * (`recalcularDiaVentas`): MELI ya no la devuelve como pagada, así que sus
 * renglones de venta desaparecen de ventas_diarias, y en ordenes_neto queda
 * marcada para que el corte no cuente su neto.
 */
import type { MeliClient } from "../meli/client";
import {
  leerPagoMercadoPago,
  pagosCobrablesCompletos,
  peorEstadoPago,
  resumirPagosMeli,
  type PagoMercadoPago,
} from "../meli/pagos";
import { traerTodo, type DB } from "../datos/repos";
import { claveItem } from "../meli/sync";
import { clienteDeCuenta, mapaItemSkuDe, recalcularDiaVentas } from "./webhooks";

/** Días de vendida a los que toca cada revisión. */
export const PRIMERA_REVISION_DIAS = 10;
export const SEGUNDA_REVISION_DIAS = 40;

export interface PagoLeido {
  /** approved | refunded | charged_back | in_mediation | cancelled | … ; null = no vino */
  estado: string | null;
  /** net_received_amount tal como MP lo reporta hoy; null = no vino */
  neto: number | null;
  /** lo devuelto al comprador */
  reembolsado: number;
}

/**
 * Lee un pago de Mercado Pago sin dar por hecho su forma exacta: el neto
 * llega arriba o dentro de `transaction_details`, y lo reembolsado como
 * `transaction_amount_refunded` o `amount_refunded`. Si viene envuelto en
 * `collection` (formato viejo), se desenvuelve.
 */
export function leerPago(crudo: unknown): PagoLeido {
  const pago = leerPagoMercadoPago(crudo);
  return {
    estado: pago.estado,
    neto: pago.neto,
    reembolsado: pago.reembolsado,
  };
}

export { peorEstadoPago };

/**
 * ¿A esta orden le toca revisión hoy? Primera a los 10 días, segunda a los
 * 40; `sinEsperar` (el corte del mes) revisa todo lo que lleve menos de dos.
 */
export function tocaRevision(
  fecha: string,
  revisiones: number,
  hoy: string,
  sinEsperar = false,
): boolean {
  if (revisiones >= 2) return false;
  if (sinEsperar) return true;
  const dias = Math.floor((Date.parse(hoy) - Date.parse(fecha)) / 86_400_000);
  if (revisiones === 0) return dias >= PRIMERA_REVISION_DIAS;
  return dias >= SEGUNDA_REVISION_DIAS;
}

export interface ResultadoRevision {
  revisadas: number;
  canceladas: number;
  devueltas: number;
  diasRebarridos: string[];
  /** órdenes del rango que siguen sin su revisión completa */
  quedan: number;
  errores: string[];
}

interface OrdenLeida {
  status?: string;
  payments?: { id?: number }[];
  order_items?: {
    quantity?: number;
    unit_price?: number;
    sale_fee?: number;
    item?: { id?: string; seller_sku?: string | null; seller_custom_field?: string | null; variation_id?: number | string | null };
  }[];
}

/** Los renglones (sku, unidades, importe, comisión) de una orden leída de MELI. */
function renglonesDe(orden: OrdenLeida, mapaItemSku: Map<string, string>): { sku: string; unidades: number; importe: number; comision: number }[] {
  const porSku = new Map<string, { sku: string; unidades: number; importe: number; comision: number }>();
  for (const oi of orden.order_items ?? []) {
    const sku =
      oi.item?.seller_sku?.trim() ||
      oi.item?.seller_custom_field?.trim() ||
      (oi.item?.id ? mapaItemSku.get(claveItem(oi.item.id, oi.item.variation_id)) : undefined) ||
      (oi.item?.id ? mapaItemSku.get(oi.item.id) : undefined);
    if (!sku) continue;
    const u = oi.quantity ?? 0;
    const r = porSku.get(sku) ?? { sku, unidades: 0, importe: 0, comision: 0 };
    r.unidades += u;
    r.importe = Math.round((r.importe + u * (oi.unit_price ?? 0)) * 100) / 100;
    r.comision = Math.round((r.comision + u * (oi.sale_fee ?? 0)) * 100) / 100;
    porSku.set(sku, r);
  }
  return [...porSku.values()];
}

/**
 * Marca como canceladas las órdenes del rango que MELI ya reporta así.
 *
 * Va en BLOQUE porque es barato: `/orders/search` con order.status=cancelled
 * trae 51 por llamada, y las cancelaciones son pocas. Los días con
 * cancelaciones NUEVAS se vuelven a barrer para que sus renglones salgan de
 * la venta (MELI ya no las devuelve como pagadas).
 */
export async function marcarCanceladas(
  db: DB,
  accountId: string,
  cliente: MeliClient,
  opts: { desde: string; hasta: string; finMs: number; sellerId?: number },
): Promise<{ canceladas: number; nuevas: number; diasRebarridos: string[]; errores: string[] }> {
  const r = { canceladas: 0, nuevas: 0, diasRebarridos: [] as string[], errores: [] as string[] };
  let sellerId = opts.sellerId;
  if (sellerId == null) {
    const { data } = await db.from("meli_accounts").select("meli_user_id").eq("id", accountId).maybeSingle();
    sellerId = data?.meli_user_id;
  }
  if (sellerId == null) return r;

  const ids: number[] = [];
  let cursor = new Date(`${opts.desde}T00:00:00.000-06:00`);
  const fin = new Date(`${opts.hasta}T23:59:59.999-06:00`);
  while (cursor < fin && Date.now() < opts.finMs) {
    const sig = new Date(cursor);
    sig.setUTCDate(sig.getUTCDate() + 7);
    const hastaVentana = new Date(Math.min(+sig, +fin));
    for (let offset = 0; offset < 9_950; offset += 51) {
      let pagina: { results?: { id: number; status?: string }[] };
      try {
        pagina = await cliente.get("/orders/search", {
          seller: sellerId,
          "order.date_created.from": cursor.toISOString(),
          "order.date_created.to": hastaVentana.toISOString(),
          "order.status": "cancelled",
          sort: "date_asc",
          limit: 51,
          offset,
        });
      } catch (err) {
        r.errores.push(`canceladas ${cursor.toISOString().slice(0, 10)}: ${(err as Error).message}`.slice(0, 200));
        break;
      }
      const lote = pagina.results ?? [];
      for (const o of lote) if (o.status === "cancelled" || !o.status) ids.push(o.id);
      if (lote.length < 51) break;
    }
    cursor = sig;
  }
  r.canceladas = ids.length;
  if (!ids.length) return r;

  // Solo las que conocemos (tienen neto) y aún no estaban marcadas.
  const dias = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const tramo = ids.slice(i, i + 200);
    const { data } = await db
      .from("ordenes_neto")
      .select("order_id, fecha, estado")
      .eq("account_id", accountId)
      .in("order_id", tramo);
    const nuevas = (data ?? []).filter((f: any) => f.estado !== "cancelled");
    if (!nuevas.length) continue;
    const { error } = await db
      .from("ordenes_neto")
      .update({ estado: "cancelled", revisado_en: new Date().toISOString() })
      .eq("account_id", accountId)
      .in("order_id", nuevas.map((f: any) => f.order_id));
    if (error) {
      r.errores.push(`marcar canceladas: ${error.message}`);
      continue;
    }
    r.nuevas += nuevas.length;
    for (const f of nuevas) dias.add(f.fecha);
  }

  if (dias.size) {
    const mapaItemSku = await mapaItemSkuDe(db, accountId);
    for (const dia of [...dias].sort()) {
      if (Date.now() > opts.finMs) break;
      try {
        await recalcularDiaVentas(db, accountId, cliente, dia, mapaItemSku);
        r.diasRebarridos.push(dia);
      } catch (err) {
        r.errores.push(`re-barrido ${dia}: ${(err as Error).message}`.slice(0, 200));
      }
    }
  }
  return r;
}

/**
 * Relee el pago de cada orden del rango a la que le toca revisión (hasta
 * `tope` o hasta `finMs`): estado del pago, reembolso y neto de hoy. Con
 * `sinEsperar`, todas las que no tengan sus dos revisiones. Una llamada por
 * pago; `/orders/{id}` solo cuando la orden no tiene pagos guardados.
 */
export async function revisarOrdenes(
  db: DB,
  accountId: string,
  cliente: MeliClient,
  opts: { desde: string; hasta: string; tope: number; finMs: number; sinEsperar?: boolean },
): Promise<ResultadoRevision> {
  const hoy = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  const filas = await traerTodo<any>(
    db,
    "ordenes_neto",
    "order_id, payment_id, payment_ids, fecha, total, neto, neto_en, estado, revisiones, renglones, reembolso_incluido_neto_base, reembolso_base_confiable",
    (q) =>
      q
        .eq("account_id", accountId)
        .gte("fecha", opts.desde)
        .lte("fecha", opts.hasta)
        .lt("revisiones", 2),
  );
  let mapaItemSku: Map<string, string> | null = null;

  const pendientes = filas
    .filter((f) => tocaRevision(f.fecha, f.revisiones ?? 0, hoy, opts.sinEsperar))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  const r: ResultadoRevision = {
    revisadas: 0,
    canceladas: 0,
    devueltas: 0,
    diasRebarridos: [],
    quedan: pendientes.length,
    errores: [],
  };
  const diasARebarrer = new Set<string>();

  for (const f of pendientes.slice(0, opts.tope)) {
    if (Date.now() > opts.finMs) break;
    const orderId = Number(f.order_id);
    const idsPago = new Set<number>();
    for (const p of Array.isArray(f.payment_ids) ? f.payment_ids : []) if (p != null) idsPago.add(Number(p));
    if (f.payment_id != null) idsPago.add(Number(f.payment_id));

    let estado: string | null = f.estado ?? null;
    if (!idsPago.size || !estado) {
      try {
        const orden = await cliente.get<OrdenLeida>(`/orders/${orderId}`);
        for (const p of orden?.payments ?? []) if (p.id != null) idsPago.add(Number(p.id));
        estado = orden?.status ?? estado;
      } catch (err) {
        r.errores.push(`orden ${orderId}: ${(err as Error).message}`.slice(0, 200));
        continue;
      }
    }
    if (!estado) estado = "paid";

    const pagos: PagoMercadoPago[] = [];
    let pagosLeidos = 0;
    for (const pid of idsPago) {
      try {
        const crudo = await cliente.get<unknown>(`/collections/${pid}`);
        const pago = leerPagoMercadoPago(crudo);
        pagosLeidos++;
        pagos.push(pago);
      } catch (err) {
        r.errores.push(`pago ${pid}: ${(err as Error).message}`.slice(0, 200));
      }
    }
    // No certificar una lectura parcial: un solo pago faltante cambia neto,
    // cargos y estado de toda la orden.
    if (idsPago.size === 0 || pagosLeidos !== idsPago.size) continue;
    const cobrables = pagos.filter((p) => p.estado !== "rejected" && p.estado !== "cancelled");
    if (!pagosCobrablesCompletos(pagos) || (estado !== "cancelled" && cobrables.length === 0)) continue;

    const dias = Math.floor((Date.parse(hoy) - Date.parse(f.fecha)) / 86_400_000);
    // Una revisión tardía (ya pasados los 40 días) cierra las dos de un golpe.
    const revisiones = dias >= SEGUNDA_REVISION_DIAS ? 2 : Math.min(2, (f.revisiones ?? 0) + 1);
    const comisionOrden = Array.isArray(f.renglones)
      ? f.renglones.reduce((a: number, x: any) => a + (Number(x.comision) || 0), 0)
      : 0;
    const netoControl = f.neto_en != null ? Number(f.neto) : undefined;
    const resumenPago = resumirPagosMeli(
      pagos,
      Number(f.total) || 0,
      comisionOrden,
      netoControl,
      f.reembolso_incluido_neto_base == null ? null : Number(f.reembolso_incluido_neto_base),
      f.reembolso_base_confiable == null ? null : Boolean(f.reembolso_base_confiable),
    );
    const estadoPago = resumenPago.estadoPago;
    const devuelta = resumenPago.reembolsado > 0 || estadoPago === "refunded" || estadoPago === "charged_back";

    // Una devuelta sin renglones (de antes de guardarlos): se le piden a
    // MELI para que el corte recupere el costo exacto de los pares.
    const cambios: Record<string, unknown> = {
      estado,
      estado_pago: estadoPago,
      reembolsado: resumenPago.reembolsado,
      reembolso_incluido_neto_base: resumenPago.reembolsoIncluidoNetoBase,
      reembolso_base_confiable: resumenPago.reembolsoBaseConfiable,
      ...(resumenPago.neto != null ? { neto_actual: resumenPago.neto, neto_en: new Date().toISOString() } : {}),
      comision_mp: resumenPago.comision,
      envio_mp: resumenPago.envio,
      isr_mp: resumenPago.isr,
      iva_mp: resumenPago.iva,
      otros_mp: resumenPago.otros,
      cargos_sin_desglosar: resumenPago.cargosSinDesglosar,
      detalle_cargos: resumenPago.detalleCargos,
      tipo_venta: resumenPago.tipoVenta,
      cargos_leidos_en: new Date().toISOString(),
      revisado_en: new Date().toISOString(),
      revisiones,
    };
    if (devuelta && estado !== "cancelled" && !f.renglones) {
      try {
        if (!mapaItemSku) mapaItemSku = await mapaItemSkuDe(db, accountId);
        const orden = await cliente.get<OrdenLeida>(`/orders/${orderId}`);
        const renglones = renglonesDe(orden, mapaItemSku);
        if (renglones.length) cambios.renglones = renglones;
      } catch (err) {
        r.errores.push(`renglones ${orderId}: ${(err as Error).message}`.slice(0, 200));
      }
    }

    const { error } = await db
      .from("ordenes_neto")
      .update(cambios)
      .eq("account_id", accountId)
      .eq("order_id", orderId);
    if (error) {
      r.errores.push(`guardar ${orderId}: ${error.message}`);
      continue;
    }
    r.revisadas++;
    r.quedan--;
    if (estado === "cancelled") {
      r.canceladas++;
      if (f.estado !== "cancelled") diasARebarrer.add(f.fecha);
    } else if (devuelta) {
      r.devueltas++;
    }
  }

  if (diasARebarrer.size) {
    const mapaItemSku = await mapaItemSkuDe(db, accountId);
    for (const dia of [...diasARebarrer].sort()) {
      if (Date.now() > opts.finMs) break;
      try {
        await recalcularDiaVentas(db, accountId, cliente, dia, mapaItemSku);
        r.diasRebarridos.push(dia);
      } catch (err) {
        r.errores.push(`re-barrido ${dia}: ${(err as Error).message}`.slice(0, 200));
      }
    }
  }
  return r;
}

/**
 * Revisión completa de un mes, para el corte: primero las cancelaciones en
 * bloque, luego los reembolsos orden por orden sin esperar los plazos, hasta
 * agotar el tiempo. Devuelve cuántas quedan: el corte lo declara.
 */
export async function revisarPeriodo(
  admin: DB,
  accountId: string,
  periodo: { desde: string; hasta: string },
  finMs: number,
): Promise<ResultadoRevision & { canceladasNuevas: number }> {
  const cliente = await clienteDeCuenta(admin, accountId);
  if (!cliente) throw new Error("No hay cuenta de MELI conectada.");
  const canc = await marcarCanceladas(admin, accountId, cliente, { ...periodo, finMs });
  const rev = await revisarOrdenes(admin, accountId, cliente, {
    ...periodo,
    tope: 5_000,
    finMs,
    sinEsperar: true,
  });
  await admin.from("sync_log").insert({
    account_id: accountId,
    tarea: "revision_devoluciones",
    estado: rev.errores.length || canc.errores.length ? "error" : "ok",
    fin: new Date().toISOString(),
    detalle: { periodo, canceladas: canc, revision: { ...rev, errores: rev.errores.slice(0, 20) } },
  });
  return {
    ...rev,
    canceladas: rev.canceladas + canc.nuevas,
    canceladasNuevas: canc.nuevas,
    diasRebarridos: [...canc.diasRebarridos, ...rev.diasRebarridos],
    errores: [...canc.errores, ...rev.errores],
  };
}

/**
 * La revisión de fondo, montada en el latido: las cancelaciones de los
 * últimos 60 días en bloque cada 6 horas, y unas cuantas órdenes por latido
 * a las que ya les toca su revisión de reembolso. Devuelve null si no hay
 * cliente de MELI.
 */
export async function revisarPendientes(
  admin: DB,
  accountId: string,
  finMs: number,
  tope = 150,
): Promise<ResultadoRevision | null> {
  const cliente = await clienteDeCuenta(admin, accountId);
  if (!cliente) return null;
  const ahoraMx = Date.now() - 6 * 3_600_000;
  const desde = new Date(ahoraMx - 60 * 86_400_000).toISOString().slice(0, 10);
  const hasta = new Date(ahoraMx).toISOString().slice(0, 10);

  const { data: ultima } = await admin
    .from("sync_log")
    .select("id")
    .eq("account_id", accountId)
    .eq("tarea", "revision_canceladas")
    .gte("inicio", new Date(Date.now() - 6 * 3_600_000).toISOString())
    .limit(1);
  if (!ultima?.length) {
    const canc = await marcarCanceladas(admin, accountId, cliente, { desde, hasta, finMs });
    await admin.from("sync_log").insert({
      account_id: accountId,
      tarea: "revision_canceladas",
      estado: canc.errores.length ? "error" : "ok",
      fin: new Date().toISOString(),
      detalle: canc,
    });
  }
  return revisarOrdenes(admin, accountId, cliente, { desde, hasta, tope, finMs });
}
