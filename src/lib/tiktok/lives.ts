/**
 * MIS LIVE: los LIVE propios de la tienda en TikTok Shop. Motor puro (sin red
 * ni base).
 *
 * TikTok da, por sesión de LIVE (`GET /analytics/202609/shop_lives/
 * performance`, por tipo de cuenta: oficial, de marketing o de afiliados),
 * sus ventas atribuidas, su tráfico y su interacción, y por LIVE lo vendido
 * producto por producto (`GET /analytics/202512/shop/{live_id}/
 * products_performance`). Lo que NO da es qué PEDIDO salió del live, así que
 * los pedidos se toman del ERP: los de la TIENDA (sin creador) que entraron
 * mientras duró el live (más un margen corto después), con lo que TikTok
 * paga por cada uno (`pagoEsperado`, nunca una estimación) y el costo de sus
 * pares. Se declara así en la pantalla.
 *
 * Pedido del dueño (13-nov-2026): «una sección de análisis de los live en
 * vivo para saber qué se vendió, los pedidos que contienen, cuánto gané…; me
 * refiero a mis live propios».
 */
import { modeloDeSku, ventaDeOrden, type OrdenParaVentas, type RenglonParaVentas } from "./ventas";

/** Tipos de cuenta que son NUESTROS en la analítica de TikTok (los afiliados no). */
export const CUENTAS_PROPIAS = ["OFFICIAL_ACCOUNTS", "MARKETING_ACCOUNTS"] as const;
export type CuentaLive = (typeof CUENTAS_PROPIAS)[number];

export const NOMBRE_CUENTA: Record<string, string> = {
  OFFICIAL_ACCOUNTS: "Cuenta oficial",
  MARKETING_ACCOUNTS: "Cuenta de marketing",
  AFFILIATE_ACCOUNTS: "Afiliado",
};

/** Minutos después de que termina el live en que un pedido de la tienda todavía se le cuenta. */
export const MINUTOS_DESPUES_DEL_LIVE = 30;

export interface VentasDeLive {
  /** GMV atribuido al live (directo + indirecto) */
  gmv: number;
  /** vendido DURANTE el live */
  gmvDirecto: number;
  /** visto en el live y comprado después */
  gmvIndirecto: number;
  pedidos: number;
  pedidosSku: number;
  piezas: number;
  clientes: number;
  productosVendidos: number;
  productosAgregados: number;
  /** pedidos pagados ÷ pedidos creados (0–1) */
  tasaPago: number | null;
  ticketPromedio: number;
}

export interface TraficoDeLive {
  espectadores: number;
  vistas: number;
  pico: number;
  promedioConcurrentes: number;
  /** segundos */
  duracionPromedioVista: number;
  impresiones: number;
  clicsProducto: number;
  impresionesProducto: number;
  /** clics a producto ÷ vistas (0–1) */
  ctr: number | null;
  /** GMV por cada 1,000 vistas */
  gpm: number;
  gmvPorHora: number;
}

export interface InteraccionDeLive {
  likes: number;
  comentarios: number;
  compartidos: number;
  seguidoresNuevos: number;
}

export interface LiveSesion {
  liveId: string;
  titulo: string | null;
  cuentaTipo: string;
  creador: { nombre: string | null; usuario: string | null } | null;
  /** ISO UTC */
  inicio: string | null;
  fin: string | null;
  duracionMin: number | null;
  ventas: VentasDeLive;
  trafico: TraficoDeLive;
  interaccion: InteraccionDeLive;
}

function monto(x: unknown): number {
  if (x == null) return 0;
  const n = typeof x === "object" ? Number((x as { amount?: unknown }).amount) : Number(x);
  return Number.isFinite(n) ? n : 0;
}

function entero(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function tasa(x: unknown): number | null {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function isoDeUnix(x: unknown): string | null {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Segundos o milisegundos: TikTok los manda en segundos.
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

/** La respuesta cruda de la lista de LIVE → sesiones; `siguiente` es el token de la página que sigue. */
export function interpretarLives(crudo: unknown, cuentaTipo: string): { lives: LiveSesion[]; siguiente: string | undefined; total: number | null } {
  const d = (crudo as any)?.data ?? crudo;
  const lista = Array.isArray(d?.live_stream_sessions) ? (d.live_stream_sessions as any[]) : [];
  const lives: LiveSesion[] = [];
  for (const s of lista) {
    const liveId = String(s?.id ?? "").trim();
    if (!liveId) continue;
    const v = s?.sales_performance ?? {};
    const t = s?.traffic ?? {};
    const i = s?.interaction_performance ?? {};
    const inicio = isoDeUnix(s?.start_time);
    const fin = isoDeUnix(s?.end_time);
    const duracionMin = inicio && fin ? Math.max(0, Math.round((Date.parse(fin) - Date.parse(inicio)) / 60_000)) : null;
    const gmvDirecto = monto(v.live_gmv);
    const gmvIndirecto = monto(v.live_indirect_gmv);
    const gmv = monto(v.live_attributed_gmv) || gmvDirecto + gmvIndirecto;
    lives.push({
      liveId,
      titulo: s?.title ? String(s.title) : null,
      cuentaTipo,
      creador: s?.creator ? { nombre: s.creator.nick_name ? String(s.creator.nick_name) : null, usuario: s.creator.user_name ? String(s.creator.user_name) : null } : null,
      inicio,
      fin,
      duracionMin,
      ventas: {
        gmv,
        gmvDirecto,
        gmvIndirecto,
        pedidos: entero(v.live_attributed_orders),
        pedidosSku: entero(v.live_attributed_sku_orders),
        piezas: entero(v.live_attributed_items_sold),
        clientes: entero(v.attributed_customers),
        productosVendidos: entero(v.products_sold),
        productosAgregados: entero(t.products_added),
        tasaPago: tasa(v.payment_rate),
        ticketPromedio: monto(v.aov),
      },
      trafico: {
        espectadores: entero(t.viewers),
        vistas: entero(t.views),
        pico: entero(t.pcu),
        promedioConcurrentes: entero(t.acu),
        duracionPromedioVista: entero(t.avg_viewing_duration_per_viewer || t.avg_viewing_duration),
        impresiones: entero(t.impressions),
        clicsProducto: entero(t.product_clicks),
        impresionesProducto: entero(t.product_impressions),
        ctr: tasa(t.ctr),
        gpm: monto(t.watch_gpm) || monto(t.show_gpm),
        gmvPorHora: monto(t.gmv_per_hour),
      },
      interaccion: {
        likes: entero(i.likes),
        comentarios: entero(i.comments),
        compartidos: entero(i.shares),
        seguidoresNuevos: entero(i.new_followers),
      },
    });
  }
  return { lives, siguiente: d?.next_page_token ? String(d.next_page_token) : undefined, total: d?.total_count != null ? entero(d.total_count) : null };
}

export interface ProductoDeLive {
  productId: string;
  nombre: string | null;
  piezas: number;
  gmv: number;
  pedidosSku: number;
  pedidos: number;
  clientes: number;
  precioPromedio: number;
  impresiones: number;
  clics: number;
  ctr: number | null;
  alCarrito: number;
}

/** La respuesta cruda de productos del LIVE → lo vendido producto por producto, de más a menos GMV. */
export function interpretarProductosDeLive(crudo: unknown): ProductoDeLive[] {
  const d = (crudo as any)?.data ?? crudo;
  const lista = Array.isArray(d?.products) ? (d.products as any[]) : [];
  return lista
    .map((p): ProductoDeLive | null => {
      const productId = String(p?.id ?? "").trim();
      if (!productId) return null;
      const s = p?.sales ?? {};
      const t = p?.traffic ?? {};
      return {
        productId,
        nombre: p?.name ? String(p.name) : null,
        piezas: entero(s.items_sold),
        gmv: monto(s.direct_gmv),
        pedidosSku: entero(s.sku_orders),
        pedidos: entero(s.main_orders),
        clientes: entero(s.customers),
        precioPromedio: monto(s.avg_price),
        impresiones: entero(t.product_impressions),
        clics: entero(t.produt_clicks ?? t.product_clicks),
        ctr: tasa(t.ctr),
        alCarrito: entero(t.add_to_cart_count),
      };
    })
    .filter((p): p is ProductoDeLive => p !== null)
    .sort((a, b) => b.gmv - a.gmv || b.piezas - a.piezas);
}

// ---------------------------------------------------------------------------
// Pedidos de la tienda en la ventana del live
// ---------------------------------------------------------------------------

const NO_CUENTAN = new Set(["UNPAID", "CANCELLED", "CANCEL"]);

/** Un pedido como lo entrega `tiktok_ventas_pedidos`, con lo que dice el amarre de afiliados. */
export type OrdenDeLive = OrdenParaVentas & {
  /** el creador que trajo el pedido; null = de la TIENDA */
  creador?: string | null;
  /** true si ya se revisó contra la lista de afiliados */
  afiliadoLeido?: boolean;
};

export interface PedidoDeLive {
  orderId: string;
  /** ISO */
  creadoEn: string;
  skus: { sku: string; cantidad: number }[];
  pares: number;
  /** la venta según TikTok (ingreso) o precio × cantidad */
  cobrado: number;
  /** lo que TikTok paga por el pedido; null = TikTok aún no lo calcula */
  pagaTikTok: number | null;
  /** costo de sus pares; null si algún modelo no tiene costo */
  costo: number | null;
  ganancia: number | null;
}

export interface TotalesDeLive {
  pedidos: number;
  pares: number;
  cobrado: number;
  /** suma de lo que paga TikTok por los pedidos con dato */
  pagaTikTok: number;
  pedidosSinDato: number;
  /** costo de los pedidos con dato y con costo */
  costo: number;
  /** ganancia = paga TikTok − costo, solo de los pedidos con las dos cosas */
  ganancia: number;
  pedidosConGanancia: number;
  pedidosSinCosto: number;
  /** pedidos de la ventana que aún no se revisaron contra afiliados: no se cuentan */
  sinRevisar: number;
  /** pedidos de creadores en la misma ventana (no son del live propio) */
  deCreadores: number;
}

export interface PedidosDeLive {
  ventana: { desde: string; hasta: string; minutosDespues: number };
  pedidos: PedidoDeLive[];
  totales: TotalesDeLive;
}

/**
 * Los pedidos de la TIENDA (sin creador, ya revisados contra afiliados) que
 * entraron entre el inicio del live y `minutosDespues` después de su fin,
 * con lo que TikTok paga por ellos y el costo de sus pares.
 */
export function pedidosDelLive(
  ordenes: OrdenDeLive[],
  renglones: RenglonParaVentas[],
  live: { inicio: string; fin: string },
  costoDe: Map<string, number>,
  minutosDespues: number = MINUTOS_DESPUES_DEL_LIVE,
): PedidosDeLive {
  const desdeMs = Date.parse(live.inicio);
  const hastaMs = Date.parse(live.fin) + minutosDespues * 60_000;
  const ventana = { desde: new Date(desdeMs).toISOString(), hasta: new Date(hastaMs).toISOString(), minutosDespues };
  const totales: TotalesDeLive = {
    pedidos: 0, pares: 0, cobrado: 0, pagaTikTok: 0, pedidosSinDato: 0, costo: 0, ganancia: 0, pedidosConGanancia: 0, pedidosSinCosto: 0, sinRevisar: 0, deCreadores: 0,
  };
  const porOrden = new Map<string, RenglonParaVentas[]>();
  for (const r of renglones) {
    if (NO_CUENTAN.has(String(r.estado ?? "").toUpperCase())) continue;
    const lista = porOrden.get(r.orderId) ?? [];
    lista.push(r);
    porOrden.set(r.orderId, lista);
  }
  const pedidos: PedidoDeLive[] = [];
  for (const o of ordenes) {
    if (!o.creadoEn || o.esMuestra || NO_CUENTAN.has(String(o.estado ?? "").toUpperCase())) continue;
    const ms = Date.parse(o.creadoEn);
    if (!Number.isFinite(ms) || ms < desdeMs || ms > hastaMs) continue;
    if (o.creador) {
      totales.deCreadores++;
      continue;
    }
    if (!o.afiliadoLeido) {
      totales.sinRevisar++;
      continue;
    }
    const vivos = porOrden.get(o.orderId) ?? [];
    const pares = vivos.reduce((a, r) => a + r.cantidad, 0);
    if (!pares) continue;
    const cobradoRenglones = vivos.reduce((a, r) => a + (r.precio ?? 0) * r.cantidad, 0);
    const cobrado = ventaDeOrden(o, cobradoRenglones);
    const pagaTikTok = o.pagoEsperado ?? o.netoRecibido ?? null;
    let costo: number | null = 0;
    const porSku = new Map<string, number>();
    for (const r of vivos) {
      const sku = r.skuInterno ?? "(sin SKU)";
      porSku.set(sku, (porSku.get(sku) ?? 0) + r.cantidad);
      const c = r.skuInterno ? costoDe.get(modeloDeSku(r.skuInterno)) : undefined;
      if (c == null || costo == null) costo = null;
      else costo += c * r.cantidad;
    }
    const ganancia = pagaTikTok != null && costo != null ? pagaTikTok - costo : null;
    pedidos.push({
      orderId: o.orderId,
      creadoEn: new Date(ms).toISOString(),
      skus: [...porSku.entries()].map(([sku, cantidad]) => ({ sku, cantidad })),
      pares,
      cobrado,
      pagaTikTok,
      costo,
      ganancia,
    });
    totales.pedidos++;
    totales.pares += pares;
    totales.cobrado += cobrado;
    if (pagaTikTok == null) totales.pedidosSinDato++;
    else totales.pagaTikTok += pagaTikTok;
    if (costo == null) totales.pedidosSinCosto++;
    if (ganancia != null && costo != null) {
      totales.costo += costo;
      totales.ganancia += ganancia;
      totales.pedidosConGanancia++;
    }
  }
  pedidos.sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
  return { ventana, pedidos, totales };
}

export interface ResumenLives {
  lives: number;
  minutos: number;
  gmv: number;
  pedidosTikTok: number;
  piezas: number;
  espectadores: number;
  picoMaximo: number;
  /** de los pedidos de la tienda en la ventana de cada live, los que tienen dato y costo */
  ganancia: number;
  pagaTikTok: number;
  pedidosTienda: number;
  pedidosSinDato: number;
  pedidosSinCosto: number;
  livesSinPedidos: number;
}

/** Suma las sesiones del rango; `pedidos` es lo guardado por live (null si aún no se calculó). */
export function resumenLives(lives: { sesion: LiveSesion; pedidos: PedidosDeLive | null }[]): ResumenLives {
  const r: ResumenLives = {
    lives: 0, minutos: 0, gmv: 0, pedidosTikTok: 0, piezas: 0, espectadores: 0, picoMaximo: 0, ganancia: 0, pagaTikTok: 0, pedidosTienda: 0, pedidosSinDato: 0, pedidosSinCosto: 0, livesSinPedidos: 0,
  };
  for (const { sesion, pedidos } of lives) {
    r.lives++;
    r.minutos += sesion.duracionMin ?? 0;
    r.gmv += sesion.ventas.gmv;
    r.pedidosTikTok += sesion.ventas.pedidos;
    r.piezas += sesion.ventas.piezas;
    r.espectadores += sesion.trafico.espectadores;
    r.picoMaximo = Math.max(r.picoMaximo, sesion.trafico.pico);
    if (!pedidos) {
      r.livesSinPedidos++;
      continue;
    }
    r.ganancia += pedidos.totales.ganancia;
    r.pagaTikTok += pedidos.totales.pagaTikTok;
    r.pedidosTienda += pedidos.totales.pedidos;
    r.pedidosSinDato += pedidos.totales.pedidosSinDato;
    r.pedidosSinCosto += pedidos.totales.pedidosSinCosto;
  }
  return r;
}
