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
  camposLiquidacionMeli,
  leerPagoMercadoPago,
  pagosCobrablesCompletos,
  peorEstadoPago,
  type PagoMercadoPago,
} from "../meli/pagos";
import { CacheTarifas, contextoGuardado, leerPagoReal, renglonesParaCascada, resumirOrdenConMeli } from "../meli/pagos-api";
import { columnasDeReclamos, leerReclamosDeOrden, skuDesdeOrdenCruda } from "../meli/reclamos";
import { contextoDeOrden, recortarOrden, type OrdenMeliCruda } from "../meli/orden";
import { traerTodo, type DB } from "../datos/repos";
import { claveItem } from "../meli/sync";
import { clienteDeCuenta, mapaItemSkuDe, recalcularDiaVentas } from "./webhooks";
import { invalidarCortesDePeriodos, periodoDeFecha } from "./corte-invalidar";

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

/**
 * `tocaRevision` como filtro de PostgREST: primera revisión a los 10 días
 * (revisiones = 0), segunda a los 40 (revisiones = 1). Se aplica sobre la
 * consulta para no bajar lo que aún no toca.
 */
export function filtroTocaRevision(hoy: string): string {
  const limite = (dias: number) => new Date(Date.parse(hoy) - dias * 86_400_000).toISOString().slice(0, 10);
  return `and(revisiones.eq.0,fecha.lte.${limite(PRIMERA_REVISION_DIAS)}),and(revisiones.eq.1,fecha.lte.${limite(SEGUNDA_REVISION_DIAS)})`;
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

type OrdenLeida = OrdenMeliCruda;

export interface RenglonGuardado {
  sku: string;
  unidades: number;
  importe: number;
  comision: number;
  categoria: string | null;
  listing: string | null;
}

/** Los renglones (sku, unidades, importe, comisión, categoría) de una orden leída de MELI. */
export function renglonesDe(orden: OrdenLeida, mapaItemSku: Map<string, string>): RenglonGuardado[] {
  const porSku = new Map<string, RenglonGuardado>();
  for (const oi of orden.order_items ?? []) {
    const sku =
      oi.item?.seller_sku?.trim() ||
      oi.item?.seller_custom_field?.trim() ||
      (oi.item?.id ? mapaItemSku.get(claveItem(oi.item.id, oi.item.variation_id)) : undefined) ||
      (oi.item?.id ? mapaItemSku.get(oi.item.id) : undefined);
    if (!sku) continue;
    const u = oi.quantity ?? 0;
    const r = porSku.get(sku) ?? {
      sku,
      unidades: 0,
      importe: 0,
      comision: 0,
      categoria: oi.item?.category_id ?? null,
      listing: oi.listing_type_id ?? null,
    };
    r.unidades += u;
    r.importe = Math.round((r.importe + u * (oi.unit_price ?? 0)) * 100) / 100;
    r.comision = Math.round((r.comision + u * (oi.sale_fee ?? 0)) * 100) / 100;
    porSku.set(sku, r);
  }
  return [...porSku.values()];
}

/**
 * Las columnas de la orden que se guardan al leerla de MELI (etiquetas,
 * pack, envío, pagado y la orden recortada): las mismas que escribe el
 * barrido de ventas, para que la revisión y la recarga dejen la fila igual.
 */
export function columnasDeOrden(orden: OrdenLeida): Record<string, unknown> {
  const ctx = contextoDeOrden(orden, Date.now());
  return {
    pack_id: ctx.packId,
    shipping_id: ctx.shippingId,
    static_tags: ctx.staticTags ?? [],
    pagado: ctx.pagado ?? null,
    envio_comprador: ctx.envioComprador ?? 0,
    orden_cruda: recortarOrden(orden),
  };
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
  opts: {
    desde: string;
    hasta: string;
    tope: number;
    finMs: number;
    sinEsperar?: boolean;
    /**
     * Re-enriquecer SOLO estas órdenes (auditoría puntual contra el reporte
     * "Ventas MX", o la recarga histórica): se releen orden y pagos tengan
     * o no sus revisiones.
     */
    ordenIds?: number[];
    /** caché de tarifas compartido entre lotes de una misma corrida */
    tarifas?: CacheTarifas;
  },
): Promise<ResultadoRevision> {
  const hoy = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  const columnas =
    "order_id, payment_id, payment_ids, fecha, total, neto, neto_pago, ajuste_envio, neto_en, estado, revisiones, renglones, reembolso_incluido_neto_base, reembolso_base_confiable, static_tags, pack_id, shipping_id, pagado, envio_comprador, envio_vendedor";
  // El filtro de "toca revisar" va EN LA CONSULTA (misma regla que
  // tocaRevision): sin él, cada latido bajaba las ~50 mil órdenes de 60
  // días con sus renglones jsonb para revisar 150, y esa carga tiró
  // Postgres ocho veces el 9-sep-2026.
  // Y se bajan solo las más viejas hasta el tope (lo que se va a revisar en
  // esta corrida), no el rezago completo.
  let filas: any[];
  if (opts.ordenIds?.length) {
    filas = await traerTodo<any>(db, "ordenes_neto", columnas, (q) => q.eq("account_id", accountId).in("order_id", opts.ordenIds!));
  } else if (opts.sinEsperar) {
    filas = await traerTodo<any>(db, "ordenes_neto", columnas, (q) =>
      q.eq("account_id", accountId).gte("fecha", opts.desde).lte("fecha", opts.hasta).lt("revisiones", 2),
    );
  } else {
    const { data, error } = await db
      .from("ordenes_neto")
      .select(columnas)
      .eq("account_id", accountId)
      .gte("fecha", opts.desde)
      .lte("fecha", opts.hasta)
      .lt("revisiones", 2)
      .or(filtroTocaRevision(hoy))
      .order("fecha", { ascending: true })
      .order("order_id", { ascending: true })
      .limit(Math.max(opts.tope, 1));
    if (error) throw new Error(`ordenes_neto: ${error.message}`);
    filas = data ?? [];
  }
  let mapaItemSku: Map<string, string> | null = null;
  const tarifas = opts.tarifas ?? new CacheTarifas(cliente);

  const pendientes = filas
    .filter((f) => opts.ordenIds?.length || tocaRevision(f.fecha, f.revisiones ?? 0, hoy, opts.sinEsperar))
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
    // La orden se vuelve a pedir cuando falta algo que solo ella trae: sus
    // pagos, su estado, o (filas de antes de guardarla) sus etiquetas de
    // reventa y su envío. Una sola llamada deja la fila completa. Al
    // re-enriquecer a mano se pide siempre: es la auditoría completa.
    let orden: OrdenLeida | null = null;
    const faltaOrden =
      !idsPago.size || !estado || f.static_tags == null || f.renglones == null || Boolean(opts.ordenIds?.length);
    if (faltaOrden) {
      try {
        orden = await cliente.get<OrdenLeida>(`/orders/${orderId}`);
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
        pagos.push(await leerPagoReal(cliente, pid));
        pagosLeidos++;
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
    // Los renglones guardados (con categoría) sirven para la reventa; si la
    // orden se acaba de leer, los suyos son más completos.
    let renglonesGuardados: RenglonGuardado[] | null = Array.isArray(f.renglones) ? f.renglones : null;
    if (orden) {
      if (!mapaItemSku) mapaItemSku = await mapaItemSkuDe(db, accountId);
      const leidos = renglonesDe(orden, mapaItemSku);
      if (leidos.length) renglonesGuardados = leidos;
    }
    const comisionOrden = (renglonesGuardados ?? []).reduce((a, x) => a + (Number(x.comision) || 0), 0);
    // Control = depósito crudo de la primera liquidación (neto_pago; en
    // filas de antes del ajuste de envío, el propio neto).
    const netoControl = f.neto_en != null ? Number(f.neto_pago ?? f.neto) : undefined;
    const contexto = orden ? contextoDeOrden(orden, Date.now()) : contextoGuardado(f, Date.now());
    if (orden && f.envio_vendedor != null) contexto.envioVendedor = Number(f.envio_vendedor);
    const resumenPago = await resumirOrdenConMeli(cliente, {
      pagos,
      total: Number(f.total) || 0,
      comisionOrden,
      netoControl,
      reembolsoIncluidoNetoBase: f.reembolso_incluido_neto_base == null ? null : Number(f.reembolso_incluido_neto_base),
      reembolsoBaseConfiable: f.reembolso_base_confiable == null ? null : Boolean(f.reembolso_base_confiable),
      contexto,
      renglones: renglonesParaCascada(renglonesGuardados),
      tarifas,
    });
    const estadoPago = resumenPago.estadoPago;
    const devuelta = resumenPago.reembolsado > 0 || estadoPago === "refunded" || estadoPago === "charged_back";

    const cambios: Record<string, unknown> = {
      estado,
      ...(resumenPago.neto != null ? { neto_actual: resumenPago.neto, neto_en: new Date().toISOString() } : {}),
      // La primera liquidación con su ajuste de envío: se fija cuando la
      // fila aún no tenía neto o lo tenía crudo (de antes del ajuste), y se
      // corrige cuando el ajuste cambió (el control es neto_pago, que no lo
      // trae: sin neto_pago en la lectura, cada revisión volvía a sumarlo).
      ...(resumenPago.netoBase != null &&
      (f.neto_en == null || f.neto_pago == null || Math.abs(Number(f.ajuste_envio ?? 0) - resumenPago.ajusteEnvio) > 0.005)
        ? { neto: resumenPago.netoBase }
        : {}),
      ...camposLiquidacionMeli(resumenPago),
      ...(orden ? columnasDeOrden(orden) : {}),
      cargos_leidos_en: new Date().toISOString(),
      revisado_en: new Date().toISOString(),
      revisiones,
    };
    // Reclamos y devoluciones: solo en órdenes con reembolso o con
    // mediación (una o dos llamadas más). Si MELI no contesta, se deja
    // sin leer y se reintenta en la siguiente revisión.
    const conReclamo = resumenPago.reembolsado > 0 || estadoPago === "refunded" || estadoPago === "charged_back" || estado === "partially_refunded" || (Array.isArray((orden as any)?.mediations) && (orden as any).mediations.length > 0);
    if (conReclamo) {
      try {
        const reclamos = await leerReclamosDeOrden(cliente, orderId, skuDesdeOrdenCruda(orden ?? f.orden_cruda));
        Object.assign(cambios, columnasDeReclamos(reclamos));
      } catch (err) {
        r.errores.push(`reclamos ${orderId}: ${(err as Error).message}`.slice(0, 200));
      }
    }
    // Los renglones se guardan si la fila no los tenía (de antes de
    // guardarlos): con ellos el corte recupera el costo exacto de los pares.
    if (orden && !f.renglones && renglonesGuardados?.length) cambios.renglones = renglonesGuardados;

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

/** Hasta dónde hacia atrás se recarga el desglose con el pago real (los cortes del dueño). */
export const FONDO_RECARGA_CARGOS = "2026-06-01";
export const TAREA_RECARGA_CARGOS = "recarga_cargos_v1";

/**
 * Recarga histórica del desglose con el pago REAL de Mercado Pago, orden
 * por orden desde las filas guardadas (`cargos_fuente` en null = nunca
 * leída por el camino nuevo), de lo más reciente hacia atrás hasta
 * `FONDO_RECARGA_CARGOS`. Va montada en el latido con presupuesto de reloj.
 *
 * Sustituye a la reparación que re-barría días enteros: aquella pedía el
 * día a /orders/search en cada intento y se atoraba para siempre en un día
 * con una orden que MELI ya no devuelve como pagada. Aquí cada orden se
 * relee por su id (orden + pagos, como la revisión de devoluciones) y la
 * que no se pueda leer no detiene a las demás: el cursor (fecha, orden)
 * avanza dentro de la corrida y la siguiente vuelve a intentar.
 */
export async function recargarCargosHistoricos(
  admin: DB,
  accountId: string,
  finMs: number,
): Promise<{ leidas: number; quedan: number; completo: boolean } | null> {
  const cliente = await clienteDeCuenta(admin, accountId);
  if (!cliente) return null;
  const tarifas = new CacheTarifas(cliente);
  const t0 = Date.now();
  let leidas = 0;
  const errores: string[] = [];
  const periodos = new Set<string>();
  let cursor: { fecha: string; orderId: number } | null = null;

  // Dos frentes que se alternan por lote: (1) órdenes sin pago real;
  // (2) órdenes ya leídas pero sin el envío de /costs (de antes del
  // ajuste de envío: su neto trae el costo de lista, no el real).
  // (3) órdenes con reembolso ya revisadas pero sin sus reclamos leídos
  // (si el par volvió a la venta o se descartó).
  let cursorEnvio: { fecha: string; orderId: number } | null = null;
  let cursorReclamo: { fecha: string; orderId: number } | null = null;
  const orden: ("cargos" | "envio" | "reclamos")[] = ["cargos", "envio", "reclamos"];
  let frente: "cargos" | "envio" | "reclamos" = "cargos";
  let agotado = { cargos: false, envio: false, reclamos: false };
  const siguiente = (f: typeof frente) => orden[(orden.indexOf(f) + 1) % orden.length];
  while (Date.now() < finMs - 30_000 && !(agotado.cargos && agotado.envio && agotado.reclamos)) {
    if (agotado[frente]) { frente = siguiente(frente); continue; }
    const esEnvio = frente === "envio";
    const esReclamo = frente === "reclamos";
    let q = admin
      .from("ordenes_neto")
      .select("order_id, fecha")
      .eq("account_id", accountId)
      .gte("fecha", FONDO_RECARGA_CARGOS)
      .gt("total", 0)
      .or("estado.is.null,estado.neq.cancelled")
      .order("fecha", { ascending: false })
      .order("order_id", { ascending: false })
      .limit(100);
    q = esReclamo
      ? q.not("cargos_fuente", "is", null).is("reclamo_leido_en", null).or("reembolsado.gt.0,estado_pago.in.(refunded,charged_back),estado.eq.partially_refunded")
      : esEnvio
        ? q.not("cargos_fuente", "is", null).is("envio_leido_en", null)
        : q.is("cargos_fuente", null);
    // Cursor estable: lo que no se pudo leer en este lote no vuelve a salir
    // en esta corrida (si no, un pago que MP no contesta bloquearía el lote).
    const c = esReclamo ? cursorReclamo : esEnvio ? cursorEnvio : cursor;
    if (c) q = q.or(`fecha.lt.${c.fecha},and(fecha.eq.${c.fecha},order_id.lt.${c.orderId})`);
    const { data, error } = await q;
    if (error) {
      errores.push(error.message.slice(0, 200));
      break;
    }
    const lote = (data ?? []) as { order_id: number; fecha: string }[];
    if (!lote.length) {
      agotado = { ...agotado, [frente]: true };
      continue;
    }
    const ultimo = lote[lote.length - 1]!;
    const marca = { fecha: ultimo.fecha, orderId: Number(ultimo.order_id) };
    if (esReclamo) cursorReclamo = marca;
    else if (esEnvio) cursorEnvio = marca;
    else cursor = marca;
    frente = siguiente(frente);

    const r = await revisarOrdenes(admin, accountId, cliente, {
      desde: FONDO_RECARGA_CARGOS,
      hasta: "2100-01-01",
      tope: lote.length,
      finMs: finMs - 20_000,
      ordenIds: lote.map((f) => Number(f.order_id)),
      tarifas,
    });
    leidas += r.revisadas;
    errores.push(...r.errores.slice(0, 3));
    if (r.revisadas > 0) for (const f of lote) periodos.add(periodoDeFecha(f.fecha));
    if (r.revisadas === 0 && r.errores.length) break;
  }
  // Los cortes de esos meses ya no dicen la verdad: se rehacen en el fondo.
  if (periodos.size) await invalidarCortesDePeriodos(admin, { meliAccountId: accountId }, periodos, "La recarga leyó pagos reales de Mercado Pago.");

  const { count } = await admin
    .from("ordenes_neto")
    .select("order_id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .is("cargos_fuente", null)
    .gte("fecha", FONDO_RECARGA_CARGOS)
    .gt("total", 0)
    .or("estado.is.null,estado.neq.cancelled");
  const quedan = count ?? 0;
  const completo = quedan === 0;
  if (leidas > 0 || errores.length) {
    await admin.from("sync_log").insert({
      account_id: accountId,
      tarea: TAREA_RECARGA_CARGOS,
      estado: errores.length && leidas === 0 ? "error" : "ok",
      fin: new Date().toISOString(),
      detalle: { leidas, quedan, completo, ms: Date.now() - t0, errores: errores.slice(0, 5) },
    });
  }
  return { leidas, quedan, completo };
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
