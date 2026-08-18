/**
 * Procesamiento de los avisos de Mercado Libre.
 *
 * El webhook solo los guarda. Aquí se convierten en datos: una venta nueva se
 * suma al día, un cambio de stock actualiza el SKU, una publicación editada
 * refresca su renglón del catálogo.
 *
 * La gracia de esto frente a la sincronización completa es el tamaño: en vez
 * de bajar 32 mil ventas y 21 mil movimientos, se toca UN registro. Por eso
 * puede correr cada pocos segundos sin despeinar a nadie.
 */
import { MeliClient } from "../meli/client";
import { detallarItems, dedupePorSku } from "../meli/sync";
import { aISO } from "../engine/fechas";
import { desglosarSku } from "./sync";
import { invalidar } from "./cache";
import type { DB } from "../datos/repos";

const ESTADOS_EN_TRANSITO = ["transfer", "inbound", "in_transit", "receiving", "pending"];

export interface ResultadoProceso {
  procesados: number;
  ventasTocadas: number;
  stockTocado: number;
  catalogoTocado: number;
  errores: string[];
  quedanPendientes: number;
}

/** Arma el cliente de MELI de una cuenta, renovando el token si hace falta. */
async function clienteDeCuenta(db: DB, accountId: string): Promise<MeliClient | null> {
  const { data: tok } = await db
    .from("meli_tokens")
    .select("access_token, refresh_token, expira_en")
    .eq("account_id", accountId)
    .maybeSingle();
  if (!tok) return null;

  return new MeliClient({
    clientId: process.env.MELI_CLIENT_ID!,
    clientSecret: process.env.MELI_CLIENT_SECRET!,
    credenciales: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiraEn: new Date(tok.expira_en).getTime(),
    },
    alRenovar: async (c) => {
      await db
        .from("meli_tokens")
        .update({
          access_token: c.accessToken,
          refresh_token: c.refreshToken,
          expira_en: new Date(c.expiraEn).toISOString(),
          actualizado_en: new Date().toISOString(),
        })
        .eq("account_id", accountId);
    },
  });
}

export async function procesarPendientes(
  db: DB,
  accountId: string,
  max = 40,
): Promise<ResultadoProceso> {
  const vacio: ResultadoProceso = {
    procesados: 0,
    ventasTocadas: 0,
    stockTocado: 0,
    catalogoTocado: 0,
    errores: [],
    quedanPendientes: 0,
  };

  const { data: pendientes } = await db
    .from("webhooks_meli")
    .select("id, topic, resource, intentos")
    .eq("account_id", accountId)
    .is("procesado_en", null)
    .lt("intentos", 4)
    .order("recibido_en", { ascending: true })
    .limit(max);

  if (!pendientes?.length) return vacio;

  const cliente = await clienteDeCuenta(db, accountId);
  if (!cliente) {
    return { ...vacio, errores: ["La cuenta no tiene tokens guardados."] };
  }

  const r: ResultadoProceso = { ...vacio };
  const idsListos: number[] = [];

  // Varios avisos suelen tocar el mismo recurso —MELI manda uno por cada
  // cambio— así que se agrupan: procesar el mismo pedido cinco veces no
  // aporta nada y sí gasta cuota.
  const vistos = new Set<string>();

  for (const w of pendientes) {
    const clave = `${w.topic}|${w.resource}`;
    if (vistos.has(clave)) {
      idsListos.push(w.id);
      continue;
    }
    vistos.add(clave);

    try {
      if (w.topic === "orders_v2" || w.topic === "orders") {
        if (await procesarOrden(db, accountId, cliente, w.resource)) r.ventasTocadas++;
      } else if (w.topic.includes("stock")) {
        if (await procesarStock(db, accountId, cliente, w.resource)) r.stockTocado++;
      } else if (w.topic === "items") {
        if (await procesarItem(db, accountId, cliente, w.resource)) r.catalogoTocado++;
      }
      idsListos.push(w.id);
      r.procesados++;
    } catch (err) {
      if (r.errores.length < 5) r.errores.push(`${w.topic}: ${(err as Error).message}`);
      await db
        .from("webhooks_meli")
        .update({ intentos: (w.intentos ?? 0) + 1, error: (err as Error).message })
        .eq("id", w.id);
    }
  }

  if (idsListos.length) {
    await db
      .from("webhooks_meli")
      .update({ procesado_en: new Date().toISOString() })
      .in("id", idsListos);
  }

  // El plan que estaba guardado ya no refleja la realidad.
  if (r.ventasTocadas || r.stockTocado || r.catalogoTocado) {
    await invalidar(db, accountId, "Llegaron novedades de Mercado Libre.");
  }

  const { count } = await db
    .from("webhooks_meli")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .is("procesado_en", null);

  r.quedanPendientes = count ?? 0;
  return r;
}

// ---------------------------------------------------------------------------
interface OrdenMeli {
  id: number;
  status?: string;
  date_created: string;
  order_items?: {
    quantity?: number;
    unit_price?: number;
    item?: { id?: string; seller_sku?: string | null; seller_custom_field?: string | null };
  }[];
}

/**
 * Una venta nueva.
 *
 * Se RECALCULA el día completo del SKU en vez de sumarle la orden: si el
 * mismo aviso llega dos veces —y MELI reintenta— sumar duplicaría la venta.
 * Recalcular es idempotente.
 */
async function procesarOrden(
  db: DB,
  accountId: string,
  cliente: MeliClient,
  resource: string,
): Promise<boolean> {
  const orden = await cliente.get<OrdenMeli>(resource);
  if (!orden?.date_created) return false;
  if (orden.status && orden.status !== "paid") return false;

  const fecha = orden.date_created.slice(0, 10);
  const skus = new Set<string>();
  for (const oi of orden.order_items ?? []) {
    const sku = oi.item?.seller_sku?.trim() || oi.item?.seller_custom_field?.trim();
    if (sku) skus.add(sku);
  }
  if (!skus.size) return false;

  const sellerId = Number(orden.id) ? undefined : undefined;
  void sellerId;

  // Se vuelve a pedir el día entero de esos SKUs para quedar exactos.
  const { data: cuenta } = await db
    .from("meli_accounts")
    .select("meli_user_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!cuenta) return false;

  const desde = `${fecha}T00:00:00.000Z`;
  const hasta = `${fecha}T23:59:59.999Z`;
  const acumulado = new Map<string, { unidades: number; ordenes: number; importe: number }>();

  for (let offset = 0; offset < 5000; offset += 51) {
    const pagina = await cliente.get<{ results: OrdenMeli[] }>("/orders/search", {
      seller: cuenta.meli_user_id,
      "order.date_created.from": desde,
      "order.date_created.to": hasta,
      "order.status": "paid",
      limit: 51,
      offset,
    });
    const lote = pagina.results ?? [];
    if (!lote.length) break;

    for (const o of lote) {
      for (const oi of o.order_items ?? []) {
        const sku = oi.item?.seller_sku?.trim() || oi.item?.seller_custom_field?.trim();
        if (!sku || !skus.has(sku)) continue;
        const prev = acumulado.get(sku) ?? { unidades: 0, ordenes: 0, importe: 0 };
        prev.unidades += oi.quantity ?? 0;
        prev.ordenes += 1;
        prev.importe += (oi.quantity ?? 0) * (oi.unit_price ?? 0);
        acumulado.set(sku, prev);
      }
    }
    if (lote.length < 51) break;
  }

  const filas = [...acumulado].map(([sku, v]) => ({
    account_id: accountId,
    sku,
    fecha,
    unidades: v.unidades,
    ordenes: v.ordenes,
    importe: v.importe,
  }));

  if (filas.length) {
    await db.from("ventas_diarias").upsert(filas, { onConflict: "account_id,sku,fecha" });
  }
  return filas.length > 0;
}

/** Cambio de stock en Full de un inventario. */
async function procesarStock(
  db: DB,
  accountId: string,
  cliente: MeliClient,
  resource: string,
): Promise<boolean> {
  // El recurso viene como /inventories/CDID70757/stock/fulfillment o similar.
  const m = resource.match(/inventories\/([^/]+)/i);
  const inventoryId = m?.[1];
  if (!inventoryId) return false;

  const { data: sku } = await db
    .from("skus")
    .select("sku")
    .eq("account_id", accountId)
    .eq("inventory_id", inventoryId)
    .maybeSingle();
  if (!sku) return false;

  const { data: cuenta } = await db
    .from("meli_accounts")
    .select("meli_user_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!cuenta) return false;

  const r = await cliente.get<{
    total?: number;
    available_quantity?: number;
    not_available_quantity?: number;
    not_available_detail?: { status?: string; quantity?: number }[];
  }>(`/inventories/${inventoryId}/stock/fulfillment`, { seller_id: cuenta.meli_user_id });

  let enTransferencia = 0;
  let noDisponible = 0;
  for (const d of r.not_available_detail ?? []) {
    const q = d.quantity ?? 0;
    const e = (d.status ?? "").toLowerCase();
    if (ESTADOS_EN_TRANSITO.some((t) => e.includes(t))) enTransferencia += q;
    else noDisponible += q;
  }

  const disponible = r.available_quantity ?? 0;
  const ahora = new Date().toISOString();

  await db.from("stock_full").upsert(
    {
      account_id: accountId,
      sku: sku.sku,
      disponible,
      en_transferencia: enTransferencia,
      no_disponible: noDisponible,
      total: r.total ?? disponible + (r.not_available_quantity ?? 0),
      actualizado_en: ahora,
    },
    { onConflict: "account_id,sku" },
  );

  // La foto del día se actualiza con el último valor conocido: así el cierre
  // del día queda con el nivel real y no con el de la mañana.
  await db.from("stock_snapshots").upsert(
    {
      account_id: accountId,
      sku: sku.sku,
      fecha: aISO(new Date()),
      disponible,
      en_transferencia: enTransferencia,
      origen: "snapshot",
    },
    { onConflict: "account_id,sku,fecha" },
  );

  return true;
}

/** Una publicación cambió: precio, estado, o su SKU. */
async function procesarItem(
  db: DB,
  accountId: string,
  cliente: MeliClient,
  resource: string,
): Promise<boolean> {
  const itemId = resource.split("/").filter(Boolean).pop();
  if (!itemId) return false;

  const filas = dedupePorSku(await detallarItems(cliente, [itemId]));
  if (!filas.length) return false;

  await db.from("skus").upsert(
    filas.map((f) => {
      const d = desglosarSku(f.sku);
      return {
        account_id: accountId,
        sku: f.sku,
        item_id: f.itemId,
        variation_id: f.variationId,
        inventory_id: f.inventoryId,
        titulo: f.titulo,
        logistica: f.logistica,
        estado: f.estado,
        precio: f.precio,
        modelo: d.modelo,
        color: d.color,
        talla: d.talla,
        activo: true,
        actualizado_en: new Date().toISOString(),
      };
    }),
    { onConflict: "account_id,sku" },
  );

  return true;
}
