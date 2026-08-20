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
import { detallarItems, dedupePorSku, esEnTransito, claveItem } from "../meli/sync";
import { aISO } from "../engine/fechas";
import { desglosarSku, guardarVentasDiarias } from "./sync";
import { invalidar } from "./cache";
import { traerTodo, type DB } from "../datos/repos";

/**
 * item+variación → SKU, desde el catálogo ya sincronizado. Es la misma
 * convención de clave que usa `obtenerVentas` en la sincronización completa.
 */
async function mapaItemSkuDe(db: DB, accountId: string): Promise<Map<string, string>> {
  const filas = await traerTodo<{ sku: string; item_id: string | null; variation_id: string | null }>(
    db,
    "skus",
    "sku, item_id, variation_id",
    (q) => q.eq("account_id", accountId).not("item_id", "is", null),
  );
  const mapa = new Map<string, string>();
  for (const f of filas ?? []) {
    if (!f.item_id) continue;
    mapa.set(claveItem(f.item_id, f.variation_id), f.sku);
    if (!f.variation_id) mapa.set(f.item_id, f.sku);
  }
  return mapa;
}

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
    // Los días se piensan en hora de México (-06:00), igual que las filas
    // de ventas_diarias que estos barridos reescriben.
    const dias = new Set<string>();
    for (const w of avisosOrden) {
      const t = new Date(w.recibido_en as string).getTime() - 6 * 3_600_000;
      dias.add(new Date(t).toISOString().slice(0, 10));
      dias.add(new Date(t - 24 * 3600 * 1000).toISOString().slice(0, 10));
    }
    try {
      // El mapa item+variación → SKU: muchas órdenes vienen SIN seller_sku
      // (el SKU vive en /user-products), y sin este amarre esas ventas se
      // perdían del panel. Es el mismo mapa que usa la sincronización.
      const mapaItemSku = await mapaItemSkuDe(db, accountId);
      for (const fecha of [...dias].sort()) {
        r.ventasTocadas += (await recalcularDiaVentas(db, accountId, cliente, fecha, mapaItemSku)).filas;
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
    item?: {
      id?: string;
      variation_id?: number | string | null;
      seller_sku?: string | null;
      seller_custom_field?: string | null;
    };
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
/**
 * Reparación del historial de ventas, una sola vez y en abonos.
 *
 * Durante un tiempo el barrido de avisos descartó las órdenes sin
 * seller_sku, así que los días que él reescribió quedaron con MENOS venta
 * de la real. Esto los vuelve a barrer — de ayer hacia atrás, hasta 60
 * días — unos cuantos por latido para no comerse la cuota ni el tiempo.
 * El avance vive en sync_log (tarea `reparacion_ventas_v6`): cuando llega
 * al fondo se marca completo y no vuelve a correr.
 */
export async function repararVentasHistoricas(
  db: DB,
  accountId: string,
  finMs: number,
): Promise<{ dias: number; completo: boolean }> {
  const { data: marca } = await db
    .from("sync_log")
    .select("detalle")
    .eq("account_id", accountId)
    .eq("tarea", "reparacion_ventas_v6")
    .eq("estado", "ok")
    .order("inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (marca?.detalle?.completo) return { dias: 0, completo: true };

  const ahoraMx = Date.now() - 6 * 3_600_000;
  const hoy = new Date(ahoraMx).toISOString().slice(0, 10);
  const fondo = new Date(ahoraMx - 60 * 86_400_000).toISOString().slice(0, 10);
  let fecha: string =
    typeof marca?.detalle?.siguiente === "string"
      ? marca.detalle.siguiente
      : new Date(ahoraMx - 86_400_000).toISOString().slice(0, 10);
  if (fecha >= hoy) fecha = new Date(ahoraMx - 86_400_000).toISOString().slice(0, 10);

  const cliente = await clienteDeCuenta(db, accountId);
  if (!cliente) return { dias: 0, completo: false };
  const mapaItemSku = await mapaItemSkuDe(db, accountId);

  let dias = 0;
  const bitacora: Record<string, unknown>[] = [];
  // Máximo 3 días por latido: cada día re-pide sus órdenes a MELI y sus
  // netos a Mercado Pago, y el latido tiene más cosas que hacer.
  while (fecha >= fondo && dias < 3 && Date.now() < finMs) {
    const r = await recalcularDiaVentas(db, accountId, cliente, fecha, mapaItemSku);
    // Leer de vuelta lo que QUEDÓ en la base: si el barrido dice 468 filas
    // y aquí aparecen 0, el problema es la escritura, no la lectura.
    const { data: eco } = await db
      .from("ventas_diarias")
      .select("unidades")
      .eq("account_id", accountId)
      .eq("fecha", fecha)
      .limit(2000);
    const enBase = (eco ?? []).length;
    const unidadesEnBase = (eco ?? []).reduce((a: number, f: any) => a + (f.unidades ?? 0), 0);
    bitacora.push({
      fecha,
      filas: r.filas,
      ordenes: r.ordenesLeidas,
      total: r.totalSegunMeli,
      enBase,
      unidadesEnBase,
    } as any);
    fecha = new Date(Date.parse(fecha) - 86_400_000).toISOString().slice(0, 10);
    dias++;
  }

  const completo = fecha < fondo;
  await db.from("sync_log").insert({
    account_id: accountId,
    tarea: "reparacion_ventas_v6",
    estado: "ok",
    fin: new Date().toISOString(),
    detalle: { siguiente: fecha, completo, dias, bitacora },
  });
  return { dias, completo };
}

interface ResultadoDia {
  filas: number;
  ordenesLeidas: number;
  totalSegunMeli: number | null;
}

async function recalcularDiaVentas(
  db: DB,
  accountId: string,
  cliente: MeliClient,
  fecha: string,
  mapaItemSku?: Map<string, string>,
): Promise<ResultadoDia> {
  const { data: cuenta } = await db
    .from("meli_accounts")
    .select("meli_user_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!cuenta) return { filas: 0, ordenesLeidas: 0, totalSegunMeli: null };

  // La ventana cubre el día COMPLETO en hora de México (-06:00), que es el
  // día del negocio y el del monitor, pero se manda en formato UTC (Z): es
  // el formato con el que la paginación de MELI está probada — con el
  // offset -06:00 en el texto, MELI regresaba bien la primera página y
  // cortaba las siguientes.
  const desde = new Date(`${fecha}T00:00:00.000-06:00`).toISOString();
  const hasta = new Date(`${fecha}T23:59:59.999-06:00`).toISOString();
  const acumulado = new Map<
    string,
    { unidades: number; ordenes: number; importe: number; comision: number }
  >();
  // Por orden, para el neto real: qué renglones (sku|día) la componen y con
  // qué peso, para repartir el depósito de la orden entre sus SKUs.
  const ordenes = new Map<
    number,
    { dia: string; paymentIds: number[]; total: number; renglones: { clave: string; importe: number }[] }
  >();
  // Una orden nueva que entra a media paginación recorre las demás: sin
  // esto, la misma orden puede salir en dos páginas y contarse doble.
  const vistas = new Set<number>();

  let totalSegunMeli: number | null = null;
  for (let offset = 0; offset < 5000; offset += 51) {
    const pagina = await cliente.get<{ results: OrdenMeli[]; paging?: { total?: number } }>("/orders/search", {
      seller: cuenta.meli_user_id,
      "order.date_created.from": desde,
      "order.date_created.to": hasta,
      "order.status": "paid",
      sort: "date_asc",
      limit: 51,
      offset,
    });
    const lote = pagina.results ?? [];
    if (offset === 0 && typeof pagina.paging?.total === "number") {
      totalSegunMeli = pagina.paging.total;
    }
    if (!lote.length) break;

    for (const o of lote) {
      if (vistas.has(o.id)) continue;
      vistas.add(o.id);
      const info = {
        dia: fecha,
        paymentIds: (o.payments ?? []).map((p) => p.id).filter((x): x is number => x != null),
        total: o.total_amount ?? 0,
        renglones: [] as { clave: string; importe: number }[],
      };
      // Los renglones se juntan por SKU DENTRO de la orden: así "ordenes"
      // cuenta órdenes que tocaron al SKU, no renglones de item.
      const porSku = new Map<string, { unidades: number; importe: number; comision: number }>();
      for (const oi of o.order_items ?? []) {
        // El mismo orden de amarre que la sincronización completa: el SKU de
        // la orden, y si no viene (variantes cuyo SKU vive en /user-products),
        // el catálogo por item+variación.
        const sku =
          oi.item?.seller_sku?.trim() ||
          oi.item?.seller_custom_field?.trim() ||
          (oi.item?.id ? mapaItemSku?.get(claveItem(oi.item.id, oi.item.variation_id)) : undefined) ||
          (oi.item?.id ? mapaItemSku?.get(oi.item.id) : undefined);
        if (!sku) continue;
        const s = porSku.get(sku) ?? { unidades: 0, importe: 0, comision: 0 };
        s.unidades += oi.quantity ?? 0;
        s.importe += (oi.quantity ?? 0) * (oi.unit_price ?? 0);
        s.comision += (oi.quantity ?? 0) * (oi.sale_fee ?? 0);
        porSku.set(sku, s);
      }
      for (const [sku, s] of porSku) {
        const clave = `${sku}|${fecha}`;
        const prev = acumulado.get(clave) ?? { unidades: 0, ordenes: 0, importe: 0, comision: 0 };
        prev.unidades += s.unidades;
        prev.ordenes += 1;
        prev.importe += s.importe;
        prev.comision += s.comision;
        acumulado.set(clave, prev);
        info.renglones.push({ clave, importe: s.importe });
      }
      if (info.renglones.length) ordenes.set(o.id, info);
    }
    if (lote.length < 51) break;
  }

  // CANDADO: si MELI reporta más órdenes de las que llegaron, la paginación
  // se quedó corta. Escribir (y sobre todo BORRAR faltantes) con un barrido
  // incompleto destruye días buenos: mejor tronar y que el siguiente latido
  // reintente. Margen de 2 por órdenes que entran a media paginación.
  if (totalSegunMeli !== null && vistas.size + 2 < totalSegunMeli) {
    throw new Error(
      `Barrido incompleto del ${fecha}: MELI reporta ${totalSegunMeli} órdenes y llegaron ${vistas.size}. No se escribe nada.`,
    );
  }
  // Sin total declarado y sin órdenes tampoco se confía: puede ser una
  // respuesta degradada de MELI, y "día vacío" borraría un día bueno.
  if (totalSegunMeli === null && vistas.size === 0) {
    const { count } = await db
      .from("ventas_diarias")
      .select("sku", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("fecha", fecha);
    if ((count ?? 0) > 0) {
      throw new Error(
        `MELI contestó vacío y sin total para el ${fecha}, pero el día tiene ${count} filas guardadas: no se toca.`,
      );
    }
  }

  // --- Neto real por orden (lo que MELI deposita) --------------------------
  const netoPorClave = await netosDelDia(db, accountId, cliente, ordenes);

  const filas = [...acumulado].map(([clave, v]) => {
    const sku = clave.slice(0, clave.lastIndexOf("|"));
    const base: Record<string, unknown> = {
      account_id: accountId,
      sku,
      fecha,
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

  // CANDADO DE PLAUSIBILIDAD: MELI a veces contesta la búsqueda de un día
  // VIEJO solo con las órdenes modificadas hace poco (un total chico que
  // hasta trae paging.total consistente, así que el candado de completitud
  // no lo ve). Reescribir con eso vacía días buenos. Regla: un día de hace
  // 2 o más días nunca puede encoger a menos de la mitad de lo guardado —
  // una cancelación real jamás borra medio día.
  const hace2dias = new Date(Date.now() - 6 * 3_600_000 - 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (fecha <= hace2dias) {
    const { data: guardadas } = await db
      .from("ventas_diarias")
      .select("unidades")
      .eq("account_id", accountId)
      .eq("fecha", fecha)
      .limit(2000);
    const unidadesGuardadas = (guardadas ?? []).reduce(
      (a: number, f: any) => a + (f.unidades ?? 0),
      0,
    );
    const unidadesNuevas = filas.reduce((a, f) => a + ((f.unidades as number) ?? 0), 0);
    if (unidadesGuardadas > 20 && unidadesNuevas < unidadesGuardadas * 0.5) {
      throw new Error(
        `Barrido implausible del ${fecha}: trae ${unidadesNuevas} unidades y el día tiene ${unidadesGuardadas} guardadas. Se descarta.`,
      );
    }
  }

  // El upsert de Supabase manda la UNIÓN de columnas de todo el lote y
  // rellena con NULL las ausentes: mezclar filas con y sin neto borraría
  // netos buenos. Se guardan por separado.
  const conNeto = filas.filter((f) => "neto" in f);
  const sinNeto = filas.filter((f) => !("neto" in f));
  if (conNeto.length) await guardarVentasDiarias(db, conNeto);
  if (sinNeto.length) await guardarVentasDiarias(db, sinNeto);

  // Las filas del día que YA no aparecen en el barrido son órdenes que se
  // cancelaron o reembolsaron: sin esto, contaban para siempre. SOLO se
  // borra cuando MELI declaró el total y el barrido lo cubrió: borrar con
  // una respuesta degradada vació días buenos.
  if (totalSegunMeli === null) {
    return { filas: filas.length, ordenesLeidas: vistas.size, totalSegunMeli };
  }
  const skusBarridos = new Set(filas.map((f) => f.sku as string));
  const { data: existentes } = await db
    .from("ventas_diarias")
    .select("sku")
    .eq("account_id", accountId)
    .eq("fecha", fecha);
  const sobrantes = (existentes ?? [])
    .map((e: any) => e.sku as string)
    .filter((s) => !skusBarridos.has(s));
  for (let i = 0; i < sobrantes.length; i += 100) {
    await db
      .from("ventas_diarias")
      .delete()
      .eq("account_id", accountId)
      .eq("fecha", fecha)
      .in("sku", sobrantes.slice(i, i + 100));
  }

  await db.from("sync_log").insert({
    account_id: accountId,
    tarea: "barrido_dia",
    estado: "ok",
    fin: new Date().toISOString(),
    detalle: {
      fecha,
      total: totalSegunMeli,
      ordenes: vistas.size,
      filas: filas.length,
      borradas: sobrantes.length,
    },
  });

  return { filas: filas.length, ordenesLeidas: vistas.size, totalSegunMeli };
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
    { dia: string; paymentIds: number[]; total: number; renglones: { clave: string; importe: number }[] }
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
    if (!o.paymentIds.length) continue;
    const c = cache.get(id);
    if (!c) porPedir.push(id);
    else if (o.dia >= ayer && Date.parse(c.actualizadoEn) < hace3h) porPedir.push(id);
    // Un neto cacheado en 0 con la orden cobrada es basura del error viejo
    // de multipagos (se guardaba solo el primer pago, aunque estuviera
    // rechazado): se vuelve a pedir sin importar la edad.
    else if (c.neto <= 0 && o.total > 0) porPedir.push(id);
  }

  // Tope por barrido para no comerse el tiempo: lo que falte lo recoge el
  // siguiente latido (corre cada pocos minutos).
  const nuevas: Record<string, unknown>[] = [];
  for (const id of porPedir.slice(0, 150)) {
    const o = ordenes.get(id)!;
    try {
      // Una orden puede tener VARIOS pagos (dos tarjetas, o un intento
      // rechazado y el bueno): el neto de la orden es la suma de todos.
      let neto = 0;
      let algunDato = false;
      for (const paymentId of o.paymentIds) {
        const r = await cliente.get<{ net_received_amount?: number }>(
          `/collections/${paymentId}`,
        );
        if (typeof r?.net_received_amount === "number") {
          neto += r.net_received_amount;
          algunDato = true;
        }
      }
      if (!algunDato) continue;
      cache.set(id, { neto, actualizadoEn: new Date().toISOString() });
      nuevas.push({
        account_id: accountId,
        order_id: id,
        payment_id: o.paymentIds[0],
        fecha: o.dia,
        total: o.total,
        neto,
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
