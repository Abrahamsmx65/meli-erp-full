/**
 * Las rutas del API de TikTok Shop que este ERP usa, ya envueltas.
 *
 * Se separan del cliente para que quien lea el servicio vea el negocio
 * ("trae los pedidos que se movieron desde ayer") y no el ruido de la
 * paginación por token, que TikTok hace distinto en cada familia de rutas.
 */
import type { Cliente } from "./client";

// ---------------------------------------------------------------------------
// Autorización
// ---------------------------------------------------------------------------

export interface TiendaAutorizada {
  id: string;
  cipher: string;
  nombre: string | null;
  region: string | null;
}

/** Las tiendas que autorizaron esta app. Es la única ruta sin shop_cipher. */
export async function tiendasAutorizadas(c: Cliente): Promise<TiendaAutorizada[]> {
  const d = await c.llamar<any>("GET", "/authorization/202309/shops", { conCipher: false });
  return (d?.shops ?? []).map((s: any) => ({
    id: String(s.id),
    cipher: String(s.cipher ?? ""),
    nombre: s.name ?? null,
    region: s.region ?? null,
  }));
}

export interface BodegaTikTok {
  id: string;
  nombre: string | null;
  tipo: string | null;
  predeterminada: boolean;
}

/**
 * Las bodegas de la tienda. Hace falta una para poder ESCRIBIR inventario:
 * el API de existencias no acepta un número a secas, siempre va contra una
 * bodega concreta.
 */
export async function bodegas(c: Cliente): Promise<BodegaTikTok[]> {
  const d = await c.llamar<any>("GET", "/logistics/202309/warehouses");
  return (d?.warehouses ?? []).map((w: any) => ({
    id: String(w.id),
    nombre: w.name ?? null,
    tipo: w.type ?? null,
    predeterminada: Boolean(w.is_default),
  }));
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export interface SkuTikTok {
  skuId: string;
  productId: string;
  sellerSku: string | null;
  titulo: string | null;
  talla: string | null;
  precio: number | null;
  estado: string | null;
  /** Lo que TikTok dice tener publicado ahora mismo, sumando bodegas. */
  disponibleEnTikTok: number | null;
}

/**
 * Todo el catálogo de la tienda, página por página.
 *
 * El `seller_sku` es el amarre con el ERP y casi siempre viene; la talla se
 * saca de las ventanas de venta (`sales_attributes`) solo para poder mostrar
 * algo legible cuando el seller_sku viene vacío. NUNCA se deduce el SKU de
 * ahí: un SKU inventado descuenta del par equivocado.
 */
export async function catalogo(c: Cliente, tope = 20): Promise<SkuTikTok[]> {
  const salida: SkuTikTok[] = [];
  let token: string | undefined;

  for (let pagina = 0; pagina < tope; pagina++) {
    const d = await c.llamar<any>("POST", "/product/202309/products/search", {
      params: { page_size: 100, page_token: token },
      cuerpo: { status: "ALL" },
    });
    if (!d) break;

    for (const p of d.products ?? []) {
      for (const s of p.skus ?? []) {
        const tallas = (s.sales_attributes ?? [])
          .map((a: any) => a?.value_name)
          .filter(Boolean)
          .join(" / ");
        const inventario = (s.inventory ?? []).reduce(
          (a: number, i: any) => a + (Number(i?.quantity) || 0),
          0,
        );
        salida.push({
          skuId: String(s.id),
          productId: String(p.id),
          sellerSku: s.seller_sku ? String(s.seller_sku) : null,
          titulo: p.title ?? null,
          talla: tallas || null,
          precio: s.price?.sale_price != null ? Number(s.price.sale_price) : null,
          estado: p.status ?? null,
          disponibleEnTikTok: (s.inventory ?? []).length ? inventario : null,
        });
      }
    }

    token = d.next_page_token || undefined;
    if (!token) break;
  }

  return salida;
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export interface RenglonTikTok {
  lineItemId: string;
  skuId: string | null;
  sellerSku: string | null;
  titulo: string | null;
  cantidad: number;
  precio: number | null;
  estado: string | null;
}

export interface PaqueteTikTok {
  id: string;
  estado: string | null;
}

export interface PedidoTikTok {
  orderId: string;
  estado: string;
  creadoEn: string | null;
  actualizadoEn: string | null;
  enviadoEn: string | null;
  total: number | null;
  moneda: string | null;
  /** solicitud de muestra gratis de un creador: se despacha, no es venta */
  esMuestra: boolean;
  paqueteria: string | null;
  guia: string | null;
  /** TIKTOK = guía de TikTok; SELLER = paquetería propia con guía nuestra */
  shippingType: string | null;
  /** TikTok envía por PAQUETE, no por pedido; aquí van los del pedido */
  paquetes: PaqueteTikTok[];
  destinatario: string | null;
  renglones: RenglonTikTok[];
}

function iso(segundos: unknown): string | null {
  const n = Number(segundos);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/** Un pedido tal como lo manda TikTok, a nuestra forma. */
export function normalizarPedido(o: any): PedidoTikTok {
  const renglones: RenglonTikTok[] = (o.line_items ?? []).map((li: any) => ({
    lineItemId: String(li.id),
    skuId: li.sku_id ? String(li.sku_id) : null,
    sellerSku: li.seller_sku ? String(li.seller_sku) : null,
    titulo: li.product_name ?? null,
    // TikTok manda un renglón POR PAR: cada line_item es una pieza.
    cantidad: 1,
    precio: li.sale_price != null ? Number(li.sale_price) : null,
    // El estado del renglón manda sobre el del pedido: en un envío
    // parcial son distintos, y descontar por el del pedido sacaría del
    // almacén pares que siguen ahí.
    estado: li.display_status ?? o.status ?? null,
  }));

  const paquetes: PaqueteTikTok[] = (o.packages ?? []).map((p: any) => ({
    id: String(p.id),
    estado: p.status ?? null,
  }));

  const dest = o.recipient_address;
  const destinatario = dest
    ? [dest.name, dest.district_info?.map?.((d: any) => d.address_name).slice(-2).join(", ")]
        .filter(Boolean)
        .join(" · ")
    : null;

  return {
    orderId: String(o.id),
    estado: String(o.status ?? ""),
    creadoEn: iso(o.create_time),
    actualizadoEn: iso(o.update_time),
    enviadoEn: iso(o.rts_time ?? o.collection_time),
    total: o.payment?.total_amount != null ? Number(o.payment.total_amount) : null,
    moneda: o.payment?.currency ?? null,
    // TikTok marca las muestras con is_sample_order; por si un día no lo
    // manda, un pedido de $0 también es muestra: nadie regala un par sin
    // que sea eso.
    esMuestra:
      o.is_sample_order === true ||
      (o.payment?.total_amount != null && Number(o.payment.total_amount) === 0),
    paqueteria: o.shipping_provider ?? null,
    guia: o.tracking_number ?? null,
    shippingType: o.shipping_type ?? null,
    paquetes,
    destinatario: destinatario || null,
    renglones,
  };
}

/**
 * Pedidos concretos, por id. Es lo que usa el webhook (TikTok avisa de UN
 * pedido) y la confirmación de envío desde el ERP.
 */
export async function pedidosPorId(c: Cliente, ids: string[]): Promise<PedidoTikTok[]> {
  const salida: PedidoTikTok[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await c.llamar<any>("GET", "/order/202309/orders", {
      params: { ids: ids.slice(i, i + 50).join(",") },
    });
    if (!d) break;
    for (const o of d.orders ?? []) salida.push(normalizarPedido(o));
  }
  return salida;
}

/**
 * Los pedidos que se MOVIERON desde `desde` (epoch en segundos).
 *
 * Se busca por fecha de actualización, no de creación, justamente porque lo
 * que importa aquí es el cambio de estado: un pedido de hace una semana que
 * hoy se envió tiene que aparecer hoy, o su salida nunca se registraría.
 */
export interface DiagnosticoPedidos {
  /** Lo que TikTok dice que hay en la ventana, aunque no lo traiga todo. */
  totalCount: number | null;
  paginas: number;
  /** Llaves de la primera respuesta: para ver de un vistazo si cambió la forma. */
  llaves: string[];
}

export async function pedidosActualizados(
  c: Cliente,
  desde: number,
  hasta: number,
  tope = 40,
  diag?: DiagnosticoPedidos,
): Promise<PedidoTikTok[]> {
  const salida: PedidoTikTok[] = [];
  let token: string | undefined;

  for (let pagina = 0; pagina < tope; pagina++) {
    const d = await c.llamar<any>("POST", "/order/202309/orders/search", {
      params: { page_size: 50, page_token: token, sort_field: "update_time", sort_order: "ASC" },
      cuerpo: { update_time_ge: desde, update_time_lt: hasta },
    });
    if (!d) break;

    if (diag) {
      diag.paginas++;
      if (pagina === 0) {
        diag.llaves = Object.keys(d);
        diag.totalCount = d.total_count != null ? Number(d.total_count) : null;
      }
    }

    for (const o of d.orders ?? []) salida.push(normalizarPedido(o));

    token = d.next_page_token || undefined;
    if (!token) break;
  }

  return salida;
}

// ---------------------------------------------------------------------------
// Escribir la disponibilidad. Es el punto del sistema.
// ---------------------------------------------------------------------------

export interface StockAEscribir {
  productId: string;
  skuId: string;
  cantidad: number;
}

export interface ResultadoPublicacion {
  publicados: number;
  fallidos: { skuId: string; error: string }[];
}

/**
 * Escribe el disponible en TikTok.
 *
 * El API es POR PRODUCTO y acepta varios SKUs del mismo producto en una
 * llamada, así que se agrupan: un modelo con doce tallas se publica de una
 * vez en lugar de doce. Un producto que falle no detiene a los demás — se
 * anota y la siguiente corrida lo vuelve a intentar, porque el disponible se
 * calcula del kardex cada vez y no se pierde nada.
 */
export async function publicarStock(
  c: Cliente,
  warehouseId: string,
  cambios: StockAEscribir[],
): Promise<ResultadoPublicacion> {
  const porProducto = new Map<string, StockAEscribir[]>();
  for (const s of cambios) {
    const lista = porProducto.get(s.productId);
    if (lista) lista.push(s);
    else porProducto.set(s.productId, [s]);
  }

  let publicados = 0;
  const fallidos: { skuId: string; error: string }[] = [];

  for (const [productId, skus] of porProducto) {
    if (c.msRestantes() < 10_000) break;
    try {
      await c.llamar("POST", `/product/202309/products/${productId}/inventory/update`, {
        cuerpo: {
          skus: skus.map((s) => ({
            id: s.skuId,
            inventory: [{ warehouse_id: warehouseId, quantity: s.cantidad }],
          })),
        },
      });
      publicados += skus.length;
    } catch (err) {
      const mensaje = (err as Error).message;
      for (const s of skus) fallidos.push({ skuId: s.skuId, error: mensaje });
    }
  }

  return { publicados, fallidos };
}

// ---------------------------------------------------------------------------
// Envío desde el ERP. TikTok envía por PAQUETE.
// ---------------------------------------------------------------------------

export interface OpcionesEnvio {
  /** PICKUP: pasa el repartidor. DROP_OFF: se lleva a la paquetería. */
  handover: "PICKUP" | "DROP_OFF";
  /** Con PICKUP: el horario elegido; sin él TikTok lo trata como drop-off. */
  horario?: HorarioRecoleccion | null;
  /** Solo cuando la paquetería es propia (shipping_type SELLER). */
  guia?: string | null;
  proveedorId?: string | null;
}

/**
 * Los paquetes de un pedido. Con guía de TikTok el paquete ya existe; con
 * paquetería propia a veces hay que crearlo primero.
 */
export async function paquetesDePedido(c: Cliente, orderId: string): Promise<PaqueteTikTok[]> {
  const [p] = await pedidosPorId(c, [orderId]);
  if (p?.paquetes.length) return p.paquetes;

  const d = await c.llamar<any>("POST", "/fulfillment/202309/packages", {
    cuerpo: { order_id: orderId },
  });
  const id = d?.package_id ?? d?.id;
  return id ? [{ id: String(id), estado: null }] : [];
}

/**
 * Confirma el envío de un paquete. Con guía de TikTok basta decir cómo se
 * entrega; con paquetería propia hay que darle guía y proveedor.
 */
export async function enviarPaquete(
  c: Cliente,
  packageId: string,
  opciones: OpcionesEnvio,
): Promise<void> {
  const cuerpo: Record<string, unknown> = { handover_method: opciones.handover };
  if (opciones.handover === "PICKUP" && opciones.horario) {
    cuerpo.pickup_slot = { start_time: opciones.horario.inicio, end_time: opciones.horario.fin };
  }
  if (opciones.guia && opciones.proveedorId) {
    cuerpo.self_shipment = {
      tracking_number: opciones.guia,
      shipping_provider_id: opciones.proveedorId,
    };
  }
  await c.llamar("POST", `/fulfillment/202309/packages/${packageId}/ship`, { cuerpo });
}

/** La guía en PDF del paquete (la que se pega en la caja). */
export async function etiquetaDePaquete(c: Cliente, packageId: string): Promise<string | null> {
  const d = await c.llamar<any>(
    "GET",
    `/fulfillment/202309/packages/${packageId}/shipping_documents`,
    { params: { document_type: "SHIPPING_LABEL", document_size: "A6" } },
  );
  // Que el motivo se vea: null = TikTok no contestó (límite de llamadas o
  // sin tiempo); sin doc_url = contestó otra cosa (guía aún no generada).
  if (!d) throw new Error("TikTok no contestó la guía (límite de llamadas); se reintenta al volver a pedir el PDF");
  if (!d.doc_url) throw new Error(`TikTok contestó sin guía (${Object.keys(d).join(", ") || "vacío"}); puede que aún no la genere`);
  return String(d.doc_url);
}

export interface ProveedorEnvio {
  id: string;
  nombre: string;
}

/** Las paqueterías que TikTok acepta para envío propio (Estafeta, DHL…). */
export async function proveedoresDeEnvio(c: Cliente): Promise<ProveedorEnvio[]> {
  const d = await c.llamar<any>("GET", "/logistics/202309/shipping_providers", {
    params: { delivery_option_id: undefined },
  });
  return (d?.shipping_providers ?? []).map((p: any) => ({
    id: String(p.id),
    nombre: String(p.name ?? p.id),
  }));
}

/** Qué renglones del pedido van en un paquete (para pedidos de varios paquetes). */
export async function renglonesDelPaquete(c: Cliente, packageId: string): Promise<string[]> {
  const d = await c.llamar<any>("GET", `/fulfillment/202309/packages/${packageId}`);
  const ids = d?.order_line_item_ids ?? d?.line_item_ids ?? [];
  return (ids as unknown[]).map(String);
}

export interface HorarioRecoleccion {
  inicio: number;
  fin: number;
}

export interface OpcionesDeEntrega {
  /** null = TikTok no lo dijo */
  puedeRecoleccion: boolean | null;
  puedeDropOff: boolean | null;
  horarios: HorarioRecoleccion[];
  /** las llaves de la respuesta, para saber qué contestó cuando algo no cuadre */
  llaves: string[];
}

/**
 * Cómo se puede entregar un paquete y en qué horarios pasa la paquetería.
 * TikTok exige el horario para RECOLECCIÓN: mandar PICKUP sin horario lo
 * acepta pero lo trata como entrega en paquetería, y la guía sale como
 * drop-off. Y si `puedeRecoleccion` es false, la tienda o la paquetería no
 * tienen recolección habilitada y no hay horario que valga.
 */
export async function opcionesDeEntrega(c: Cliente, packageId: string): Promise<OpcionesDeEntrega> {
  const d = await c.llamar<any>("GET", `/fulfillment/202309/packages/${packageId}/handover_time_slots`);
  const listas: any[] = [
    ...(d?.pickup_time_slots ?? []),
    ...(d?.time_slots ?? []),
    ...(d?.slots ?? []),
  ];
  const horarios = listas
    .filter((s) => s && (s.avaliable ?? s.available ?? true) !== false)
    .map((s) => ({ inicio: Number(s.start_time), fin: Number(s.end_time) }))
    .filter((s) => Number.isFinite(s.inicio) && Number.isFinite(s.fin));
  // Cuando la recolección no está disponible, TikTok NO manda can_pickup en
  // false: simplemente contesta { can_drop_off: true } y nada más. Se leyó
  // así en producción (paquete J&T MX, Naucalpan). Así que "no viene" con
  // drop-off presente = no hay recolección.
  const canPickup = typeof d?.can_pickup === "boolean" ? d.can_pickup : null;
  const canDropOff = typeof d?.can_drop_off === "boolean" ? d.can_drop_off : null;
  return {
    puedeRecoleccion: canPickup ?? (canDropOff === true && !horarios.length ? false : null),
    puedeDropOff: canDropOff,
    horarios,
    llaves: d ? Object.keys(d) : [],
  };
}

/** Solo los horarios (compatibilidad). */
export async function horariosDeRecoleccion(c: Cliente, packageId: string): Promise<HorarioRecoleccion[]> {
  return (await opcionesDeEntrega(c, packageId)).horarios;
}

// ---------------------------------------------------------------------------
// Cancelar renglones de un pedido (defensa del corte)
// ---------------------------------------------------------------------------

/**
 * Los motivos con los que el VENDEDOR cancela un pedido sin enviar. TikTok
 * NO tiene un endpoint que los liste para el vendedor (el `reject_reasons`
 * de 202309 es para RECHAZAR una solicitud del comprador): son claves fijas
 * de su documentación «Cancel reasons». Hasta el 18-sep-2026 el corte le
 * pedía la lista a `/order/202309/orders/cancellation_reasons`, que no
 * existe, y el error se tragaba: la defensa nunca canceló nada y 16 pedidos
 * se quedaron fuera de cuatro cortes seguidos. La primera clave es la de
 * «sin stock» de un pedido por enviar; las demás son respaldo. Se prueban
 * en orden y el corte se queda con la que TikTok acepte.
 */
export const MOTIVOS_SIN_STOCK = ["ecom_order_to_ship_canceled_reason_out_of_stock", "seller_out_of_stock"];

/**
 * Los motivos con los que TikTok deja cancelar ESTE pedido al vendedor. El
 * 18-sep-2026 TikTok contestó a la clave de su documentación: «cancel_reason
 * must exactly match an available_reason_names value returned by Get
 * Aftersale Eligibility for this order». Así que se le pregunta por pedido
 * (`GET /return_refund/202309/orders/{id}/aftersale_eligibility`, como
 * vendedor) y se junta todo `available_reason_names` que traiga, a la
 * profundidad que sea: la forma exacta de la respuesta no está en ningún
 * SDK público, por eso el crudo se guarda en la bitácora la primera vez.
 */
export interface MotivosDeCancelacion {
  motivos: string[];
  crudo: unknown;
}

export async function motivosDeCancelacion(c: Cliente, orderId: string): Promise<MotivosDeCancelacion> {
  const d = await c.llamar<any>("GET", `/return_refund/202309/orders/${orderId}/aftersale_eligibility`, {
    params: { initiate_aftersale_user: "SELLER" },
  });
  return { motivos: nombresDeMotivo(d), crudo: d };
}

/** Todos los nombres de motivo de la respuesta, sin repetir y en su orden. */
export function nombresDeMotivo(json: unknown): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  const agregar = (v: unknown) => {
    const t = String(v ?? "").trim();
    if (t && !vistos.has(t)) {
      vistos.add(t);
      salida.push(t);
    }
  };
  const recorrer = (nodo: unknown, profundidad: number) => {
    if (profundidad > 8 || nodo == null || typeof nodo !== "object") return;
    if (Array.isArray(nodo)) {
      for (const x of nodo) recorrer(x, profundidad + 1);
      return;
    }
    for (const [k, v] of Object.entries(nodo as Record<string, unknown>)) {
      if (/^available_reason_names?$/.test(k) && Array.isArray(v)) {
        for (const x of v) {
          if (typeof x === "string") agregar(x);
          else if (x && typeof x === "object") agregar((x as any).name ?? (x as any).reason_name ?? (x as any).key);
        }
      } else if (/^available_reasons$/.test(k) && Array.isArray(v)) {
        for (const x of v) agregar(typeof x === "string" ? x : (x as any)?.name ?? (x as any)?.reason_name ?? (x as any)?.key);
      } else {
        recorrer(v, profundidad + 1);
      }
    }
  };
  recorrer(json, 0);
  return salida;
}

/** El motivo de «sin stock» entre los que TikTok ofrece; si no lo nombra así, el primero. */
export function motivoSinStock(motivos: string[]): string | null {
  return motivos.find((m) => /stock|inventor|agot/i.test(m)) ?? motivos[0] ?? null;
}

/**
 * ¿TikTok rechazó la cancelación PARCIAL? El 18-sep-2026 TikTok MX contestó
 * 11050001 «Cannot partially cancel this order… otherwise request a
 * full-order cancellation»: un pedido grande con un renglón sin stock no se
 * arregla solo; hay que avisarle a quien despacha.
 */
export function esErrorDeParcial(err: unknown): boolean {
  const codigo = (err as { codigo?: unknown })?.codigo;
  const m = (err as Error)?.message ?? String(err ?? "");
  return codigo === 11050001 || /11050001|partial(ly)? cancel/i.test(m);
}

/** ¿TikTok rechazó la cancelación por el MOTIVO (clave inválida o que no cuadra con el estado)? */
export function esErrorDeMotivo(err: unknown): boolean {
  const codigo = (err as { codigo?: unknown })?.codigo;
  const m = (err as Error)?.message ?? "";
  return codigo === 25001021 || /reason/i.test(m);
}

export interface Cancelacion {
  cancelId: string | null;
  /** el `cancel_status` de TikTok; null si no lo dijo */
  estado: string | null;
  /** la clave de motivo que TikTok aceptó */
  motivo: string;
  /** true si la cancelación ya surtió efecto; false si quedó PENDIENTE (del comprador) */
  aceptada: boolean;
}

/** Una cancelación sin estado se da por hecha; una PENDING no: el par sigue vendido. */
export function cancelacionAceptada(estado: string | null): boolean {
  if (!estado) return true;
  return !/PENDING/i.test(estado);
}

/**
 * Cancela renglones de un pedido (`POST /return_refund/202309/cancellations`,
 * la ruta del vendedor en 202309): con `skus` es cancelación PARCIAL (solo
 * esos SKUs, esas cantidades) y lo demás sigue vivo para confirmarse; sin
 * `skus`, se cancela el pedido completo. Los `motivos` se prueban en orden
 * y solo se pasa al siguiente si TikTok rechaza EL MOTIVO; cualquier otro
 * error (ya enviado, plazo vencido…) se lanza tal cual: quien llama
 * decide, y en el corte la decisión es NO confirmar ese pedido.
 */
export async function cancelarRenglones(
  c: Cliente,
  orderId: string,
  motivos: string[],
  skus?: { skuId: string; cantidad: number }[],
): Promise<Cancelacion> {
  let ultimo: unknown = null;
  for (const motivo of motivos) {
    const cuerpo: Record<string, unknown> = { order_id: orderId, cancel_reason: motivo };
    if (skus?.length) cuerpo.skus = skus.map((s) => ({ sku_id: s.skuId, quantity: s.cantidad }));
    try {
      const d = await c.llamar<any>("POST", "/return_refund/202309/cancellations", { cuerpo });
      if (!d) throw new Error("TikTok no contestó la cancelación (sin tiempo).");
      const estado = d?.cancel_status != null ? String(d.cancel_status) : null;
      return {
        cancelId: d?.cancel_id != null ? String(d.cancel_id) : null,
        estado,
        motivo,
        aceptada: cancelacionAceptada(estado),
      };
    } catch (err) {
      ultimo = err;
      if (!esErrorDeMotivo(err)) throw err;
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error("TikTok no aceptó ningún motivo de cancelación.");
}

// ---------------------------------------------------------------------------
// Finanzas: lo que TikTok liquida por un pedido
// ---------------------------------------------------------------------------

export interface LiquidacionTikTok {
  /** lo que entra a la cuenta por el pedido: ingreso − comisiones − envío */
  neto: number;
  ingreso: number | null;
  comisiones: number | null;
  envio: number | null;
  moneda: string | null;
  statementId: string | null;
  crudo: unknown;
}

function numero(x: unknown): number | null {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Saca el neto de la respuesta de finanzas sin casarse con una forma exacta:
 * si el nivel de arriba trae `settlement_amount` se usa; si no, se suman las
 * transacciones. Se guarda el crudo para poder afinarlo después.
 */
export function interpretarLiquidacion(d: any): LiquidacionTikTok | null {
  if (!d || typeof d !== "object") return null;
  const arriba = numero(d.settlement_amount);
  const lista: any[] = Array.isArray(d.transactions)
    ? d.transactions
    : Array.isArray(d.statement_transactions)
      ? d.statement_transactions
      : [];
  const suma = (campo: string): number | null => {
    let hay = false;
    let total = 0;
    for (const t of lista) {
      const n = numero(t?.[campo]);
      if (n == null) continue;
      hay = true;
      total += n;
    }
    return hay ? total : null;
  };
  const neto = arriba ?? suma("settlement_amount");
  if (neto == null) return null;
  return {
    neto,
    ingreso: numero(d.revenue_amount) ?? suma("revenue_amount"),
    comisiones: numero(d.fee_amount) ?? suma("fee_amount"),
    envio: numero(d.shipping_cost_amount) ?? suma("shipping_cost_amount"),
    moneda: d.currency ?? lista[0]?.currency ?? null,
    statementId: d.statement_id ?? lista[0]?.statement_id ?? null,
    crudo: d,
  };
}

/**
 * La liquidación de un pedido. null = TikTok todavía no lo liquida (no
 * está en ningún estado de cuenta) o no contestó nada usable.
 */
export async function liquidacionDePedido(
  c: Cliente,
  orderId: string,
): Promise<{ liquidacion: LiquidacionTikTok | null; crudo: unknown }> {
  const d = await c.llamar<any>("GET", `/finance/202309/orders/${encodeURIComponent(orderId)}/statement_transactions`);
  return { liquidacion: interpretarLiquidacion(d), crudo: d ?? null };
}
