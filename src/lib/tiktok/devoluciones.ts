/**
 * Devoluciones de TikTok Shop: el motor puro.
 *
 * TikTok lleva las devoluciones en su propio API (`/return_refund/.../returns`),
 * aparte de los pedidos: el renglón del pedido NO cambia de estado cuando el
 * cliente devuelve (en un mes de ventas no hubo un solo renglón RETURNED), así
 * que hasta el 9-oct-2026 el ERP no sabía de ninguna devolución. Aquí se
 * decide, sin base ni red, cómo se lee una devolución de TikTok, en qué grupo
 * va, qué se busca con el escáner y qué mueve en el kardex cuando se confirma
 * recibida. Pedido del dueño, 9-oct-2026: «cuando recibo una devolución la
 * pueda buscar fácil, confirmar de recibido para que reembolsen al cliente, y
 * poner si se suma de nuevo al stock o se tira a la basura».
 */

/** Un par devuelto, tal como lo identifica TikTok, ya amarrado al SKU del ERP cuando se pudo. */
export interface RenglonDevolucion {
  /** id del renglón de la devolución en TikTok (`return_line_item_id`) */
  returnLineItemId: string;
  /** id del renglón del pedido (`order_line_item_id`): con él se amarra al SKU del ERP */
  orderLineItemId: string | null;
  skuId: string | null;
  sellerSku: string | null;
  /** SKU del ERP (del renglón del pedido ya amarrado); null = no se pudo amarrar */
  sku: string | null;
  producto: string | null;
  reembolso: number | null;
}

export interface Devolucion {
  returnId: string;
  orderId: string;
  /** `return_status` de TikTok */
  estado: string;
  /** `return_type`: REFUND (solo dinero), RETURN_AND_REFUND, REPLACEMENT */
  tipo: string | null;
  /** qué le toca al vendedor según TikTok (`seller_next_action_response.action`) */
  siguienteAccion: string | null;
  /** hasta cuándo (ISO) */
  plazo: string | null;
  guia: string | null;
  paqueteria: string | null;
  motivo: string | null;
  motivoTexto: string | null;
  reembolso: number | null;
  moneda: string | null;
  renglones: RenglonDevolucion[];
  creadaEn: string | null;
  actualizadaEn: string | null;
}

/** Qué hacer con el par recibido. */
export type DestinoDevolucion = "stock" | "basura";

export interface DecisionDevolucion {
  returnLineItemId: string;
  destino: DestinoDevolucion;
}

/**
 * En qué montón va la devolución en la pantalla:
 * - `por_recibir`: el cliente ya la mandó y TikTok espera que confirmemos el paquete (lo urgente);
 * - `esperando_cliente`: aprobada, el cliente todavía no la manda;
 * - `pendiente_tiktok`: solicitada y aún sin aprobar (TikTok o el Seller Center deciden);
 * - `recibida`: ya se reembolsó (devolución terminada);
 * - `cerrada`: rechazada, cancelada, o un reembolso sin paquete de regreso.
 */
export type GrupoDevolucion = "por_recibir" | "esperando_cliente" | "pendiente_tiktok" | "recibida" | "cerrada";

/** Estados de TikTok (`return_status`). */
export const ESTADO_SOLICITADA = "RETURN_OR_REFUND_REQUEST_PENDING";
export const ESTADO_ESPERANDO_CLIENTE = "AWAITING_BUYER_SHIP";
export const ESTADO_CLIENTE_ENVIO = "BUYER_SHIPPED_ITEM";
export const ESTADO_EXITOSA = "RETURN_OR_REFUND_REQUEST_SUCCESS";
export const ESTADO_COMPLETA = "RETURN_OR_REFUND_REQUEST_COMPLETE";

/** Lo que TikTok pide del vendedor cuando el paquete ya viene de regreso. */
export const ACCION_CONFIRMAR_PAQUETE = "SELLER_RESPOND_RECEIVE_PACKAGE";

/** La decisión que se le manda a TikTok al confirmar el paquete: con ella reembolsa al cliente. */
export const DECISION_PAQUETE_RECIBIDO = "APPROVE_RECEIVED_PACKAGE";

export function grupoDeDevolucion(d: Pick<Devolucion, "estado" | "tipo" | "siguienteAccion">): GrupoDevolucion {
  const estado = String(d.estado ?? "").toUpperCase();
  const tipo = String(d.tipo ?? "").toUpperCase();
  if (estado === ESTADO_CLIENTE_ENVIO || d.siguienteAccion === ACCION_CONFIRMAR_PAQUETE) return "por_recibir";
  if (estado === ESTADO_ESPERANDO_CLIENTE) return "esperando_cliente";
  if (estado === ESTADO_SOLICITADA) return "pendiente_tiktok";
  if (estado === ESTADO_EXITOSA || estado === ESTADO_COMPLETA) {
    // Un reembolso sin paquete (REFUND) no trae nada de regreso: no es una devolución recibida.
    return tipo === "REFUND" ? "cerrada" : "recibida";
  }
  return "cerrada";
}

function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function numero(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDeSegundos(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/**
 * Una devolución tal como la manda TikTok (`return_orders[]` de
 * `/returns/search`, en snake_case), a nuestra forma. `skuPorLinea` amarra
 * cada renglón al SKU del ERP por el id del renglón del pedido.
 */
export function normalizarDevolucion(crudo: any, skuPorLinea: Map<string, string>): Devolucion {
  const renglones: RenglonDevolucion[] = (crudo?.return_line_items ?? []).map((li: any) => {
    const orderLineItemId = texto(li?.order_line_item_id);
    return {
      returnLineItemId: String(li?.return_line_item_id ?? ""),
      orderLineItemId,
      skuId: texto(li?.sku_id),
      sellerSku: texto(li?.seller_sku),
      sku: (orderLineItemId && skuPorLinea.get(orderLineItemId)) || null,
      producto: texto(li?.product_name),
      reembolso: numero(li?.refund_amount?.refund_total ?? li?.refund_amount?.refund_subtotal),
    };
  });
  return {
    returnId: String(crudo?.return_id ?? ""),
    orderId: String(crudo?.order_id ?? ""),
    estado: String(crudo?.return_status ?? "").toUpperCase(),
    tipo: texto(crudo?.return_type)?.toUpperCase() ?? null,
    siguienteAccion: texto(crudo?.seller_next_action_response?.action)?.toUpperCase() ?? null,
    plazo: isoDeSegundos(crudo?.seller_next_action_response?.deadline),
    guia: texto(crudo?.return_tracking_number),
    paqueteria: texto(crudo?.return_provider_name),
    motivo: texto(crudo?.return_reason),
    motivoTexto: texto(crudo?.return_reason_text),
    reembolso: numero(crudo?.refund_amount?.refund_total ?? crudo?.refund_amount?.refund_subtotal),
    moneda: texto(crudo?.refund_amount?.currency),
    renglones,
    creadaEn: isoDeSegundos(crudo?.create_time),
    actualizadaEn: isoDeSegundos(crudo?.update_time),
  };
}

/** Para buscar: solo letras y números, en mayúsculas (la guía escaneada trae guiones y espacios a veces). */
export function claveBusqueda(s: string | null | undefined): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * ¿La devolución es lo que se tecleó o escaneó? Se compara contra la guía
 * de regreso, el número de pedido, el id de la devolución y los SKU, sin
 * guiones ni espacios. Con menos de 4 caracteres no se busca nada: una
 * letra encontraría todo.
 */
export function coincideBusqueda(d: Pick<Devolucion, "guia" | "orderId" | "returnId" | "renglones">, texto: string): boolean {
  const q = claveBusqueda(texto);
  if (q.length < 4) return false;
  const campos = [d.guia, d.orderId, d.returnId, ...d.renglones.map((r) => r.sku), ...d.renglones.map((r) => r.sellerSku)];
  return campos.some((c) => c && claveBusqueda(c).includes(q));
}

export interface MovimientoDevolucion {
  sku: string;
  tipo: "devolucion" | "merma";
  cantidad: number;
  referencia: string;
  motivo: string;
  fecha: string;
}

/**
 * Lo que mueve el kardex al confirmar el paquete recibido: por cada par una
 * DEVOLUCIÓN (el par vuelve a la bodega de TikTok, en Industher) y, si se
 * tira, además una MERMA del mismo par, para que quede constancia y el saldo
 * no suba. La referencia es el PEDIDO, igual que la devolución automática
 * que el sync registraría si TikTok marcara el renglón como devuelto: el
 * índice único (tipo, referencia, sku) hace que nunca se cuente dos veces.
 * Un renglón sin SKU del ERP no mueve nada: se declara para amarrarlo.
 */
export function movimientosDeDecision(
  d: Pick<Devolucion, "orderId" | "returnId" | "renglones">,
  decisiones: DecisionDevolucion[],
  fecha: string,
): { movimientos: MovimientoDevolucion[]; sinSku: RenglonDevolucion[]; sinDecision: RenglonDevolucion[] } {
  const porLinea = new Map(decisiones.map((x) => [x.returnLineItemId, x.destino] as const));
  const devueltos = new Map<string, number>();
  const tirados = new Map<string, number>();
  const sinSku: RenglonDevolucion[] = [];
  const sinDecision: RenglonDevolucion[] = [];
  for (const r of d.renglones) {
    const destino = porLinea.get(r.returnLineItemId);
    if (!destino) {
      sinDecision.push(r);
      continue;
    }
    if (!r.sku) {
      sinSku.push(r);
      continue;
    }
    devueltos.set(r.sku, (devueltos.get(r.sku) ?? 0) + 1);
    if (destino === "basura") tirados.set(r.sku, (tirados.get(r.sku) ?? 0) + 1);
  }
  const movimientos: MovimientoDevolucion[] = [];
  for (const [sku, cantidad] of devueltos) {
    movimientos.push({
      sku,
      tipo: "devolucion",
      cantidad,
      referencia: d.orderId,
      motivo: `Devolución ${d.returnId} recibida en TikTok Shop`,
      fecha,
    });
  }
  for (const [sku, cantidad] of tirados) {
    movimientos.push({
      sku,
      tipo: "merma",
      cantidad,
      referencia: d.orderId,
      motivo: `Devolución ${d.returnId}: par dañado, se tira`,
      fecha,
    });
  }
  return { movimientos, sinSku, sinDecision };
}

/** Días completos desde una fecha ISO hasta `ahora` (ms). */
export function diasDesde(iso: string | null | undefined, ahoraMs: number): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((ahoraMs - t) / 86_400_000));
}

/**
 * Orden de la lista: primero lo que hay que recibir (lo de plazo más cercano
 * arriba), luego lo que viene en camino, lo que TikTok aún decide, lo ya
 * recibido y lo cerrado; dentro de cada grupo, lo más nuevo primero salvo en
 * «por recibir», donde manda el plazo.
 */
const ORDEN_GRUPOS: Record<GrupoDevolucion, number> = {
  por_recibir: 0,
  esperando_cliente: 1,
  pendiente_tiktok: 2,
  recibida: 3,
  cerrada: 4,
};

export function ordenarDevoluciones<T extends Pick<Devolucion, "estado" | "tipo" | "siguienteAccion" | "plazo" | "creadaEn">>(lista: T[]): T[] {
  return [...lista].sort((a, b) => {
    const ga = grupoDeDevolucion(a);
    const gb = grupoDeDevolucion(b);
    if (ga !== gb) return ORDEN_GRUPOS[ga] - ORDEN_GRUPOS[gb];
    if (ga === "por_recibir") {
      const pa = a.plazo ? Date.parse(a.plazo) : Infinity;
      const pb = b.plazo ? Date.parse(b.plazo) : Infinity;
      if (pa !== pb) return pa - pb;
    }
    return (b.creadaEn ?? "").localeCompare(a.creadaEn ?? "");
  });
}

/** Cuántas hay por grupo (las fichas de arriba). */
export function contarPorGrupo(lista: Pick<Devolucion, "estado" | "tipo" | "siguienteAccion">[]): Record<GrupoDevolucion, number> {
  const c: Record<GrupoDevolucion, number> = { por_recibir: 0, esperando_cliente: 0, pendiente_tiktok: 0, recibida: 0, cerrada: 0 };
  for (const d of lista) c[grupoDeDevolucion(d)]++;
  return c;
}

/** Las que hay que recibir y cuyo plazo de TikTok vence en menos de `horas` (o ya venció). */
export function porVencer<T extends Pick<Devolucion, "estado" | "tipo" | "siguienteAccion" | "plazo">>(lista: T[], ahoraMs: number, horas = 48): T[] {
  return lista.filter((d) => {
    if (grupoDeDevolucion(d) !== "por_recibir") return false;
    const t = d.plazo ? Date.parse(d.plazo) : NaN;
    return Number.isFinite(t) && t - ahoraMs < horas * 3_600_000;
  });
}
