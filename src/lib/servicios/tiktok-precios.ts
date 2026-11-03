/**
 * Precios para TikTok: las dos consultas pesadas de la pantalla, masticadas.
 *
 * `tiktok_ventas_pedidos` (14 días de pedidos para el precio REAL pagado) y
 * `meli_neto_relampago_por_modelo` (el relámpago de MELI por modelo) corrían
 * en CADA visita. Ahora su resultado ya reducido por modelo se guarda en
 * `app_cache` (`tiktok:precios:v1:{dias}`, 10 min) y la pantalla lee el
 * renglón aunque esté viejo; el refresco va por atrás (`servirConCacheApp`).
 * Las cuentas no cambian: lo que se guarda es exactamente lo que la
 * pantalla sumaba en el clic. «Mi precio» y la casilla del 10.5 % NO van
 * aquí: se leen frescos en cada visita.
 */
import type { DB } from "../datos/repos";
import { modeloDeSku } from "../tiktok/ventas";
import { invalidarApp, servirConCacheApp } from "./cache-app";

export const PREFIJO_CACHE_PRECIOS = "tiktok:precios:v1:";
const EDAD_CACHE_PRECIOS_MS = 10 * 60_000;
/** Días de pedidos de TikTok para el precio real pagado (ofertas y relámpagos incluidos). */
export const DIAS_PRECIO_REAL = 14;

export interface RelampagoModelo {
  precio: number | null;
  pares: number;
  neto: number | null;
  paresTotal: number;
  netoTotal: number | null;
}

export interface FuentesPrecios {
  /** por modelo (MAYÚSCULAS): el relámpago de MELI desde `desde` */
  relampago: [string, RelampagoModelo][];
  /** por modelo: suma de precio × pares y pares de los pedidos en pie de los últimos 14 días */
  pagado: [string, { suma: number; pares: number }][];
  /** si `tiktok_ventas_pedidos` falló, el mensaje (el precio pagado sale vacío, como antes) */
  errorPedidos: string | null;
}

/** El precio pagado por modelo desde la respuesta de `tiktok_ventas_pedidos` (puro). */
export function precioPagadoPorModelo(datos: { ordenes?: unknown[]; renglones?: unknown[] } | null | undefined): Map<string, { suma: number; pares: number }> {
  const precioPagado = new Map<string, { suma: number; pares: number }>();
  const fuera = new Set<string>();
  for (const o of (datos?.ordenes ?? []) as any[]) {
    const estado = String(o.estado ?? "").toUpperCase();
    if (estado.startsWith("CANCEL") || estado === "UNPAID" || o.esMuestra) fuera.add(String(o.orderId));
  }
  for (const r of (datos?.renglones ?? []) as any[]) {
    if (fuera.has(String(r.orderId)) || String(r.estado ?? "").toUpperCase().startsWith("CANCEL")) continue;
    const modelo = modeloDeSku(r.skuInterno ?? r.sellerSku ?? "");
    const precio = Number(r.precio);
    const pares = Number(r.cantidad ?? 0) || 0;
    if (!modelo || !Number.isFinite(precio) || precio <= 0 || pares <= 0) continue;
    const acc = precioPagado.get(modelo) ?? { suma: 0, pares: 0 };
    acc.suma += precio * pares;
    acc.pares += pares;
    precioPagado.set(modelo, acc);
  }
  return precioPagado;
}

async function calcularFuentes(admin: DB, accountId: string, desdeRelampago: string): Promise<FuentesPrecios> {
  const desdePedidos = new Date(Date.now() - DIAS_PRECIO_REAL * 86_400_000).toISOString();
  const [pedidosRpc, relampagoRpc] = await Promise.all([
    admin.rpc("tiktok_ventas_pedidos", {
      p_account: accountId,
      p_desde: desdePedidos,
      p_hasta: new Date(Date.now() + 86_400_000).toISOString(),
    }),
    // El RELÁMPAGO de MELI por modelo: el escalón de precio más bajo con
    // volumen y su neto por par (dueño, 1-oct-2026: «el neto de cuando se
    // vende el relámpago»; el GT148 relámpago $128.99 deja $128.99).
    admin.rpc("meli_neto_relampago_por_modelo", { p_account: accountId, p_desde: desdeRelampago }),
  ]);
  if (relampagoRpc.error) throw new Error(`meli_neto_relampago_por_modelo: ${relampagoRpc.error.message}`);
  const relampago: [string, RelampagoModelo][] = [];
  for (const f of (relampagoRpc.data ?? []) as any[]) {
    relampago.push([
      String(f.modelo).toUpperCase(),
      {
        precio: f.precio_relampago != null ? Number(f.precio_relampago) : null,
        pares: Number(f.pares_relampago ?? 0) || 0,
        neto: f.neto_relampago != null ? Number(f.neto_relampago) : null,
        paresTotal: Number(f.pares_total ?? 0) || 0,
        netoTotal: f.neto_total != null ? Number(f.neto_total) : null,
      },
    ]);
  }
  return {
    relampago,
    pagado: pedidosRpc.error ? [] : [...precioPagadoPorModelo(pedidosRpc.data as any)],
    errorPedidos: pedidosRpc.error ? pedidosRpc.error.message : null,
  };
}

/**
 * Las fuentes pesadas de la pantalla de precios para un periodo de `dias`
 * (el relámpago desde `desdeRelampago`), masticadas por 10 minutos.
 */
export async function fuentesDePrecios(
  admin: DB,
  accountId: string,
  dias: number,
  desdeRelampago: string,
): Promise<FuentesPrecios & { generadoEn: string | null }> {
  const r = await servirConCacheApp<FuentesPrecios>(admin, accountId, `${PREFIJO_CACHE_PRECIOS}${dias}`, EDAD_CACHE_PRECIOS_MS, () =>
    calcularFuentes(admin, accountId, desdeRelampago),
  );
  return { ...r.datos, generadoEn: r.generadoEn };
}

/** Al guardar en Precios para TikTok: la siguiente visita refresca por atrás. */
export async function invalidarFuentesDePrecios(admin: DB, accountId: string, motivo: string): Promise<void> {
  await invalidarApp(admin, accountId, motivo, { prefijo: PREFIJO_CACHE_PRECIOS });
}
