/**
 * El neto real de cada orden de YAPANIZCEL, orden por orden y en segundo plano.
 *
 * Mercado Pago solo entrega el neto (net_received_amount: ya sin comisión,
 * envío de Full ni retenciones de ISR/IVA) pago por pago, y esta cuenta
 * vende ~1,400 órdenes al día: no cabe en la sincronización. Por eso:
 *
 *   1. Cada orden se REGISTRA al leerla (`registrarOrdenes`): id, pagos,
 *      total, día y sus renglones sku/importe. Neto 0 = todavía no se sabe.
 *   2. Un trabajo de fondo (`completarNetosPendientes`, cron cada 10 min)
 *      pide los netos que falten, de lo más reciente hacia atrás.
 *   3. Cuando TODAS las órdenes de un día ya tienen neto, se ASIENTA en
 *      yz_ventas_diarias repartiendo el neto de cada orden entre sus SKUs en
 *      proporción a su importe (`asentarNetos`), sin volver a leer MELI.
 *   4. Las órdenes de días viejos que nunca se registraron (de antes de este
 *      mecanismo) se van registrando hacia atrás (`registrarHistoria`).
 *
 * Mientras un día no está completo, el panel ESTIMA con el porcentaje
 * observado y lo declara (ventas.ts).
 */
import type { DB } from "../datos/repos";
import { upsertEnTandas } from "../datos/repos";
import type { MeliClient } from "../meli/client";
import { claveItem, obtenerUsuario } from "../meli/sync";
import { clienteDeCuenta } from "./cuenta";
import { hoyMx, restarDias, todo } from "./db";
import { leerOrdenes, type OrdenLeida } from "./sync";

const redondea = (x: number) => Math.round(x * 100) / 100;

/**
 * Registra las órdenes (sin tocar el neto de las que ya lo tienen).
 *
 * INCREMENTAL: el tramo reciente relee 7 días (~10 mil órdenes) cada
 * corrida y volver a escribirlas todas con sus renglones se pasaba del
 * tiempo de Vercel; solo se escriben las que aún no están registradas con
 * renglones. Devuelve cuántas se escribieron.
 */
export async function registrarOrdenes(admin: DB, accountId: string, ordenes: OrdenLeida[]): Promise<number> {
  if (!ordenes.length) return 0;
  const yaRegistradas = new Set<number>();
  const ids = ordenes.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await admin
      .from("yz_ordenes_neto")
      .select("order_id")
      .eq("account_id", accountId)
      .in("order_id", ids.slice(i, i + 500))
      .not("renglones", "is", null);
    for (const f of data ?? []) yaRegistradas.add(Number(f.order_id));
  }
  const nuevas = ordenes.filter((o) => !yaRegistradas.has(o.id));
  if (!nuevas.length) return 0;
  // Sin la columna `neto` en el lote: el upsert solo escribe las columnas
  // que van en el cuerpo, así que una orden ya conocida conserva su neto.
  await upsertEnTandas(
    admin,
    "yz_ordenes_neto",
    nuevas.map((o) => ({
      account_id: accountId,
      order_id: o.id,
      payment_id: o.pagos[0] ?? null,
      payment_ids: o.pagos,
      fecha: o.fecha,
      total: o.total,
      // Con unidades y comisión: el corte del mes se arma desde las órdenes.
      renglones: o.renglones.map((r) => ({ sku: r.sku, unidades: r.unidades, importe: redondea(r.importe), comision: redondea(r.comision) })),
    })),
    "account_id,order_id",
  );
  return nuevas.length;
}

/** El neto de una orden: la suma de sus pagos aprobados. null = MP no contestó. */
export async function leerNetoDeOrden(cliente: MeliClient, pagos: number[]): Promise<number | null> {
  let neto = 0;
  let algo = false;
  for (const pagoId of pagos) {
    const r = await cliente.get<{ net_received_amount?: number; status?: string }>(`/collections/${pagoId}`);
    if (r?.status === "rejected" || r?.status === "cancelled") continue;
    if (typeof r?.net_received_amount === "number") {
      neto += r.net_received_amount;
      algo = true;
    }
  }
  return algo ? redondea(neto) : null;
}

/**
 * Reparte el neto de las órdenes de un día entre sus SKUs. Devuelve null si
 * el día no está completo (alguna orden cobrada sin neto o sin renglones).
 * Pura, para probarla.
 */
export function repartirNetoDelDia(
  ordenes: { total: number; neto: number; renglones: { sku: string; importe: number }[] | null }[],
): Map<string, number> | null {
  const porSku = new Map<string, number>();
  for (const o of ordenes) {
    if (o.total > 0 && !(o.neto > 0)) return null;
    if (!o.renglones) return null;
    const importeOrden = o.renglones.reduce((a, r) => a + (Number(r.importe) || 0), 0);
    if (importeOrden <= 0) continue;
    for (const r of o.renglones) {
      porSku.set(r.sku, (porSku.get(r.sku) ?? 0) + o.neto * ((Number(r.importe) || 0) / importeOrden));
    }
  }
  for (const [k, v] of porSku) porSku.set(k, redondea(v));
  return porSku;
}

/** Asienta en yz_ventas_diarias el neto de los días que ya quedaron completos (hasta `finMs`). */
export async function asentarNetos(admin: DB, accountId: string, dias: Iterable<string>, finMs = Infinity): Promise<string[]> {
  const asentados: string[] = [];
  for (const fecha of [...new Set(dias)].sort()) {
    if (Date.now() > finMs) break;
    const ordenes = await todo<{ total: number; neto: number; renglones: { sku: string; importe: number }[] | null }>(
      admin,
      "yz_ordenes_neto",
      "total, neto, renglones",
      (q) => q.eq("account_id", accountId).eq("fecha", fecha),
    );
    if (!ordenes.length) continue;
    const reparto = repartirNetoDelDia(ordenes.map((o) => ({ total: Number(o.total), neto: Number(o.neto), renglones: o.renglones })));
    if (!reparto) continue;
    // Solo los renglones que EXISTEN ese día: un upsert a ciegas inventaría
    // renglones con cero unidades.
    const existentes = await todo<{ sku: string }>(admin, "yz_ventas_diarias", "sku", (q) => q.eq("account_id", accountId).eq("fecha", fecha));
    const filas = existentes
      .filter((e) => reparto.has(e.sku))
      .map((e) => ({ account_id: accountId, sku: e.sku, fecha, neto: reparto.get(e.sku)! }));
    if (filas.length) await upsertEnTandas(admin, "yz_ventas_diarias", filas, "account_id,sku,fecha");
    asentados.push(fecha);
  }
  return asentados;
}

export interface ResumenNetos {
  leidos: number;
  fallidos: number;
  diasAsentados: string[];
  /** órdenes que siguen sin neto en los últimos 180 días */
  pendientes: number;
}

/**
 * Pide a Mercado Pago los netos que faltan, de lo más reciente hacia atrás,
 * hasta `finMs`, y asienta los días que quedaron completos.
 */
export async function completarNetosPendientes(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  finMs: number,
  tope = 2_000,
): Promise<ResumenNetos> {
  const fondo = restarDias(hoyMx(), 180);
  const { data, count } = await admin
    .from("yz_ordenes_neto")
    .select("order_id, fecha, payment_ids, payment_id", { count: "exact" })
    .eq("account_id", accountId)
    .lte("neto", 0)
    .gt("total", 0)
    .gte("fecha", fondo)
    .order("fecha", { ascending: false })
    .limit(tope);
  const pendientes = data ?? [];
  const r: ResumenNetos = { leidos: 0, fallidos: 0, diasAsentados: [], pendientes: count ?? pendientes.length };
  const dias = new Set<string>();
  const nuevas: Record<string, unknown>[] = [];
  const vaciar = async () => {
    if (!nuevas.length) return;
    await upsertEnTandas(admin, "yz_ordenes_neto", nuevas.splice(0), "account_id,order_id");
  };

  // Se deja un margen al final para guardar y asentar sin que Vercel mate la función.
  const finLectura = finMs - 25_000;
  for (const o of pendientes) {
    if (Date.now() > finLectura) break;
    const pagos: number[] = Array.isArray(o.payment_ids) && o.payment_ids.length ? o.payment_ids.map(Number) : o.payment_id != null ? [Number(o.payment_id)] : [];
    if (!pagos.length) continue;
    try {
      const neto = await leerNetoDeOrden(cliente, pagos);
      if (neto == null) {
        r.fallidos++;
        continue;
      }
      nuevas.push({ account_id: accountId, order_id: o.order_id, neto, neto_en: new Date().toISOString(), actualizado_en: new Date().toISOString() });
      dias.add(o.fecha);
      r.leidos++;
      r.pendientes--;
      if (nuevas.length >= 100) await vaciar();
    } catch {
      r.fallidos++;
    }
  }
  await vaciar();
  if (dias.size) r.diasAsentados = await asentarNetos(admin, accountId, dias, finMs);
  return r;
}

/** item+variación → SKU del catálogo de fundas. */
export async function mapaSkus(admin: DB, accountId: string): Promise<Map<string, string>> {
  const skus = await todo<{ sku: string; item_id: string | null; variation_id: string | null }>(admin, "yz_skus", "sku, item_id, variation_id", (q) =>
    q.eq("account_id", accountId).not("item_id", "is", null),
  );
  const mapa = new Map<string, string>();
  for (const s of skus) {
    if (!s.item_id) continue;
    mapa.set(claveItem(s.item_id, s.variation_id), s.sku);
    if (!mapa.has(s.item_id)) mapa.set(s.item_id, s.sku);
  }
  return mapa;
}

/**
 * Registra hacia atrás, día por día, las órdenes de antes de este mecanismo
 * (hasta el inicio del historial de ventas o 180 días), para que el fondo
 * les complete el neto. Deja apuntado hasta qué día llegó.
 */
export async function registrarHistoria(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  meliUserId: number,
  finMs: number,
): Promise<{ dias: string[]; ordenes: number; completo: boolean }> {
  const { data: estado } = await admin
    .from("yz_sync_estado")
    .select("ventas_desde, ordenes_registradas_desde")
    .eq("account_id", accountId)
    .maybeSingle();
  const hoy = hoyMx();
  const fondo = estado?.ventas_desde && estado.ventas_desde > restarDias(hoy, 180) ? estado.ventas_desde : restarDias(hoy, 180);
  let dia = estado?.ordenes_registradas_desde ? restarDias(estado.ordenes_registradas_desde, 1) : restarDias(hoy, 1);
  const r = { dias: [] as string[], ordenes: 0, completo: dia < fondo };
  if (r.completo) return r;

  const mapa = await mapaSkus(admin, accountId);
  while (dia >= fondo && Date.now() < finMs) {
    const { ordenes } = await leerOrdenes(cliente, meliUserId, dia, dia, mapa);
    await registrarOrdenes(admin, accountId, ordenes);
    await admin
      .from("yz_sync_estado")
      .upsert({ account_id: accountId, ordenes_registradas_desde: dia, actualizado_en: new Date().toISOString() }, { onConflict: "account_id" });
    r.dias.push(dia);
    r.ordenes += ordenes.length;
    dia = restarDias(dia, 1);
  }
  r.completo = dia < fondo;
  return r;
}

/**
 * Una corrida del trabajo de fondo: historia hacia atrás (un cuarto del
 * tiempo) y netos pendientes (el resto). Cada etapa mira el reloj y SIEMPRE
 * se deja bitácora, aunque una etapa truene: una función que Vercel mata
 * por tiempo no deja rastro y así se perdieron corridas enteras.
 */
export async function correrNetos(admin: DB, accountId: string, presupuestoMs: number): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const detalle: Record<string, unknown> = { tarea: "netos" };
  let ok = true;
  try {
    const cliente = await clienteDeCuenta(admin, accountId);
    const usuario = await obtenerUsuario(cliente);
    try {
      detalle.historia = await registrarHistoria(admin, accountId, cliente, usuario.id, t0 + presupuestoMs * 0.25);
    } catch (err) {
      ok = false;
      detalle.historiaError = (err as Error).message.slice(0, 300);
    }
    try {
      detalle.netos = await completarNetosPendientes(admin, accountId, cliente, t0 + presupuestoMs - 5_000);
    } catch (err) {
      ok = false;
      detalle.netosError = (err as Error).message.slice(0, 300);
    }
  } catch (err) {
    ok = false;
    detalle.error = (err as Error).message.slice(0, 300);
  }
  detalle.ms = Date.now() - t0;
  await admin.from("yz_sync_log").insert({ account_id: accountId, ok, detalle });
  return detalle;
}
