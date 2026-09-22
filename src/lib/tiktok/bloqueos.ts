/**
 * Mecanismo de defensa del corte: renglones que NO se confirman.
 *
 * Cuando falta stock de un SKU —o pasa una falla como la del 14-sep-2026,
 * un par ofrecido sin existir— hay que cancelar en TikTok SOLO ese SKU del
 * pedido y confirmar lo demás: en un pedido grande no se pierde todo por
 * un par. Y el corte nunca debe confirmarlo por error.
 *
 * Es AUTOMÁTICO (decisión del dueño, 16-sep-2026: «no quiero algo manual»):
 * al hacer el corte se compara lo que piden los pedidos pendientes de cada
 * SKU contra lo que FÍSICAMENTE hay —el menor entre el kardex y el estante
 * del 3PL, la misma regla con la que se publica— y lo que no alcanza se
 * bloquea solo, de los pedidos más NUEVOS hacia atrás: el que compró
 * primero se lleva el par. Sin dato de stock no se bloquea nada: cancelar
 * a ciegas también es un error.
 *
 * Aquí está la parte pura: qué renglones se bloquean solos y, dado un
 * pedido con sus renglones bloqueados, qué se le pide a TikTok que cancele,
 * qué queda por confirmar y si el pedido se cancela completo. El servicio
 * hace las llamadas y, si TikTok no acepta la cancelación, deja el pedido
 * ENTERO fuera del corte: confirmar un par que no existe es el error caro.
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

export interface RenglonConPedido extends RenglonBloqueable {
  orderId: string;
  /** ISO de cuándo se vendió; sin fecha se trata como el más nuevo */
  creadoEn: string | null;
}

export interface StockFisico {
  sku: string;
  /** kardex: pares físicos (incluye lo apartado) */
  saldo: number;
  /** estante del 3PL; null = sin lectura */
  estante: number | null;
  /** salidas ya descontadas del kardex que el 3PL todavía no confirma */
  salidasPendientes: number;
  /** contado a mano después de la foto del estante: manda el kardex */
  contadoDespues: boolean;
}

/** Lo que de verdad hay: el menor entre el kardex y el estante (ajustado por lo que el 3PL aún no descontó). */
export function paresFisicos(s: StockFisico): number {
  if (s.estante == null || s.contadoDespues) return Math.max(0, s.saldo);
  return Math.max(0, Math.min(s.saldo, s.estante - s.salidasPendientes));
}

/** Con qué empieza el motivo de un bloqueo AUTOMÁTICO: se vuelve a evaluar en cada corte. */
export const PREFIJO_AUTO = "auto:";

/**
 * Un bloqueo automático NO es para siempre: se decidió con el stock de ese
 * momento. Si después llega mercancía (el 18-sep-2026 Industher metió 35
 * pares de GT148-BLK-24 a las 12:15 y los pedidos seguían bloqueados de la
 * mañana), el siguiente corte lo vuelve a calcular y lo libera.
 */
export function esBloqueoAutomatico(motivo: string | null | undefined): boolean {
  return String(motivo ?? "").startsWith(PREFIJO_AUTO);
}

export interface AutoBloqueo {
  lineItemId: string;
  orderId: string;
  sku: string;
  motivo: string;
  /** stock EN DUDA: no se cancela, el pedido se queda fuera del corte hasta un conteo */
  enDuda?: boolean;
}

/**
 * Stock EN DUDA: el kardex conserva pares pero la bodega dejó de reportar
 * el SKU POR COMPLETO. Es la baja detenida de `conciliarAcumulado`
 * (20-sep-2026: Industher dejó de traer el MY2304-BROWN-29 con 21 pares
 * y 18 vendidos). Ninguna de las dos fuentes es de fiar sola: si los
 * pares existen, cancelar los pedidos los pierde; si no existen,
 * confirmarlos manda lo que no hay. Por eso esos pedidos NO se cancelan
 * ni se confirman: se quedan fuera del corte, declarados, hasta que un
 * conteo o la propia bodega digan la verdad (decisión del dueño,
 * 22-sep-2026: el corte #36 canceló 7 pedidos de ese SKU que el dueño
 * había apartado por precaución). Un contado a mano después de la foto
 * manda el kardex, como siempre; una baja PARCIAL sigue siendo merma y
 * se bloquea como antes.
 */
export function stockEnDuda(s: StockFisico): boolean {
  return !s.contadoDespues && s.estante === 0 && s.saldo > 0;
}

/**
 * Qué renglones se bloquean solos por falta de stock. Por SKU: lo que
 * piden los pedidos pendientes contra lo físico; los pedidos más nuevos
 * pierden primero. Un SKU sin renglón de stock NO se toca.
 */
export function autoBloqueos(renglones: RenglonConPedido[], stock: Map<string, StockFisico>): AutoBloqueo[] {
  const porSku = new Map<string, RenglonConPedido[]>();
  for (const r of renglones) {
    if (r.bloqueado || efectoDeEstado(r.estado) !== "apartado") continue;
    const l = porSku.get(r.sku) ?? [];
    l.push(r);
    porSku.set(r.sku, l);
  }

  const salida: AutoBloqueo[] = [];
  for (const [sku, lista] of porSku) {
    const s = stock.get(sku);
    if (!s) continue;
    if (stockEnDuda(s)) {
      // Ni se cancela ni se confirma: se declara y se queda fuera.
      for (const r of lista) {
        salida.push({
          lineItemId: r.lineItemId,
          orderId: r.orderId,
          sku,
          motivo: `${PREFIJO_AUTO} stock en duda (el kardex tiene ${s.saldo} y la bodega dejó de reportarlo)`,
          enDuda: true,
        });
      }
      continue;
    }
    const hay = paresFisicos(s);
    const piden = lista.reduce((a, r) => a + r.cantidad, 0);
    if (piden <= hay) continue;
    // Del más viejo al más nuevo: los primeros se llevan el par.
    const ordenados = [...lista].sort((a, b) => {
      const ta = a.creadoEn ? Date.parse(a.creadoEn) : Number.POSITIVE_INFINITY;
      const tb = b.creadoEn ? Date.parse(b.creadoEn) : Number.POSITIVE_INFINITY;
      return ta - tb || a.orderId.localeCompare(b.orderId) || a.lineItemId.localeCompare(b.lineItemId);
    });
    let acumulado = 0;
    for (const r of ordenados) {
      acumulado += r.cantidad;
      if (acumulado > hay) {
        salida.push({ lineItemId: r.lineItemId, orderId: r.orderId, sku, motivo: `${PREFIJO_AUTO} sin stock (hay ${hay}, piden ${piden})` });
      }
    }
  }
  return salida;
}
