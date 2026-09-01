/**
 * Sincronización con Mercado Libre para YAPANIZCEL.
 *
 * Baja tres cosas: el catálogo (publicaciones y su SKU), el stock en Full y
 * las ventas con su comisión y su neto real. Reutiliza las piezas genéricas
 * del cliente de MELI del calzado (recorrer publicaciones, leer user
 * products, stock de fulfillment); lo que es propio del negocio —qué se
 * guarda y cómo se desglosa el SKU— vive aquí.
 *
 * Dos reglas heredadas que aquí siguen valiendo:
 *   · El SKU de las publicaciones de Full vive en /user-products/{id}. Lo
 *     que no alcance a resolverse se anota en `yz_skus_pendientes` y se
 *     resuelve aparte, NUNCA se deduce.
 *   · Las órdenes también llegan sin SKU: se amarran por item+variación
 *     contra el catálogo. Tirar esos renglones deja el panel muy corto.
 */
import type { DB } from "../datos/repos";
import { upsertEnTandas } from "../datos/repos";
import { MeliClient } from "../meli/client";
import {
  claveItem,
  nuevoDiagnostico,
  obtenerCatalogo,
  obtenerStockFull,
  obtenerUsuario,
} from "../meli/sync";
import { clienteDeCuenta } from "./cuenta";
import { desglosar } from "./sku";
import { avanzarEstado, planearTramos, type EstadoVentas, type Tramo } from "./tramos";

/** Día del negocio (Ciudad de México, UTC-6 fijo) a partir de un instante ISO. */
export function diaLocal(iso: string): string {
  const t = new Date(iso).getTime();
  return new Date(t - 6 * 3_600_000).toISOString().slice(0, 10);
}

function hoyLocal(): string {
  return diaLocal(new Date().toISOString());
}

function restarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------
export interface ResumenCatalogo {
  skus: number;
  pendientes: number;
  repetidos: number;
}

export async function sincronizarCatalogo(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  meliUserId: number,
  limiteUserProductsMs = 60_000,
): Promise<ResumenCatalogo> {
  // Los amarres user_product -> SKU ya conocidos no se vuelven a preguntar.
  const { data: conocidos } = await admin
    .from("yz_skus")
    .select("user_product_id, sku")
    .eq("account_id", accountId)
    .not("user_product_id", "is", null);
  const cache = new Map<string, string>();
  for (const f of conocidos ?? []) if (f.user_product_id) cache.set(f.user_product_id, f.sku);

  const diag = nuevoDiagnostico();
  const filas = await obtenerCatalogo(cliente, meliUserId, { diag, cache, limiteUserProductsMs });

  const ahora = new Date().toISOString();
  const registros = filas.map((f) => {
    const d = desglosar(f.sku);
    return {
      account_id: accountId,
      sku: f.sku,
      item_id: f.itemId,
      variation_id: f.variationId,
      inventory_id: f.inventoryId,
      user_product_id: f.userProductId,
      titulo: f.titulo,
      logistica: f.logistica,
      estado: f.estado,
      precio: f.precio,
      diseno: d.diseno || null,
      modelo: d.modelo || null,
      color: d.color || null,
      actualizado_en: ahora,
    };
  });
  await upsertEnTandas(admin, "yz_skus", registros, "account_id,sku");

  // Lo que quedó sin SKU se apunta para resolverlo en segundo plano.
  const pendientes = diag.variantesSinSku
    .filter((v) => v.userProductId)
    .map((v) => ({
      account_id: accountId,
      item_id: v.itemId,
      variation_id: v.variationId ?? "",
      user_product_id: v.userProductId,
      inventory_id: v.inventoryId,
      titulo: v.titulo,
      logistica: v.logistica,
      estado: v.estado,
      precio: v.precio,
    }));
  if (pendientes.length) {
    await upsertEnTandas(admin, "yz_skus_pendientes", pendientes, "account_id,item_id,variation_id");
  }

  return { skus: registros.length, pendientes: pendientes.length, repetidos: diag.skusRepetidos.length };
}

// ---------------------------------------------------------------------------
// Stock en Full
// ---------------------------------------------------------------------------
export async function sincronizarStock(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  meliUserId: number,
): Promise<{ skus: number; errores: number }> {
  const { data: skus } = await admin
    .from("yz_skus")
    .select("sku, inventory_id")
    .eq("account_id", accountId);

  const { stock, errores } = await obtenerStockFull(
    cliente,
    meliUserId,
    (skus ?? []).map((s) => ({ sku: s.sku, inventoryId: s.inventory_id })),
  );

  const ahora = new Date().toISOString();
  const hoy = hoyLocal();

  await upsertEnTandas(
    admin,
    "yz_stock_full",
    stock.map((s) => ({
      account_id: accountId,
      sku: s.sku,
      disponible: s.disponible,
      en_transferencia: s.enTransferencia,
      no_disponible: s.noDisponible,
      total: s.total,
      actualizado_en: ahora,
    })),
    "account_id,sku",
  );

  // La foto del día. Es medición directa: con el tiempo es lo que permite
  // saber cuántos días de verdad hubo qué vender.
  await upsertEnTandas(
    admin,
    "yz_stock_snapshots",
    stock.map((s) => ({
      account_id: accountId,
      sku: s.sku,
      fecha: hoy,
      disponible: s.disponible,
      en_transferencia: s.enTransferencia,
    })),
    "account_id,sku,fecha",
  );

  return { skus: stock.length, errores: errores.length };
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------
interface OrdenMeli {
  id: number;
  status?: string;
  date_created: string;
  total_amount?: number;
  order_items?: {
    quantity?: number;
    unit_price?: number;
    sale_fee?: number;
    item?: {
      id?: string;
      seller_sku?: string | null;
      seller_custom_field?: string | null;
      variation_id?: number | string | null;
    };
  }[];
  payments?: { id?: number; status?: string }[];
}

interface Renglon {
  sku: string;
  unidades: number;
  importe: number;
  comision: number;
}

export interface OrdenLeida {
  id: number;
  fecha: string;
  total: number;
  pagos: number[];
  renglones: Renglon[];
}

/**
 * Baja las órdenes pagadas del periodo, con sus renglones ya amarrados a SKU
 * y con los ids de pago (de ahí sale el neto). Ventanas de 7 días porque el
 * offset de MELI topa en 10 000.
 */
export async function leerOrdenes(
  cliente: MeliClient,
  sellerId: number,
  desde: string,
  hasta: string,
  mapaItemSku: Map<string, string>,
): Promise<{ ordenes: OrdenLeida[]; sinSku: number; truncado: boolean }> {
  const ordenes: OrdenLeida[] = [];
  const vistas = new Set<number>();
  let sinSku = 0;
  let truncado = false;

  const ventanas: [string, string][] = [];
  let cursor = new Date(`${desde}T00:00:00.000-06:00`);
  const fin = new Date(`${hasta}T23:59:59.999-06:00`);
  while (cursor < fin) {
    const sig = new Date(cursor);
    sig.setUTCDate(sig.getUTCDate() + 7);
    ventanas.push([cursor.toISOString(), new Date(Math.min(+sig, +fin)).toISOString()]);
    cursor = sig;
  }

  for (const [ini, fin2] of ventanas) {
    let offset = 0;
    for (let pagina = 0; pagina < 200; pagina++) {
      const r = await cliente.get<{ results: OrdenMeli[] }>("/orders/search", {
        seller: sellerId,
        "order.date_created.from": ini,
        "order.date_created.to": fin2,
        "order.status": "paid",
        sort: "date_asc",
        limit: 51,
        offset,
      });
      const lote = r.results ?? [];
      if (!lote.length) break;

      for (const o of lote) {
        if (vistas.has(o.id)) continue;
        vistas.add(o.id);
        if (o.status && o.status !== "paid") continue;

        const porSku = new Map<string, Renglon>();
        for (const oi of o.order_items ?? []) {
          const sku =
            oi.item?.seller_sku?.trim() ||
            oi.item?.seller_custom_field?.trim() ||
            (oi.item?.id ? mapaItemSku.get(claveItem(oi.item.id, oi.item.variation_id)) : undefined) ||
            (oi.item?.id ? mapaItemSku.get(oi.item.id) : undefined);
          if (!sku) {
            sinSku++;
            continue;
          }
          const u = oi.quantity ?? 0;
          const s = porSku.get(sku) ?? { sku, unidades: 0, importe: 0, comision: 0 };
          s.unidades += u;
          s.importe += u * (oi.unit_price ?? 0);
          s.comision += u * (oi.sale_fee ?? 0);
          porSku.set(sku, s);
        }

        ordenes.push({
          id: o.id,
          fecha: diaLocal(o.date_created),
          total: o.total_amount ?? 0,
          pagos: (o.payments ?? [])
            .filter((p) => p.id && (!p.status || p.status === "approved"))
            .map((p) => Number(p.id)),
          renglones: [...porSku.values()],
        });
      }

      offset += lote.length;
      if (lote.length < 51) break;
      if (offset >= 9_950) {
        truncado = true;
        break;
      }
    }
  }

  return { ordenes, sinSku, truncado };
}

/**
 * Neto real por orden (net_received_amount de Mercado Pago), con caché.
 *
 * Los cargos de envío y retenciones llegan DIFERIDOS: una orden reciente se
 * vuelve a pedir hasta que cumple un día. Y hay tope por corrida, para no
 * comerse el tiempo: lo que falte lo recoge la siguiente.
 */
export async function completarNetos(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  ordenes: OrdenLeida[],
  tope = 150,
): Promise<Map<number, number>> {
  const netos = new Map<number, number>();
  if (!ordenes.length) return netos;

  const ids = ordenes.map((o) => o.id);
  const cache = new Map<number, { neto: number; actualizadoEn: string }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from("yz_ordenes_neto")
      .select("order_id, neto, actualizado_en")
      .eq("account_id", accountId)
      .in("order_id", ids.slice(i, i + 200));
    for (const f of data ?? []) {
      cache.set(Number(f.order_id), { neto: Number(f.neto), actualizadoEn: f.actualizado_en });
    }
  }

  const ayer = restarDias(hoyLocal(), 1);
  const hace3h = Date.now() - 3 * 3_600_000;
  const porPedir: OrdenLeida[] = [];
  for (const o of ordenes) {
    if (!o.pagos.length) continue;
    const c = cache.get(o.id);
    if (!c) porPedir.push(o);
    else if (o.fecha >= ayer && Date.parse(c.actualizadoEn) < hace3h) porPedir.push(o);
    else if (c.neto <= 0 && o.total > 0) porPedir.push(o);
  }

  const nuevas: Record<string, unknown>[] = [];
  for (const o of porPedir.slice(0, tope)) {
    try {
      let neto = 0;
      let algo = false;
      for (const pagoId of o.pagos) {
        const r = await cliente.get<{ net_received_amount?: number }>(`/collections/${pagoId}`);
        if (typeof r?.net_received_amount === "number") {
          neto += r.net_received_amount;
          algo = true;
        }
      }
      if (!algo) continue;
      cache.set(o.id, { neto, actualizadoEn: new Date().toISOString() });
      nuevas.push({
        account_id: accountId,
        order_id: o.id,
        payment_id: o.pagos[0],
        fecha: o.fecha,
        total: o.total,
        neto,
        actualizado_en: new Date().toISOString(),
      });
    } catch {
      // Se reintenta en la siguiente corrida.
    }
  }
  if (nuevas.length) await upsertEnTandas(admin, "yz_ordenes_neto", nuevas, "account_id,order_id");

  for (const [id, c] of cache) netos.set(id, c.neto);
  return netos;
}

/**
 * Agrega órdenes a renglones sku|día. El neto de cada orden se reparte a
 * sus renglones en proporción a su importe, y un día solo lleva neto cuando
 * TODAS sus órdenes ya lo tienen: un neto a medias engaña más que ninguno.
 */
export function agregarVentas(
  ordenes: OrdenLeida[],
  netos: Map<number, number>,
): { sku: string; fecha: string; unidades: number; ordenes: number; importe: number; comision: number; neto: number | null }[] {
  const acumulado = new Map<
    string,
    { sku: string; fecha: string; unidades: number; ordenes: number; importe: number; comision: number; neto: number }
  >();
  const diasIncompletos = new Set<string>();

  for (const o of ordenes) {
    const netoOrden = netos.get(o.id);
    if (netoOrden == null) diasIncompletos.add(o.fecha);
    const importeOrden = o.renglones.reduce((a, r) => a + r.importe, 0);

    for (const r of o.renglones) {
      const clave = `${r.sku}|${o.fecha}`;
      const s =
        acumulado.get(clave) ??
        { sku: r.sku, fecha: o.fecha, unidades: 0, ordenes: 0, importe: 0, comision: 0, neto: 0 };
      s.unidades += r.unidades;
      s.ordenes += 1;
      s.importe += r.importe;
      s.comision += r.comision;
      if (netoOrden != null && importeOrden > 0) s.neto += netoOrden * (r.importe / importeOrden);
      acumulado.set(clave, s);
    }
  }

  return [...acumulado.values()].map((s) => ({
    ...s,
    neto: diasIncompletos.has(s.fecha) ? null : Math.round(s.neto * 100) / 100,
  }));
}

export interface ResultadoVentas {
  tramos: { desde: string; hasta: string; ordenes: number; renglones: number; sinSku: number; truncado: boolean }[];
  /** true cuando el horizonte completo (90 días) ya está cubierto. */
  completo: boolean;
  estado: EstadoVentas;
}

async function leerEstado(admin: DB, accountId: string): Promise<EstadoVentas> {
  const { data } = await admin
    .from("yz_sync_estado")
    .select("ventas_desde, ventas_hasta")
    .eq("account_id", accountId)
    .maybeSingle();
  return { desde: data?.ventas_desde ?? null, hasta: data?.ventas_hasta ?? null };
}

async function guardarEstado(admin: DB, accountId: string, e: EstadoVentas): Promise<void> {
  await admin
    .from("yz_sync_estado")
    .upsert(
      { account_id: accountId, ventas_desde: e.desde, ventas_hasta: e.hasta, actualizado_en: new Date().toISOString() },
      { onConflict: "account_id" },
    );
}

/** Baja UN tramo de ventas y lo escribe completo (borra y reescribe el rango). */
async function sincronizarTramo(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  meliUserId: number,
  mapa: Map<string, string>,
  tramo: Tramo,
): Promise<ResultadoVentas["tramos"][number]> {
  const { ordenes, sinSku, truncado } = await leerOrdenes(cliente, meliUserId, tramo.desde, tramo.hasta, mapa);
  const netos = await completarNetos(admin, accountId, cliente, ordenes);
  const filas = agregarVentas(ordenes, netos);

  // El tramo se RECALCULA completo: si MELI reintenta o corrige una orden,
  // no se cuenta dos veces. Primero se vacía, luego se escribe.
  const { error } = await admin
    .from("yz_ventas_diarias")
    .delete()
    .eq("account_id", accountId)
    .gte("fecha", tramo.desde)
    .lte("fecha", tramo.hasta);
  if (error) throw new Error(`No se pudo limpiar el tramo de ventas: ${error.message}`);

  await upsertEnTandas(
    admin,
    "yz_ventas_diarias",
    filas.map((f) => ({ account_id: accountId, ...f })),
    "account_id,sku,fecha",
  );

  return { desde: tramo.desde, hasta: tramo.hasta, ordenes: ordenes.length, renglones: filas.length, sinSku, truncado };
}

/**
 * Ventas por tramos, con presupuesto de tiempo. Hace los tramos que
 * alcancen y deja apuntado hasta dónde llegó; la siguiente llamada sigue.
 */
export async function sincronizarVentas(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  meliUserId: number,
  opts: { limiteMs: number; t0?: number },
): Promise<ResultadoVentas> {
  const t0 = opts.t0 ?? Date.now();
  const hoy = hoyLocal();

  const { data: skus } = await admin
    .from("yz_skus")
    .select("sku, item_id, variation_id")
    .eq("account_id", accountId);
  const mapa = new Map<string, string>();
  for (const s of skus ?? []) {
    if (!s.item_id) continue;
    mapa.set(claveItem(s.item_id, s.variation_id), s.sku);
    if (!mapa.has(s.item_id)) mapa.set(s.item_id, s.sku);
  }

  let estado = await leerEstado(admin, accountId);
  const plan = planearTramos(estado, hoy);
  const hechos: ResultadoVentas["tramos"] = [];

  for (const tramo of plan) {
    // Siempre se hace al menos el primero (el reciente): si no, una cuenta
    // con el catálogo lento nunca vería una venta.
    if (hechos.length && Date.now() - t0 > opts.limiteMs) break;
    hechos.push(await sincronizarTramo(admin, accountId, cliente, meliUserId, mapa, tramo));
    estado = avanzarEstado(estado, tramo);
    await guardarEstado(admin, accountId, estado);
  }

  return { tramos: hechos, completo: hechos.length === plan.length, estado };
}

// ---------------------------------------------------------------------------
// Todo junto
// ---------------------------------------------------------------------------
export interface ResumenSync {
  cuenta: string;
  catalogo: ResumenCatalogo | null;
  stock: { skus: number; errores: number } | null;
  ventas: ResultadoVentas;
  /** false = quedaron tramos de ventas por bajar: hay que volver a llamar. */
  completo: boolean;
  ms: number;
}

/**
 * Sincronización de la cuenta, con presupuesto de tiempo.
 *
 * `continuar: true` salta catálogo y stock (ya se hicieron en la llamada
 * anterior) y solo sigue con los tramos de ventas que faltan. La pantalla
 * y el cron llaman en bucle hasta que `completo` sea true.
 */
export async function sincronizar(
  admin: DB,
  accountId: string,
  opts?: { presupuestoMs?: number; continuar?: boolean; limiteUserProductsMs?: number },
): Promise<ResumenSync> {
  const t0 = Date.now();
  const presupuesto = opts?.presupuestoMs ?? 200_000;
  const cliente = await clienteDeCuenta(admin, accountId);
  const usuario = await obtenerUsuario(cliente);

  let catalogo: ResumenCatalogo | null = null;
  let stock: { skus: number; errores: number } | null = null;
  try {
    if (!opts?.continuar) {
      catalogo = await sincronizarCatalogo(admin, accountId, cliente, usuario.id, opts?.limiteUserProductsMs ?? 45_000);
      stock = await sincronizarStock(admin, accountId, cliente, usuario.id);
    }
    const ventas = await sincronizarVentas(admin, accountId, cliente, usuario.id, { limiteMs: presupuesto, t0 });

    const resumen: ResumenSync = { cuenta: usuario.nickname, catalogo, stock, ventas, completo: ventas.completo, ms: Date.now() - t0 };
    await admin.from("yz_sync_log").insert({ account_id: accountId, ok: true, detalle: resumen });
    await admin
      .from("yz_cuentas")
      .update({ nickname: usuario.nickname, actualizado_en: new Date().toISOString() })
      .eq("id", accountId);
    return resumen;
  } catch (err) {
    await admin.from("yz_sync_log").insert({
      account_id: accountId,
      ok: false,
      detalle: { error: (err as Error).message, catalogo, stock, ms: Date.now() - t0 },
    });
    throw err;
  }
}
