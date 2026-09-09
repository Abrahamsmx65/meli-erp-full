/**
 * Revisión de devoluciones y cancelaciones de YAPANIZCEL, orden por orden.
 *
 * Misma idea que en calzado (servicios/devoluciones.ts): las cancelaciones
 * en bloque por /orders/search y el pago de cada orden releído en Mercado
 * Pago a los 10 y a los 40 días. Aquí NO se vuelve a barrer el día de una
 * cancelación: el corte de fundas se arma desde las órdenes registradas
 * (yz_ordenes_neto con sus renglones), así que marcar la orden como
 * cancelada basta para que salga de la venta.
 */
import type { DB } from "../datos/repos";
import type { MeliClient } from "../meli/client";
import { camposLiquidacionMeli, pagosCobrablesCompletos, type PagoMercadoPago } from "../meli/pagos";
import { CacheTarifas, contextoGuardado, leerPagoReal, renglonesParaCascada, resumirOrdenConMeli } from "../meli/pagos-api";
import { contextoDeOrden, recortarOrden, type OrdenMeliCruda } from "../meli/orden";
import { SEGUNDA_REVISION_DIAS, tocaRevision, type ResultadoRevision } from "../servicios/devoluciones";
import { clienteDeCuenta } from "./cuenta";
import { hoyMx, restarDias, todo } from "./db";

async function sellerDe(admin: DB, accountId: string): Promise<number | null> {
  const { data } = await admin.from("yz_cuentas").select("meli_user_id").eq("id", accountId).maybeSingle();
  return data?.meli_user_id ?? null;
}

/** Marca como canceladas las órdenes del rango que MELI ya reporta así. */
export async function marcarCanceladasYz(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  opts: { desde: string; hasta: string; finMs: number },
): Promise<{ canceladas: number; nuevas: number; errores: string[] }> {
  const r = { canceladas: 0, nuevas: 0, errores: [] as string[] };
  const sellerId = await sellerDe(admin, accountId);
  if (sellerId == null) return r;

  const ids: number[] = [];
  // Ventanas de UN día, como la sincronización de fundas (~1,400 órdenes al día).
  let cursor = new Date(`${opts.desde}T00:00:00.000-06:00`);
  const fin = new Date(`${opts.hasta}T23:59:59.999-06:00`);
  while (cursor < fin && Date.now() < opts.finMs) {
    const sig = new Date(cursor);
    sig.setUTCDate(sig.getUTCDate() + 1);
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
  for (let i = 0; i < ids.length; i += 200) {
    const tramo = ids.slice(i, i + 200);
    const { data } = await admin.from("yz_ordenes_neto").select("order_id, estado").eq("account_id", accountId).in("order_id", tramo);
    const nuevas = (data ?? []).filter((f: any) => f.estado !== "cancelled").map((f: any) => f.order_id);
    if (!nuevas.length) continue;
    const { error } = await admin
      .from("yz_ordenes_neto")
      .update({ estado: "cancelled", revisado_en: new Date().toISOString() })
      .eq("account_id", accountId)
      .in("order_id", nuevas);
    if (error) r.errores.push(`marcar canceladas: ${error.message}`);
    else r.nuevas += nuevas.length;
  }
  return r;
}

/** Relee el pago de cada orden del rango a la que le toca revisión. */
export async function revisarOrdenesYz(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  opts: { desde: string; hasta: string; tope: number; finMs: number; sinEsperar?: boolean },
): Promise<ResultadoRevision> {
  const hoy = hoyMx();
  const filas = await todo<any>(
    admin,
    "yz_ordenes_neto",
    "order_id, payment_id, payment_ids, fecha, total, neto, neto_en, estado, revisiones, renglones, reembolso_incluido_neto_base, reembolso_base_confiable, static_tags, pack_id, shipping_id, pagado, envio_comprador, envio_vendedor",
    (q) => q.eq("account_id", accountId).gte("fecha", opts.desde).lte("fecha", opts.hasta).lt("revisiones", 2),
  );
  const pendientes = filas
    .filter((f) => tocaRevision(f.fecha, f.revisiones ?? 0, hoy, opts.sinEsperar))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  const r: ResultadoRevision = { revisadas: 0, canceladas: 0, devueltas: 0, diasRebarridos: [], quedan: pendientes.length, errores: [] };
  const tarifas = new CacheTarifas(cliente);
  for (const f of pendientes.slice(0, opts.tope)) {
    if (Date.now() > opts.finMs) break;
    const orderId = Number(f.order_id);
    const idsPago = new Set<number>();
    for (const p of Array.isArray(f.payment_ids) ? f.payment_ids : []) if (p != null) idsPago.add(Number(p));
    if (f.payment_id != null) idsPago.add(Number(f.payment_id));
    let estado: string | null = f.estado ?? null;
    // La orden se vuelve a pedir cuando falta algo que solo ella trae
    // (pagos, estado, o las etiquetas de reventa de las filas viejas).
    let orden: OrdenMeliCruda | null = null;
    if (!idsPago.size || !estado || f.static_tags == null) {
      try {
        orden = await cliente.get<OrdenMeliCruda>(`/orders/${orderId}`);
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
    if (idsPago.size === 0 || pagosLeidos !== idsPago.size) continue;
    const cobrables = pagos.filter((p) => p.estado !== "rejected" && p.estado !== "cancelled");
    if (!pagosCobrablesCompletos(pagos) || (estado !== "cancelled" && cobrables.length === 0)) continue;

    const dias = Math.floor((Date.parse(hoy) - Date.parse(f.fecha)) / 86_400_000);
    const revisiones = dias >= SEGUNDA_REVISION_DIAS ? 2 : Math.min(2, (f.revisiones ?? 0) + 1);
    const comisionOrden = Array.isArray(f.renglones)
      ? f.renglones.reduce((a: number, x: any) => a + (Number(x.comision) || 0), 0)
      : 0;
    const netoControl = f.neto_en != null ? Number(f.neto) : undefined;
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
      renglones: renglonesParaCascada(f.renglones),
      tarifas,
    });
    const estadoPago = resumenPago.estadoPago;
    const cambios: Record<string, unknown> = {
      estado,
      ...(resumenPago.neto != null ? { neto_actual: resumenPago.neto, neto_en: new Date().toISOString() } : {}),
      ...camposLiquidacionMeli(resumenPago),
      ...(orden
        ? {
            pack_id: contexto.packId,
            shipping_id: contexto.shippingId,
            static_tags: contexto.staticTags ?? [],
            pagado: contexto.pagado ?? null,
            orden_cruda: recortarOrden(orden),
          }
        : {}),
      cargos_leidos_en: new Date().toISOString(),
      revisado_en: new Date().toISOString(),
      revisiones,
    };
    // Si la orden aún no tenía neto, esta lectura ya lo trae: se aprovecha.
    if (resumenPago.neto != null && f.neto_en == null) {
      cambios.neto = resumenPago.neto;
    }
    const { error } = await admin.from("yz_ordenes_neto").update(cambios).eq("account_id", accountId).eq("order_id", orderId);
    if (error) {
      r.errores.push(`guardar ${orderId}: ${error.message}`);
      continue;
    }
    r.revisadas++;
    r.quedan--;
    if (estado === "cancelled") r.canceladas++;
    else if (resumenPago.reembolsado > 0 || estadoPago === "refunded" || estadoPago === "charged_back") r.devueltas++;
  }
  return r;
}

/** Revisión completa de un mes, para el corte. */
export async function revisarPeriodoYz(
  admin: DB,
  accountId: string,
  periodo: { desde: string; hasta: string },
  finMs: number,
): Promise<ResultadoRevision & { canceladasNuevas: number }> {
  const cliente = await clienteDeCuenta(admin, accountId);
  const canc = await marcarCanceladasYz(admin, accountId, cliente, { ...periodo, finMs });
  const rev = await revisarOrdenesYz(admin, accountId, cliente, { ...periodo, tope: 5_000, finMs, sinEsperar: true });
  await admin.from("yz_sync_log").insert({
    account_id: accountId,
    ok: !rev.errores.length && !canc.errores.length,
    detalle: { tarea: "revision_devoluciones", periodo, canceladas: canc, revision: { ...rev, errores: rev.errores.slice(0, 20) } },
  });
  return { ...rev, canceladas: rev.canceladas + canc.nuevas, canceladasNuevas: canc.nuevas, errores: [...canc.errores, ...rev.errores] };
}

/** La revisión de fondo (cron de netos): canceladas cada 6 h, y unas órdenes por corrida. */
export async function revisarPendientesYz(admin: DB, accountId: string, finMs: number, tope = 150): Promise<ResultadoRevision> {
  const cliente = await clienteDeCuenta(admin, accountId);
  const hoy = hoyMx();
  const desde = restarDias(hoy, 60);
  const { data: ultima } = await admin
    .from("yz_sync_log")
    .select("id")
    .eq("account_id", accountId)
    .eq("detalle->>tarea", "revision_canceladas")
    .gte("corrido_en", new Date(Date.now() - 6 * 3_600_000).toISOString())
    .limit(1);
  if (!ultima?.length) {
    const canc = await marcarCanceladasYz(admin, accountId, cliente, { desde, hasta: hoy, finMs });
    await admin.from("yz_sync_log").insert({ account_id: accountId, ok: !canc.errores.length, detalle: { tarea: "revision_canceladas", ...canc } });
  }
  return revisarOrdenesYz(admin, accountId, cliente, { desde, hasta: hoy, tope, finMs });
}
