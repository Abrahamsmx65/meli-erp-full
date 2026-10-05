/**
 * TikTok Shop para el pedido a China.
 *
 * TikTok es el tercer canal que se come el inventario del calzado (el
 * GT148 vende ahí más de 400 pares al mes por talla), así que pedir solo
 * con MELI y Amazon dejaba corto todo lo que también se vende en TikTok.
 *
 * Regla del dueño (5-oct-2026): la venta de TikTok entra TAL CUAL se
 * vendió —unidades de los últimos 30 días ÷ 30— sin corrección por
 * agotamiento ni por tendencia: «no es predecible». Lo único que se
 * descuenta es lo que ya está en su bodega (kardex: saldo menos apartado),
 * porque esos pares ya están comprados.
 *
 * Mismo contrato que `amazonParaCompras`: un mapa por SKU del ERP, avisos
 * si alguna fuente falló y `disponible` para que la pantalla no sirva un
 * pedido calculado a medias como si fuera completo.
 */
import { traerTodo, type DB } from "../datos/repos";
import { fechaMx } from "./ventas-monitor";

export const VENTANA_VENTA_TIKTOK = 30;

export interface TikTokCompraSku {
  /** unidades vendidas en la ventana ÷ días de la ventana, sin corrección */
  ventaDiaria: number;
  /** pares en la bodega de TikTok que nadie ha comprado (saldo − apartado) */
  stock: number;
}

export interface TikTokParaComprasResultado {
  datos: Map<string, TikTokCompraSku>;
  advertencias: string[];
  disponible: boolean;
}

/** Venta diaria observada: lo vendido ÷ la ventana, y nada más. */
export function ventaDiariaTikTok(unidades: number, ventana = VENTANA_VENTA_TIKTOK): number {
  if (unidades <= 0 || ventana <= 0) return 0;
  return unidades / ventana;
}

/**
 * Junta por SKU la venta de la ventana y el stock del kardex. Un SKU con
 * stock y sin venta también entra: ocupa inventario que no hay que volver
 * a pedir.
 */
export function armarTikTokParaCompras(
  ventas: { sku: string; unidades: number }[],
  kardex: { sku: string; saldo: number; apartado: number }[],
  ventana = VENTANA_VENTA_TIKTOK,
): Map<string, TikTokCompraSku> {
  const unidades = new Map<string, number>();
  for (const v of ventas) {
    const sku = String(v.sku ?? "").trim();
    if (!sku) continue;
    unidades.set(sku, (unidades.get(sku) ?? 0) + Math.max(0, Number(v.unidades) || 0));
  }
  const stock = new Map<string, number>();
  for (const k of kardex) {
    const sku = String(k.sku ?? "").trim();
    if (!sku) continue;
    const libre = Math.max(0, (Number(k.saldo) || 0) - (Number(k.apartado) || 0));
    stock.set(sku, (stock.get(sku) ?? 0) + libre);
  }
  const salida = new Map<string, TikTokCompraSku>();
  for (const sku of new Set([...unidades.keys(), ...stock.keys()])) {
    const ventaDiaria = ventaDiariaTikTok(unidades.get(sku) ?? 0, ventana);
    const s = stock.get(sku) ?? 0;
    if (ventaDiaria <= 0 && s <= 0) continue;
    salida.set(sku, { ventaDiaria, stock: s });
  }
  return salida;
}

const cache = new Map<string, { en: number; resultado: TikTokParaComprasResultado }>();
const VIDA_CACHE_MS = 60_000;

/** Solo para pruebas: olvida el minuto de caché. */
export function limpiarCacheTikTokCompras(): void {
  cache.clear();
}

export async function tiktokParaCompras(db: DB, accountId: string): Promise<TikTokParaComprasResultado> {
  const guardado = cache.get(accountId);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_MS) return guardado.resultado;

  // Días de México, como el resto de TikTok; la ventana termina hoy.
  const desde = fechaMx(VENTANA_VENTA_TIKTOK - 1);
  const advertencias: string[] = [];
  try {
    const [ventas, kardex] = await Promise.all([
      traerTodo<{ sku: string; unidades: number; fecha: string }>(
        db,
        "tiktok_ventas_diarias",
        "sku, unidades, fecha",
        (q) => q.eq("account_id", accountId).gte("fecha", desde),
      ),
      traerTodo<{ sku: string; saldo: number; apartado: number }>(
        db,
        "tiktok_inventario",
        "sku, saldo, apartado",
        (q) => q.eq("account_id", accountId),
      ),
    ]);
    const resultado: TikTokParaComprasResultado = {
      datos: armarTikTokParaCompras(ventas ?? [], kardex ?? []),
      advertencias,
      disponible: true,
    };
    cache.set(accountId, { en: Date.now(), resultado });
    return resultado;
  } catch (err) {
    // Sin TikTok el pedido saldría corto: se declara y la pantalla no lo
    // guarda como bueno (mismo trato que Amazon).
    return {
      datos: new Map(),
      advertencias: [`No se pudieron leer ventas e inventario de TikTok: ${(err as Error).message}`],
      disponible: false,
    };
  }
}
