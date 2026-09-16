/**
 * Mecanismo de defensa del corte: renglones que NO se confirman.
 *
 * Cuando falta stock de un SKU —o pasa una falla como la del 14-sep-2026,
 * un par ofrecido sin existir— el dueño quiere cancelar en TikTok SOLO ese
 * SKU del pedido y confirmar lo demás: en un pedido grande no se pierde
 * todo por un par. Y que el corte nunca lo confirme por error.
 *
 * Aquí está la parte pura: dado un pedido con sus renglones (algunos
 * bloqueados), qué se le pide a TikTok que cancele, qué queda por
 * confirmar, y si el pedido se cancela completo. El servicio hace las
 * llamadas y, si TikTok no acepta la cancelación, deja el pedido ENTERO
 * fuera del corte: confirmar un par que no existe es el error caro.
 */
import { efectoDeEstado } from "./kardex";

export interface RenglonBloqueable {
  lineItemId: string;
  skuId: string | null;
  sku: string;
  cantidad: number;
  estado: string | null;
  bloqueado: boolean;
}

export interface DecisionDePedido {
  /** lo que se le pide a TikTok que cancele, agrupado por SKU de TikTok */
  cancelar: { skuId: string; sku: string; cantidad: number; lineItemIds: string[] }[];
  /** lo que sigue vivo y se confirma */
  quedan: RenglonBloqueable[];
  /** true si TODO lo vivo está bloqueado: se cancela el pedido completo, no se confirma nada */
  todoBloqueado: boolean;
  /** renglones bloqueados sin sku_id: TikTok no los puede cancelar por SKU; el pedido se queda fuera */
  sinSkuId: RenglonBloqueable[];
}

/**
 * Decide qué hacer con un pedido antes de confirmarlo. Los renglones ya
 * cancelados (reversa) no cuentan para nada: ni se cancelan ni se confirman.
 */
export function decidirPedido(renglones: RenglonBloqueable[]): DecisionDePedido {
  const vivos = renglones.filter((r) => efectoDeEstado(r.estado) !== "reversa");
  const bloqueados = vivos.filter((r) => r.bloqueado);
  const quedan = vivos.filter((r) => !r.bloqueado);
  const sinSkuId = bloqueados.filter((r) => !r.skuId);

  const porSku = new Map<string, { skuId: string; sku: string; cantidad: number; lineItemIds: string[] }>();
  for (const r of bloqueados) {
    if (!r.skuId) continue;
    const acc = porSku.get(r.skuId) ?? { skuId: r.skuId, sku: r.sku, cantidad: 0, lineItemIds: [] };
    acc.cantidad += r.cantidad;
    acc.lineItemIds.push(r.lineItemId);
    porSku.set(r.skuId, acc);
  }

  return {
    cancelar: [...porSku.values()],
    quedan,
    todoBloqueado: vivos.length > 0 && quedan.length === 0,
    sinSkuId,
  };
}

/** Los renglones de un pedido que hay que bloquear cuando se bloquea un SKU. */
export function renglonesDelSku<T extends RenglonBloqueable>(renglones: T[], sku: string): T[] {
  const buscado = String(sku ?? "").trim().toUpperCase();
  return renglones.filter(
    (r) => !r.bloqueado && efectoDeEstado(r.estado) !== "reversa" && String(r.sku ?? "").toUpperCase() === buscado,
  );
}
