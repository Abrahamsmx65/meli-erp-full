/**
 * Sincronización de Amazon que corre en Vercel Cron.
 *
 * Dos tareas con ritmos distintos:
 *
 *  - Ventas: por la API de Pedidos, cada 15 minutos. Amazon limita getOrders a
 *    UNA llamada por minuto, así que solo sirve para ventanas cortas; el
 *    histórico se cargó aparte con reportes.
 *  - Inventario: por reporte plano, cada hora y en dos pasos. Paginar el
 *    inventario por API son cientos de llamadas para este catálogo y el token
 *    de paginación caduca a medio camino.
 */
import type { Cliente } from "./spapi";
import {
  INVENTARIO_FBA,
  decimal,
  descargarReporte,
  entero,
  estadoReporte,
  solicitarReporte,
} from "./reportes";

/** Una orden puede actualizarse tarde; el cursor retrocede para no perderla. */
const SOLAPE_HORAS = 6;
const LOTE = 500;

export interface ResultadoVentas {
  ordenes: number;
  partidas: number;
  filasVenta: number;
  truncado: boolean;
}

export interface ResultadoInventario {
  estado: "solicitado" | "procesando" | "cargado" | "vacio" | "reintentar";
  skus?: number;
}

const CANCELADAS = new Set(["cancelled", "canceled"]);

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Desfase del marketplace: decide a qué día local se asigna cada venta. */
function husoDe(marketplaceId: string): number {
  const husos: Record<string, number> = {
    A1AM78C64UM0Y8: -6, // México
    ATVPDKIKX0DER: -8, // Estados Unidos
    A2EUQ1WTGCTBG2: -8, // Canadá
  };
  return husos[marketplaceId] ?? 0;
}

function fechaLocal(iso8601: string, huso: number): string | null {
  const t = Date.parse(iso8601);
  if (Number.isNaN(t)) return null;
  return new Date(t + huso * 3_600_000).toISOString().slice(0, 10);
}

async function guardarEnLotes(admin: any, tabla: string, filas: any[]): Promise<void> {
  for (let i = 0; i < filas.length; i += LOTE) {
    const { error } = await admin.from(tabla).upsert(filas.slice(i, i + LOTE));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------
export async function sincronizarVentas(
  admin: any,
  cliente: Cliente,
): Promise<ResultadoVentas> {
  const accountId = cliente.cuenta.accountId;

  const { data: estado } = await admin
    .from("amazon_sync_estado")
    .select("cursor_ts")
    .eq("account_id", accountId)
    .eq("tarea", "cron_ventas")
    .maybeSingle();

  const previo = estado?.cursor_ts ? Date.parse(estado.cursor_ts) : NaN;
  const desde = new Date(
    Number.isNaN(previo)
      ? Date.now() - 7 * 86_400_000
      : previo - SOLAPE_HORAS * 3_600_000,
  );

  const ordenes: any[] = [];
  let token: string | undefined;
  let truncado = false;

  do {
    const params: Record<string, string | number | undefined> = token
      ? { MarketplaceIds: cliente.cuenta.marketplaceId, NextToken: token }
      : {
          MarketplaceIds: cliente.cuenta.marketplaceId,
          LastUpdatedAfter: iso(desde),
          MaxResultsPerPage: 100,
        };

    const r = await cliente.llamar<any>("GET", "/orders/v0/orders", "getOrders", { params });
    // Sin respuesta = se acabó el plazo o la cuota; lo conseguido se guarda igual.
    if (!r) {
      truncado = true;
      break;
    }

    const carga = r.payload ?? r;
    ordenes.push(...(carga.Orders ?? []));
    token = carga.NextToken;
  } while (token);

  if (ordenes.length === 0) {
    await avanzarCursor(admin, accountId, truncado);
    return { ordenes: 0, partidas: 0, filasVenta: 0, truncado };
  }

  const huso = husoDe(cliente.cuenta.marketplaceId);
  const fechas = new Map<string, string>();
  const estados = new Map<string, string>();

  const filasOrden = ordenes.map((o: any) => {
    const id = o.AmazonOrderId as string;
    estados.set(id, String(o.OrderStatus ?? ""));
    const f = fechaLocal(o.PurchaseDate, huso);
    if (f) fechas.set(id, f);
    return {
      account_id: accountId,
      amazon_order_id: id,
      fecha_compra: o.PurchaseDate ?? null,
      fecha_actualizacion: o.LastUpdateDate ?? null,
      estado: o.OrderStatus ?? null,
      canal_logistico: o.FulfillmentChannel ?? null,
      canal_venta: o.SalesChannel ?? null,
      marketplace_id: o.MarketplaceId ?? null,
      total: o.OrderTotal?.Amount ? decimal(o.OrderTotal.Amount) : null,
      moneda: o.OrderTotal?.CurrencyCode ?? null,
      items_enviados: entero(o.NumberOfItemsShipped),
      items_pendientes: entero(o.NumberOfItemsUnshipped),
      es_negocio: Boolean(o.IsBusinessOrder),
      // Sin datos del comprador: por eso no hacen falta los roles de PII.
      detalle: { OrderType: o.OrderType ?? null, IsPrime: o.IsPrime ?? null },
    };
  });

  await guardarEnLotes(admin, "amazon_ordenes", filasOrden);

  const partidas: any[] = [];
  for (const o of filasOrden) {
    const r = await cliente.llamar<any>(
      "GET",
      `/orders/v0/orders/${o.amazon_order_id}/orderItems`,
      "getOrderItems",
    );
    if (!r) {
      truncado = true;
      break;
    }
    for (const it of (r.payload ?? r).OrderItems ?? []) {
      partidas.push({
        account_id: accountId,
        amazon_order_id: o.amazon_order_id,
        order_item_id: it.OrderItemId,
        seller_sku: it.SellerSKU ?? null,
        asin: it.ASIN ?? null,
        titulo: it.Title ?? null,
        cantidad: entero(it.QuantityOrdered),
        cantidad_enviada: entero(it.QuantityShipped),
        precio: it.ItemPrice?.Amount ? decimal(it.ItemPrice.Amount) : null,
        impuesto: it.ItemTax?.Amount ? decimal(it.ItemTax.Amount) : null,
        descuento: it.PromotionDiscount?.Amount ? decimal(it.PromotionDiscount.Amount) : null,
        moneda: it.ItemPrice?.CurrencyCode ?? null,
      });
    }
  }

  await guardarEnLotes(admin, "amazon_orden_items", partidas);

  // Agregado diario por SKU: es lo que consume la pantalla.
  const acumulado = new Map<string, any>();
  const pedidosPorClave = new Map<string, Set<string>>();

  for (const p of partidas) {
    const fecha = fechas.get(p.amazon_order_id);
    if (!p.seller_sku || !fecha) continue;
    if (CANCELADAS.has((estados.get(p.amazon_order_id) ?? "").toLowerCase())) continue;

    const clave = `${p.seller_sku}|${fecha}`;
    const reg = acumulado.get(clave) ?? {
      account_id: accountId,
      seller_sku: p.seller_sku,
      fecha,
      unidades: 0,
      ordenes: 0,
      importe: 0,
      moneda: p.moneda,
    };
    reg.unidades += p.cantidad;
    reg.importe += p.precio ?? 0;
    acumulado.set(clave, reg);

    const vistos = pedidosPorClave.get(clave) ?? new Set<string>();
    vistos.add(p.amazon_order_id);
    pedidosPorClave.set(clave, vistos);
  }

  const filasVenta = [...acumulado.entries()].map(([clave, reg]) => ({
    ...reg,
    ordenes: pedidosPorClave.get(clave)?.size ?? 0,
    importe: Math.round(reg.importe * 100) / 100,
  }));

  await guardarEnLotes(admin, "amazon_ventas_diarias", filasVenta);
  await avanzarCursor(admin, accountId, truncado);

  return {
    ordenes: filasOrden.length,
    partidas: partidas.length,
    filasVenta: filasVenta.length,
    truncado,
  };
}

/**
 * El cursor solo avanza si se procesó TODO. Si la corrida se quedó a medias,
 * dejarlo donde estaba hace que la siguiente recupere lo que faltó.
 */
async function avanzarCursor(admin: any, accountId: string, truncado: boolean) {
  if (truncado) return;
  await admin.from("amazon_sync_estado").upsert({
    account_id: accountId,
    tarea: "cron_ventas",
    cursor_ts: new Date().toISOString(),
    actualizado_en: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------
export async function sincronizarInventario(
  admin: any,
  cliente: Cliente,
): Promise<ResultadoInventario> {
  const accountId = cliente.cuenta.accountId;

  const { data: estado } = await admin
    .from("amazon_sync_estado")
    .select("datos")
    .eq("account_id", accountId)
    .eq("tarea", "cron_inventario")
    .maybeSingle();

  const pendiente: string | undefined = estado?.datos?.reportId;

  const anotar = (datos: Record<string, unknown>) =>
    admin.from("amazon_sync_estado").upsert({
      account_id: accountId,
      tarea: "cron_inventario",
      datos,
      actualizado_en: new Date().toISOString(),
    });

  // Paso 1: no hay reporte pendiente, se pide uno y se recoge la próxima vez.
  if (!pendiente) {
    const reportId = await solicitarReporte(cliente, INVENTARIO_FBA, cliente.cuenta.marketplaceId);
    if (!reportId) return { estado: "reintentar" };
    await anotar({ reportId, pedidoEn: new Date().toISOString() });
    return { estado: "solicitado" };
  }

  // Paso 2: recoger el que quedó pendiente.
  const st = await estadoReporte(cliente, pendiente);

  if (st.estado === "procesando") return { estado: "procesando" };

  if (st.estado === "fallido" || st.estado === "vacio") {
    // Amazon a veces marca FATAL un reporte válido; se descarta y se vuelve a pedir.
    await anotar({});
    return { estado: st.estado === "vacio" ? "vacio" : "reintentar" };
  }

  const filas = await descargarReporte(cliente, st.documentId);
  await anotar({});
  if (filas.length === 0) return { estado: "vacio" };

  const ahora = new Date().toISOString();
  const hoy = ahora.slice(0, 10);

  const inventario = filas
    .filter((f) => (f["sku"] ?? f["seller-sku"] ?? "") !== "")
    .map((f) => {
      const trabajando = entero(f["afn-inbound-working-quantity"]);
      const enviado = entero(f["afn-inbound-shipped-quantity"]);
      const recibiendo = entero(f["afn-inbound-receiving-quantity"]);
      return {
        account_id: accountId,
        seller_sku: f["sku"] || f["seller-sku"],
        asin: f["asin"] || null,
        fnsku: f["fnsku"] || null,
        condicion: f["condition"] || null,
        disponible: entero(f["afn-fulfillable-quantity"]),
        reservado: entero(f["afn-reserved-quantity"]),
        entrante_trabajando: trabajando,
        entrante_enviado: enviado,
        entrante_recibiendo: recibiendo,
        en_transferencia: trabajando + enviado + recibiendo,
        no_disponible: entero(f["afn-unsellable-quantity"]),
        investigando: entero(f["afn-researching-quantity"]),
        total: entero(f["afn-total-quantity"]),
        detalle: {},
        actualizado_en: ahora,
      };
    });

  await guardarEnLotes(admin, "amazon_inventario", inventario);

  // Foto del día: es lo que con el tiempo deja medir agotamientos reales.
  await guardarEnLotes(
    admin,
    "amazon_inventario_snapshots",
    inventario.map((i) => ({
      account_id: i.account_id,
      seller_sku: i.seller_sku,
      fecha: hoy,
      disponible: i.disponible,
      en_transferencia: i.en_transferencia,
      reservado: i.reservado,
      total: i.total,
      origen: "cron",
    })),
  );

  return { estado: "cargado", skus: inventario.length };
}
