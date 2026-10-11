/**
 * TikTok Shop en el corte general (pedido del dueño, 28-sep-2026: «aumenta
 * al corte general TikTok desde septiembre; antes no vendía»).
 *
 * El dinero es el de TikTok, pedido por pedido, NUNCA una estimación del
 * ERP: lo que ya liquidó (`neto_recibido`) o lo que su lista de «por
 * liquidar» dice que va a pagar (`pago_esperado`, ver `tiktok/liquidacion.ts`).
 * Ese número ya trae descontados comisión, cargo por par, afiliados, envío
 * e IVA/ISR retenidos. Los pedidos de los que TikTok aún no tiene número
 * quedan FUERA del neto y de la ganancia y se declaran (igual que la venta
 * sin depósito leído de MELI); su costo también espera, porque el costo
 * sigue a su venta. Solo cuentan los pedidos EN PIE (sin cancelados, sin
 * pagar ni muestras), por la fecha de creación en hora de México.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { deDesglose, diaMx, resumenPorModelo, type OrdenParaVentas, type RenglonParaVentas } from "../tiktok/ventas";
import type { BloqueCanal } from "./consolidado";
import type { ConfigProducto } from "./productos";
import { ajustesDelPeriodo, type EstadoCuentaTikTok } from "../tiktok/estados-cuenta";

/** TikTok empezó a vender en septiembre de 2026: antes no hay canal. */
export const TIKTOK_DESDE = "2026-09-01";

export interface DesglosePagoTikTok {
  comision: number;
  /** cargo de servicio del 8 % (`sfp_service_fee_amount`) */
  servicio: number;
  /** cargo fijo por par */
  porPar: number;
  /** comisión en porcentaje (6 % desde el 24-sep-2026) */
  comisionTikTok: number;
  /** anuncios GMV Max: van a publicidad */
  anuncios: number;
  afiliado: number;
  envio: number;
  ivaRetenido: number;
  isrRetenido: number;
}

export interface OrdenTikTokCorte extends OrdenParaVentas {
  desglose?: Partial<DesglosePagoTikTok> | null;
}

export interface VentasTikTok {
  ordenes: OrdenTikTokCorte[];
  renglones: RenglonParaVentas[];
}

const c = (x: unknown) => Math.round((Number(x) || 0) * 100);
const p = (cent: number) => Math.round(cent) / 100 || 0;

function pesos(x: number): string {
  return x.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

/** El rango del corte que le toca a TikTok (nada antes de que vendiera). */
export function rangoTikTok(rango: { desde: string; hasta: string }): { desde: string; hasta: string } | null {
  if (rango.hasta < TIKTOK_DESDE) return null;
  return { desde: rango.desde < TIKTOK_DESDE ? TIKTOK_DESDE : rango.desde, hasta: rango.hasta };
}

/**
 * `estados`: los estados de cuenta de TikTok ya leídos (null = no se han
 * podido leer). Sus AJUSTES —lo que TikTok cobra o abona sin pedido— entran
 * como gasto de la plataforma del mes por la fecha del estado.
 */
export function bloqueTikTok(
  v: VentasTikTok,
  config: Map<string, ConfigProducto>,
  rango: { desde: string; hasta: string },
  estados: EstadoCuentaTikTok[] | null = null,
): BloqueCanal | null {
  const r = rangoTikTok(rango);
  if (!r) return null;
  const modelos = resumenPorModelo(v.ordenes, v.renglones, r);
  if (!modelos.length) return null;

  // Qué pedidos entraron y con qué número, para el desglose de cargos.
  const pedidosConDato = new Set<string>();
  const pedidos = new Set<string>();
  const enRango = new Map(v.ordenes.map((o) => [o.orderId, o]));
  for (const rr of v.renglones) {
    const o = enRango.get(rr.orderId);
    if (!o) continue;
    const base = o.creadoEn ?? o.actualizadoEn;
    if (!base) continue;
    const dia = diaMx(base);
    if (dia < r.desde || dia > r.hasta) continue;
    const estado = String(o.estado ?? "").toUpperCase();
    if (o.esMuestra || estado === "UNPAID" || estado === "CANCELLED" || estado === "CANCEL") continue;
    pedidos.add(o.orderId);
    if (o.netoRecibido != null || o.pagoEsperado != null) pedidosConDato.add(o.orderId);
  }

  let unidades = 0;
  let venta = 0;
  let neto = 0;
  let sinDato = 0;
  let unidadesSinDato = 0;
  let porLiquidar = 0;
  let anuncios = 0;
  let costoProducto = 0;
  let costoEnEspera = 0;
  let unidadesConCosto = 0;
  const sinCosto: string[] = [];
  const porModelo: BloqueCanal["porModelo"] = [];
  for (const m of modelos) {
    const cfg = config.get(m.modelo);
    unidades += m.unidades;
    venta += c(m.cobrado);
    neto += c(m.aRecibir);
    sinDato += c(m.cobradoSinDato);
    unidadesSinDato += m.unidadesSinDato;
    porLiquidar += c(m.aRecibirPorLiquidar);
    anuncios += c(m.anuncios);
    let costo: number | null = null;
    if (cfg?.costo != null) {
      costo = c(cfg.costo) * m.unidadesConDato;
      costoProducto += costo;
      costoEnEspera += c(cfg.costo) * m.unidadesSinDato;
      unidadesConCosto += m.unidades;
    } else {
      sinCosto.push(m.modelo);
    }
    porModelo.push({
      modelo: m.modelo,
      categoria: cfg?.categoria ?? null,
      unidades: m.unidades,
      importe: m.cobrado,
      // El pago de TikTok ya trae restados los anuncios GMV Max: se suman de
      // vuelta al neto y se restan como PUBLICIDAD del modelo (la utilidad
      // no cambia; la barra de plataforma deja de llevarlos).
      neto: m.aRecibir + m.anuncios,
      costo: costo == null ? null : p(costo),
      ads: m.anuncios,
    });
  }

  // Los cargos que TikTok desglosa en los pedidos con número, uno por uno
  // (dueño, 11-oct-2026: «pagamos 6 % de comisión, 8 % de envío y $6 de
  // costo fijo, afiliados e impuestos»). Lo que no se desglosa (reembolsos,
  // y en lo POR LIQUIDAR el cargo por par y las retenciones, que la lista
  // de TikTok no separa) queda en «otros».
  let servicio = 0;
  let porPar = 0;
  let comisionPct = 0;
  let comisionVieja = 0;
  let envio = 0;
  let isr = 0;
  let iva = 0;
  let afiliadoDesglose = 0;
  for (const id of pedidosConDato) {
    const d = enRango.get(id)?.desglose;
    if (!d) continue;
    if (d.servicio != null || d.porPar != null || d.comisionTikTok != null) {
      servicio += c(d.servicio);
      porPar += c(d.porPar);
      comisionPct += c(d.comisionTikTok);
    } else {
      comisionVieja += c(d.comision);
    }
    afiliadoDesglose += c(d.afiliado);
    envio += c(d.envio);
    isr += c(d.isrRetenido);
    iva += c(d.ivaRetenido);
  }
  const comision = servicio + porPar + comisionPct + comisionVieja;
  const ventaConDato = venta - sinDato;
  const netoConAnuncios = neto + anuncios;
  const otros = ventaConDato - netoConAnuncios - comision - afiliadoDesglose - envio - isr - iva;

  const avisos: string[] = [];
  if (sinDato > 0) {
    avisos.push(`TikTok: ${pesos(p(sinDato))} de venta (${unidadesSinDato} pares) todavía sin número de TikTok de cuánto paga; queda fuera del neto y de la ganancia, y su costo (${pesos(p(costoEnEspera))}) espera con ella.`);
  }
  if (porLiquidar > 0) {
    avisos.push(`TikTok: ${pesos(p(porLiquidar))} del neto está POR LIQUIDAR (lo que TikTok dice que pagará); lo demás ya se liquidó.`);
  }
  if (sinCosto.length) avisos.push(`TikTok: sin costo capturado para ${sinCosto.join(", ")}.`);
  if (anuncios > 0) avisos.push(`TikTok: ${pesos(p(anuncios))} de anuncios GMV Max cobrados dentro de los pedidos van como publicidad de cada modelo, no como cargo de la plataforma.`);
  if (rango.desde < TIKTOK_DESDE) avisos.push(`TikTok cuenta desde ${TIKTOK_DESDE}: antes no vendía.`);

  // Lo que TikTok cobró o abonó FUERA de los pedidos (ajustes de sus estados
  // de cuenta): negativo = cargo. Va como gasto de la plataforma.
  const gastos: BloqueCanal["gastos"] = [];
  if (estados == null) {
    avisos.push("TikTok: todavía no se leen sus estados de cuenta; si TikTok cobró ajustes fuera de los pedidos (penalizaciones, logística), no están restados. El cron de pagos los lee cada hora.");
  } else {
    const a = ajustesDelPeriodo(estados, r.desde, r.hasta);
    if (a.ajustes !== 0) {
      gastos.push({ concepto: a.ajustes < 0 ? "TikTok · ajustes cobrados fuera de pedidos (estados de cuenta)" : "TikTok · ajustes abonados fuera de pedidos (estados de cuenta)", monto: p(-c(a.ajustes)) });
      avisos.push(`TikTok: sus ${a.estados} estados de cuenta del periodo traen ${pesos(a.ajustes)} de ajustes fuera de los pedidos (${a.conAjuste.length} estados con ajuste); ${a.ajustes < 0 ? "se restan" : "se suman"} como gasto de la plataforma.`);
    } else if (a.estados > 0) {
      avisos.push(`TikTok: sus ${a.estados} estados de cuenta del periodo no traen ajustes fuera de los pedidos.`);
    }
  }

  return {
    canal: "tiktok",
    unidades,
    ordenes: pedidos.size,
    ventaBruta: p(venta),
    neto: p(netoConAnuncios),
    fuenteNeto:
      sinDato > 0
        ? "Lo que TikTok paga por pedido (liquidado + por liquidar); la venta sin número de TikTok NO está incluida"
        : "Lo que TikTok paga por pedido (liquidado + por liquidar)",
    coberturaNeto: venta > 0 ? ventaConDato / venta : null,
    descuentos: [
      ...(servicio ? [{ concepto: "Cargo de servicio de TikTok (8 %)", monto: p(servicio) }] : []),
      ...(porPar ? [{ concepto: "Cargo fijo por par", monto: p(porPar) }] : []),
      ...(comisionPct ? [{ concepto: "Comisión de TikTok (%)", monto: p(comisionPct) }] : []),
      ...(comisionVieja ? [{ concepto: "Comisión de TikTok (sin desglose)", monto: p(comisionVieja) }] : []),
      ...(afiliadoDesglose ? [{ concepto: "Afiliados (creadores)", monto: p(afiliadoDesglose) }] : []),
      ...(envio ? [{ concepto: "Envío a cargo del vendedor", monto: p(envio) }] : []),
      ...(isr ? [{ concepto: "Retención ISR", monto: p(isr) }] : []),
      ...(iva ? [{ concepto: "Retención IVA", monto: p(iva) }] : []),
      ...(otros ? [{ concepto: "Reembolsos y cargos sin desglose (lo por liquidar no separa cargo por par ni retenciones)", monto: p(otros) }] : []),
    ],
    // Los afiliados los cobra TikTok en el pedido: son plataforma («otros»
    // en la cascada, con su propio renglón en los descuentos).
    desglosePlataforma: { comision: p(comision), envio: p(envio), isr: p(isr), iva: p(iva), otros: p(otros + afiliadoDesglose) },
    devoluciones: 0,
    costoRecuperado: 0,
    costoProducto: p(costoProducto),
    unidadesConCosto,
    adsPorModelo: p(anuncios),
    adsGenerales: 0,
    gastos,
    porModelo,
    avisos,
    exacto: sinDato === 0 && porLiquidar === 0 && sinCosto.length === 0,
  };
}

/** Los pedidos de TikTok creados en el rango (día de México) con sus renglones. */
export async function cargarVentasTikTok(db: DB, accountId: string, desde: string, hasta: string): Promise<VentasTikTok> {
  // El día de México empieza a las 06:00 UTC; un día de margen por lado y
  // el filtro fino lo hace `diaMx`.
  const desdeIso = new Date(Date.parse(`${desde}T06:00:00Z`) - 86_400_000).toISOString();
  const hastaIso = new Date(Date.parse(`${hasta}T06:00:00Z`) + 2 * 86_400_000).toISOString();
  const crudas = await traerTodo<any>(
    db,
    "tiktok_ordenes",
    "order_id, estado, fecha_creacion, fecha_actualizacion, es_muestra, neto_recibido, pago_esperado, pago_afiliado, pago_desglose",
    (q) => q.eq("account_id", accountId).gte("fecha_creacion", desdeIso).lt("fecha_creacion", hastaIso),
  );
  const ordenes: OrdenTikTokCorte[] = crudas
    .filter((o) => o.fecha_creacion && diaMx(o.fecha_creacion) >= desde && diaMx(o.fecha_creacion) <= hasta)
    .map((o) => ({
      orderId: o.order_id,
      estado: o.estado,
      creadoEn: o.fecha_creacion,
      actualizadoEn: o.fecha_actualizacion,
      esMuestra: Boolean(o.es_muestra),
      netoRecibido: o.neto_recibido != null ? Number(o.neto_recibido) : null,
      pagoEsperado: o.pago_esperado != null ? Number(o.pago_esperado) : null,
      afiliado: o.pago_afiliado != null ? Number(o.pago_afiliado) : null,
      desglose: o.pago_desglose ?? null,
      ...deDesglose(o.pago_desglose, o.neto_recibido != null || o.pago_esperado != null),
    }));
  const renglones: RenglonParaVentas[] = [];
  const ids = ordenes.map((o) => o.orderId);
  for (let i = 0; i < ids.length; i += 300) {
    const lote = ids.slice(i, i + 300);
    const items = await traerTodo<any>(db, "tiktok_orden_items", "order_id, sku_interno, cantidad, precio, estado", (q) =>
      q.eq("account_id", accountId).in("order_id", lote),
    );
    for (const it of items) {
      renglones.push({ orderId: it.order_id, skuInterno: it.sku_interno ?? null, cantidad: it.cantidad ?? 0, precio: it.precio != null ? Number(it.precio) : null, estado: it.estado ?? null });
    }
  }
  return { ordenes, renglones };
}
