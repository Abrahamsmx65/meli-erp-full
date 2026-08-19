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
import { detallarItems, dedupePorSku, esEnTransito } from "../meli/sync";
import { aISO } from "../engine/fechas";
import { desglosarSku, guardarVentasDiarias } from "./sync";
import { invalidar } from "./cache";
import type { DB } from "../datos/repos";

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
  max = 300,
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
    .select("id, topic, resource, intentos, recibido_en")
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

  // --- Órdenes: por DÍA, no por aviso -------------------------------------
  // Recalcular una venta exige re-pedir el día completo a MELI (~17 páginas).
  // Hacer eso por cada aviso, cuando un día de ventas trae cientos de avisos,
  // era regalar la cuota: el mismo día se recalculaba cientos de veces. Se
  // juntan los días que estos avisos tocan y cada día se pide UNA vez. El día
  // se deduce de cuándo llegó el aviso (MELI avisa al momento), con un día de
  // colchón hacia atrás por los husos y las órdenes de medianoche.
  const avisosOrden = pendientes.filter(
    (w) => w.topic === "orders_v2" || w.topic === "orders",
  );
  if (avisosOrden.length) {
    const dias = new Set<string>();
    for (const w of avisosOrden) {
      const t = new Date(w.recibido_en as string).getTime();
      dias.add(new Date(t).toISOString().slice(0, 10));
      dias.add(new Date(t - 24 * 3600 * 1000).toISOString().slice(0, 10));
    }
    try {
      for (const fecha of [...dias].sort()) {
        r.ventasTocadas += await recalcularDiaVentas(db, accountId, cliente, fecha);
      }
      for (const w of avisosOrden) idsListos.push(w.id);
      r.procesados += avisosOrden.length;
    } catch (err) {
      // Si MELI no dejó terminar, estos avisos se quedan y se reintentan en
      // el siguiente latido; los días son idempotentes, repetirlos no daña.
      if (r.errores.length < 5) r.errores.push(`ordenes: ${(err as Error).message}`);
    }
  }

  // --- Stock y catálogo: por recurso, deduplicado --------------------------
  const vistos = new Set<string>();

  for (const w of pendientes) {
    if (w.topic === "orders_v2" || w.topic === "orders") continue;

    const clave = `${w.topic}|${w.resource}`;
    if (vistos.has(clave)) {
      idsListos.push(w.id);
      continue;
    }
    vistos.add(clave);

    try {
      if (w.topic.includes("stock")) {
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
  total_amount?: number;
  payments?: { id?: number }[];
  order_items?: {
    quantity?: number;
    unit_price?: number;
    sale_fee?: number;
    item?: { id?: string; seller_sku?: string | null; seller_custom_field?: string | null };
  }[];
}

/**
 * Recalcula las ventas de UN día completo, para todos los SKUs.
 *
 * Se re-pide el día entero a MELI y se reescribe lo encontrado: si el mismo
 * aviso llega dos veces —y MELI reintenta— el resultado es idéntico.
 * Recalcular es idempotente, y un solo barrido cubre todos los avisos de
 * órdenes de ese día, sean tres o trescientos.
 */
async function recalcularDiaVentas(
  db: DB,
  accountId: string,
  cliente: MeliClient,
  fecha: string,
): Promise<number> {
  const { data: cuenta } = await db
    .from("meli_accounts")
    .select("meli_user_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!cuenta) return 0;

  const desde = `${fecha}T00:00:00.000Z`;
  const hasta = `${fecha}T23:59:59.999Z`;
  // sku → por día de creación de la orden (el barrido puede rozar dos días)
  const acumulado = new Map<
    string,
    { unidades: number; ordenes: number; importe: number; comision: number }
  >();
  // Por orden, para el neto real: qué renglones (sku|día) la componen y con
  // qué peso, para repartir el depósito de la orden entre sus SKUs.
  const ordenes = new Map<
    number,
    { dia: string; paymentId: number | null; total: number; renglones: { clave: string; importe: number }[] }
  >();

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
      const dia = o.date_created?.slice(0, 10) ?? fecha;
      const info = {
        dia,
        paymentId: o.payments?.[0]?.id ?? null,
        total: o.total_amount ?? 0,
        renglones: [] as { clave: string; importe: number }[],
      };
      for (const oi of o.order_items ?? []) {
        const sku = oi.item?.seller_sku?.trim() || oi.item?.seller_custom_field?.trim();
        if (!sku) continue;
        const clave = `${sku}|${dia}`;
        const prev = acumulado.get(clave) ?? { unidades: 0, ordenes: 0, importe: 0, comision: 0 };
        const importeItem = (oi.quantity ?? 0) * (oi.unit_price ?? 0);
        prev.unidades += oi.quantity ?? 0;
        prev.ordenes += 1;
        prev.importe += importeItem;
        prev.comision += (oi.quantity ?? 0) * (oi.sale_fee ?? 0);
        acumulado.set(clave, prev);
        info.renglones.push({ clave, importe: importeItem });
      }
      if (info.renglones.length) ordenes.set(o.id, info);
    }
    if (lote.length < 51) break;
  }

  // --- Neto real por orden (lo que MELI deposita) --------------------------
  const netoPorClave = await netosDelDia(db, accountId, cliente, ordenes);

  const filas = [...acumulado].map(([clave, v]) => {
    const [sku, dia] = [clave.slice(0, clave.lastIndexOf("|")), clave.slice(clave.lastIndexOf("|") + 1)];
    const base: Record<string, unknown> = {
      account_id: accountId,
      sku,
      fecha: dia,
      unidades: v.unidades,
      ordenes: v.ordenes,
      importe: v.importe,
      comision: v.comision,
    };
    // El neto solo se escribe cuando el día quedó completo: escribir un
    // parcial pisaría un valor bueno con uno a medias.
    const neto = netoPorClave.get(clave);
    if (neto !== undefined) base.neto = Math.round(neto * 100) / 100;
    return base;
  });

  await guardarVentasDiarias(db, filas);
  return filas.length;
}

/**
 * El neto real (net_received_amount) de cada orden del barrido, repartido a
 * los renglones sku|día en proporción a su importe.
 *
 * Va con caché en `ordenes_neto` porque cada consulta a Mercado Pago cuesta
 * una llamada: solo se piden las órdenes nuevas y las recientes (los cargos
 * de envío y retenciones llegan DIFERIDOS, minutos después del pago, así que
 * una orden se re-lee hasta que cumple un día). Devuelve el neto por clave
 * solo para los días donde TODAS sus órdenes ya tienen neto conocido.
 */
async function netosDelDia(
  db: DB,
  accountId: string,
  cliente: MeliClient,
  ordenes: Map<
    number,
    { dia: string; paymentId: number | null; total: number; renglones: { clave: string; importe: number }[] }
  >,
): Promise<Map<string, number>> {
  const vacio = new Map<string, number>();
  if (!ordenes.size) return vacio;

  // Caché existente. Si la tabla no existe (migración 0012 pendiente), el
  // neto simplemente no se calcula todavía.
  const ids = [...ordenes.keys()];
  const cache = new Map<number, { neto: number; actualizadoEn: string }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("ordenes_neto")
      .select("order_id, neto, actualizado_en")
      .eq("account_id", accountId)
      .in("order_id", ids.slice(i, i + 200));
    if (error) return vacio;
    for (const f of data ?? []) {
      cache.set(Number(f.order_id), { neto: Number(f.neto), actualizadoEn: f.actualizado_en });
    }
  }

  // ¿Cuáles hay que pedir? Las que no están, y las recientes con caché de
  // hace más de 3 horas (por los cargos diferidos).
  const ayer = new Date(Date.now() - 36 * 3_600_000).toISOString().slice(0, 10);
  const hace3h = Date.now() - 3 * 3_600_000;
  const porPedir: number[] = [];
  for (const [id, o] of ordenes) {
    if (!o.paymentId) continue;
    const c = cache.get(id);
    if (!c) porPedir.push(id);
    else if (o.dia >= ayer && Date.parse(c.actualizadoEn) < hace3h) porPedir.push(id);
  }

  // Tope por barrido para no comerse el tiempo: lo que falte lo recoge el
  // siguiente latido (corre cada pocos minutos).
  const nuevas: Record<string, unknown>[] = [];
  for (const id of porPedir.slice(0, 150)) {
    const o = ordenes.get(id)!;
    try {
      const r = await cliente.get<{ net_received_amount?: number }>(
        `/collections/${o.paymentId}`,
      );
      if (typeof r?.net_received_amount !== "number") continue;
      cache.set(id, { neto: r.net_received_amount, actualizadoEn: new Date().toISOString() });
      nuevas.push({
        account_id: accountId,
        order_id: id,
        payment_id: o.paymentId,
        fecha: o.dia,
        total: o.total,
        neto: r.net_received_amount,
        actualizado_en: new Date().toISOString(),
      });
    } catch {
      // Sin drama: se reintenta en el siguiente barrido.
    }
  }
  if (nuevas.length) {
    await db.from("ordenes_neto").upsert(nuevas, { onConflict: "account_id,order_id" });
  }

  // Repartir el neto de cada orden entre sus renglones, y solo entregar los
  // días completos (todas sus órdenes con neto conocido).
  const porClave = new Map<string, number>();
  const diasIncompletos = new Set<string>();
  for (const [id, o] of ordenes) {
    const c = cache.get(id);
    if (!c) {
      diasIncompletos.add(o.dia);
      continue;
    }
    const importeOrden = o.renglones.reduce((a, r) => a + r.importe, 0);
    if (importeOrden <= 0) continue;
    for (const r of o.renglones) {
      porClave.set(r.clave, (porClave.get(r.clave) ?? 0) + c.neto * (r.importe / importeOrden));
    }
  }
  for (const clave of [...porClave.keys()]) {
    const dia = clave.slice(clave.lastIndexOf("|") + 1);
    if (diasIncompletos.has(dia)) porClave.delete(clave);
  }
  return porClave;
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
    // La misma clasificación que usa la sincronización: si divergen, el
    // webhook y el sync escriben cifras distintas sobre la misma tabla.
    if (esEnTransito(d.status)) enTransferencia += q;
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
