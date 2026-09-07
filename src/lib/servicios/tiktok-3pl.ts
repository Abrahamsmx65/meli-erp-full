/**
 * Las salidas del almacén TikTok, hacia el 3PL (Industher).
 *
 * El dueño quiere que Industher también baje su número después de cada
 * corte. Industher es un sistema ajeno (de su hermano), así que el ERP le
 * MANDA las salidas a un endpoint que ellos exponen, con una referencia
 * única por corte para que un reintento no duplique. Lo que Industher
 * confirma queda marcado; lo que no, se reintenta en el cron y, mientras,
 * una baja de su número se atribuye a esas salidas antes que a una merma.
 *
 * El contrato del endpoint (propuesto al 3PL; se ajusta si lo cambian):
 *   POST {INDUSTHER_SALIDAS_URL}
 *   x-api-key: la misma llave del inventario
 *   { referencia, fecha, almacen: "TikTok",
 *     salidas: [{ sku, modelo, color, talla, pares, pedido }] }
 *   -> 200 { ok: true, aplicadas: n }   (idempotente por referencia)
 */
import { traerTodo, type DB } from "../datos/repos";
import { esAlmacenTikTok } from "../importar/cajas";
import { claveComparacion } from "../importar/sku";
import { partirSku } from "../tiktok/despacho";
import { configuracionIndusther } from "./industher";

/**
 * clave canónica → SKU tal cual lo escribe Industher en su bodega TikTok.
 * El ERP guarda "GT134-NAVY-RED-25-MX" (forma de MELI) e Industher
 * "GT134-NAVY / RED-25-MX": si la salida va con el nombre del ERP, el 3PL
 * contesta ok y no descuenta nada (pasó el 7 de septiembre). Se le habla
 * con SU nombre.
 */
export function aliasParaIndusther(filas: { sku_caja: string | null; almacen: string | null }[]): Map<string, string> {
  const alias = new Map<string, string>();
  for (const f of filas) {
    if (!esAlmacenTikTok(f.almacen) || !f.sku_caja) continue;
    const clave = claveComparacion(f.sku_caja);
    if (!alias.has(clave)) alias.set(clave, String(f.sku_caja).trim());
  }
  return alias;
}

/** A dónde se mandan las salidas. Sin variable, junto al endpoint de inventario. */
export function urlSalidasIndusther(): string | null {
  const config = configuracionIndusther();
  if (!config) return null;
  const propia = (process.env.INDUSTHER_SALIDAS_URL ?? "").trim();
  if (propia) return propia;
  return config.url.replace(/\/[^/]*$/, "") + "/salidas";
}

export interface SalidaPendiente {
  id: number;
  corteId: number | null;
  orderId: string;
  sku: string;
  pares: number;
}

/** Deja registradas las salidas de un corte, para mandarlas y para conciliar. */
export async function registrarSalidasDeCorte(
  db: DB,
  accountId: string,
  corteId: number,
  renglones: { orderId: string; sku: string; pares: number }[],
): Promise<number> {
  const filas = renglones
    .filter((r) => r.sku && r.pares > 0)
    .map((r) => ({ account_id: accountId, corte_id: corteId, order_id: r.orderId, sku: r.sku, pares: r.pares }));
  if (!filas.length) return 0;
  const { error } = await db
    .from("tiktok_salidas_3pl")
    .upsert(filas, { onConflict: "account_id,order_id,sku", ignoreDuplicates: true });
  if (error) throw new Error(`tiktok_salidas_3pl: ${error.message}`);
  return filas.length;
}

export interface ResultadoEmpuje {
  mandadas: number;
  confirmadas: number;
  error: string | null;
  /** el endpoint aún no existe o no está configurado */
  sinEndpoint: boolean;
}

/**
 * Manda al 3PL todas las salidas que todavía no confirma. Una referencia
 * por lote (corte o "reintento") para que del otro lado sea idempotente.
 */
export async function empujarSalidasAl3pl(db: DB, accountId: string, corteId?: number): Promise<ResultadoEmpuje> {
  const url = urlSalidasIndusther();
  const config = configuracionIndusther();
  if (!url || !config) return { mandadas: 0, confirmadas: 0, error: null, sinEndpoint: true };

  let q = db
    .from("tiktok_salidas_3pl")
    .select("id, corte_id, order_id, sku, pares")
    .eq("account_id", accountId)
    .is("confirmada_en", null)
    .order("id", { ascending: true })
    .limit(500);
  if (corteId != null) q = q.eq("corte_id", corteId);
  const { data } = await q;
  const pendientes = (data ?? []) as any[];
  if (!pendientes.length) return { mandadas: 0, confirmadas: 0, error: null, sinEndpoint: false };

  const existencias = await traerTodo<{ sku_caja: string | null; almacen: string | null }>(
    db,
    "existencias",
    "sku_caja, almacen",
    (q) => q.eq("account_id", accountId),
  ).catch(() => [] as { sku_caja: string | null; almacen: string | null }[]);
  const alias = aliasParaIndusther(existencias ?? []);

  const referencia = corteId != null ? `TT-CORTE-${corteId}` : `TT-REINTENTO-${new Date().toISOString().slice(0, 16)}`;
  const cuerpo = {
    referencia,
    fecha: new Date().toISOString(),
    almacen: "TikTok",
    salidas: pendientes.map((s) => {
      const skuIndusther = alias.get(claveComparacion(s.sku)) ?? s.sku;
      const { modelo, color, talla } = partirSku(skuIndusther);
      return { sku: skuIndusther, modelo, color, talla, pares: s.pares, pedido: s.order_id };
    }),
  };

  const ahora = new Date().toISOString();
  let error: string | null = null;
  let ok = false;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(20_000),
    });
    const texto = await r.text();
    if (!r.ok) {
      // 404 = el endpoint todavía no existe del otro lado: no es un error del
      // corte, es que falta que lo publiquen. Se dice así.
      error = r.status === 404 ? "Industher todavía no tiene el endpoint de salidas." : `Industher ${r.status}: ${texto.slice(0, 200)}`;
    } else {
      let json: any = null;
      try { json = JSON.parse(texto); } catch { /* respuesta sin JSON: se toma el 200 como ok */ }
      ok = json?.ok !== false;
      if (!ok) error = `Industher rechazó las salidas: ${texto.slice(0, 200)}`;
    }
  } catch (err) {
    error = `Industher no contestó: ${(err as Error).message}`;
  }

  const ids = pendientes.map((s) => s.id);
  await db
    .from("tiktok_salidas_3pl")
    .update(ok ? { enviada_en: ahora, confirmada_en: ahora, error: null } : { enviada_en: ahora, error })
    .in("id", ids);

  return { mandadas: pendientes.length, confirmadas: ok ? pendientes.length : 0, error, sinEndpoint: error?.includes("todavía no tiene") ?? false };
}

/** Lo que el 3PL ya descontó y lo que le falta, por SKU, para conciliar la foto. */
export async function estadoSalidas3pl(db: DB, accountId: string) {
  const filas = await traerTodo<any>(db, "tiktok_salidas_3pl", "sku, pares, confirmada_en, id", (q) =>
    q.eq("account_id", accountId),
  );
  const confirmadas = new Map<string, number>();
  const pendientes = new Map<string, number>();
  for (const f of filas ?? []) {
    const destino = f.confirmada_en ? confirmadas : pendientes;
    destino.set(f.sku, (destino.get(f.sku) ?? 0) + (f.pares ?? 0));
  }
  return { confirmadas, pendientes };
}

/**
 * Marca como confirmadas, por SKU y de la más vieja a la más nueva, las
 * salidas a las que se atribuyó una baja del número de Industher.
 */
export async function confirmarSalidasAtribuidas(
  db: DB,
  accountId: string,
  atribuidas: Map<string, number>,
): Promise<void> {
  for (const [sku, pares] of atribuidas) {
    const { data } = await db
      .from("tiktok_salidas_3pl")
      .select("id, pares")
      .eq("account_id", accountId)
      .eq("sku", sku)
      .is("confirmada_en", null)
      .order("id", { ascending: true });
    let faltan = pares;
    const ids: number[] = [];
    for (const f of (data ?? []) as any[]) {
      if (faltan <= 0) break;
      ids.push(f.id);
      faltan -= f.pares;
    }
    if (ids.length) {
      await db
        .from("tiktok_salidas_3pl")
        .update({ confirmada_en: new Date().toISOString(), error: null })
        .in("id", ids);
    }
  }
}
