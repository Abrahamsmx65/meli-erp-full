/**
 * Pedidos de AFILIADOS de TikTok Shop: quién (qué creador) trajo cada venta.
 *
 * TikTok no pone al creador en el pedido: vive en el endpoint de afiliados
 * (`POST /affiliate_seller/202410/orders/search`, ventana por
 * `create_time`), que contesta por pedido sus SKUs con `creator_username`,
 * la tasa y la comisión. Aquí se interpreta esa respuesta (motor puro, sin
 * red ni base): un pedido tiene UN creador —el que más pares trajo— y el
 * detalle por SKU se guarda tal cual para auditar.
 */

export interface SkuDeAfiliado {
  creador: string | null;
  productId: string | null;
  cantidad: number;
  /** tasa de comisión como la escribe TikTok ("10" = 10 %) */
  tasa: string | null;
  comisionEstimada: number | null;
  comisionPagada: number | null;
  tipoContenido: string | null;
}

export interface PedidoDeAfiliado {
  orderId: string;
  creadoEn: string | null;
  estado: string | null;
  skus: SkuDeAfiliado[];
}

function numero(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === "object" ? Number((x as { amount?: unknown }).amount) : Number(x);
  return Number.isFinite(n) ? n : null;
}

/** La respuesta cruda del endpoint → pedidos con sus SKUs. Lo que no tiene forma se ignora. */
export function interpretarPedidosAfiliados(crudo: unknown): PedidoDeAfiliado[] {
  const lista = Array.isArray((crudo as { orders?: unknown })?.orders) ? ((crudo as { orders: unknown[] }).orders as any[]) : [];
  const pedidos: PedidoDeAfiliado[] = [];
  for (const o of lista) {
    const orderId = String(o?.id ?? "").trim();
    if (!orderId) continue;
    const creadoEn = o?.create_time != null && Number.isFinite(Number(o.create_time)) ? new Date(Number(o.create_time) * 1000).toISOString() : null;
    const skus: SkuDeAfiliado[] = (Array.isArray(o?.skus) ? o.skus : []).map((s: any) => ({
      creador: s?.creator_username ? String(s.creator_username) : null,
      productId: s?.product_id ? String(s.product_id) : null,
      cantidad: Number(s?.quantity ?? 0) || 0,
      tasa: s?.commission_rate != null ? String(s.commission_rate) : null,
      comisionEstimada: numero(s?.estimated_paid_commission),
      comisionPagada: numero(s?.actual_paid_commission),
      tipoContenido: s?.content_type ? String(s.content_type) : null,
    }));
    pedidos.push({ orderId, creadoEn, estado: o?.status ? String(o.status) : null, skus });
  }
  return pedidos;
}

export interface FilaAfiliado {
  orderId: string;
  /** el creador del pedido (el que más pares trajo); null si TikTok no lo nombra */
  creador: string | null;
  detalle: SkuDeAfiliado[];
}

/** Un pedido → su renglón para guardar: el creador con más pares manda; a pares iguales, el primero. */
export function resumirAfiliado(p: PedidoDeAfiliado): FilaAfiliado {
  const pares = new Map<string, number>();
  for (const s of p.skus) {
    if (!s.creador) continue;
    pares.set(s.creador, (pares.get(s.creador) ?? 0) + Math.max(0, s.cantidad));
  }
  let creador: string | null = null;
  let max = -1;
  for (const [c, n] of pares) {
    if (n > max) {
      max = n;
      creador = c;
    }
  }
  return { orderId: p.orderId, creador, detalle: p.skus };
}
