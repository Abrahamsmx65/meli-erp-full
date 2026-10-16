/**
 * VENDEDORES EXTERNOS en la tienda de TikTok (pedido del dueño,
 * 11-oct-2026: «david, que vende en Shein, quiere subir sus productos pero
 * él los despacha desde otra bodega»).
 *
 * La tienda de TikTok es UNA, pero desde ese día no todo lo que vende es
 * del dueño: David publica sus propios productos en la misma tienda, los
 * surte desde SU bodega y los despacha él. Para el ERP eso significa:
 *
 *   · Una PUBLICACIÓN (product_id de TikTok) se liga a un vendedor externo
 *     y con ella TODOS sus SKUs (`tiktok_productos_externos`). Lo que no
 *     está ligado es del dueño, como siempre.
 *   · Esos SKUs viven en el mismo kardex de TikTok (así TikTok recibe el
 *     disponible por el mismo camino), pero su stock lo captura el
 *     vendedor a mano: Industher no los tiene, el estante no los topa, la
 *     alarma no los juzga y al 3PL no se le mandan sus salidas.
 *   · Un pedido con ALGÚN SKU de David es de David: va a SU corte, no al
 *     del dueño, aunque traiga también un par del dueño (decisión del
 *     dueño: «si un cliente compra un producto de nosotros dos juntos que
 *     salga en su corte, no en el mío»).
 *   · Su venta NO entra a la ganancia del dueño ni a sus costos (Ventas
 *     TikTok, Estado de resultados, resumen diario, compras, reabasto).
 *     En un pedido mixto, lo que TikTok paga se reparte por precio entre
 *     los renglones, y al dueño solo le queda la parte de los suyos.
 *
 * Todo puro: los servicios leen la base y le pasan a esto los mapas.
 */
import type { AmarreTikTok } from "./amarre";
import type { OrdenParaVentas, RenglonParaVentas } from "./ventas";

/** Los vendedores externos que la tienda conoce. La clave es la que se guarda en la base. */
export const VENDEDORES_EXTERNOS: Record<string, { nombre: string }> = {
  david: { nombre: "David" },
};

/** El único vendedor externo de hoy (la pantalla es de él). */
export const VENDEDOR_DAVID = "david";

export function nombreDeVendedor(vendedor: string | null | undefined): string {
  if (!vendedor) return "GETAC";
  return VENDEDORES_EXTERNOS[vendedor]?.nombre ?? vendedor;
}

/** Una clave de vendedor válida o null (el dueño). Cualquier otra cosa se descarta. */
export function normalizarVendedor(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s && VENDEDORES_EXTERNOS[s] ? s : null;
}

/** Dos filtros de vendedor son el mismo: null (dueño) solo con null. */
export function mismoVendedor(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/** sku del ERP → vendedor externo al que pertenece. */
export type MapaExternos = Map<string, string>;

/**
 * El nombre del kardex de un SKU de una publicación EXTERNA. Si el ERP lo
 * amarró a algo (a mano, catálogo, MELI…), ese nombre se queda; si no, es su
 * propio `seller_sku` tal cual (recortado), con origen `externo`.
 *
 * Sin esto, la sincronización del catálogo le borraba el nombre: David
 * renombró sus variantes con el prefijo «D-» (acuerdo con el dueño,
 * 16-oct-2026: «todo lo de él en los SKUs le está poniendo una D antes para
 * diferenciar»), «D-GT074-BLK-24-MX» no amarra con nada del ERP, la
 * sincronización escribía `sku_interno = null` y el stock que capturó
 * (12, 16, 11, 48 pares) nunca llegó a TikTok. Una publicación que NO es
 * externa sale igual que entró.
 */
export function amarreDeExterno(sellerSku: string | null | undefined, amarre: AmarreTikTok, esExterno: boolean): AmarreTikTok {
  if (!esExterno || amarre.skuInterno) return amarre;
  const propio = String(sellerSku ?? "").trim();
  return propio ? { skuInterno: propio, origen: "externo" } : amarre;
}

/**
 * De quién es un pedido según sus renglones: si ALGÚN par es de un
 * vendedor externo, el pedido es suyo (el mixto se va con él). Sin renglones
 * externos, del dueño (null).
 */
export function vendedorDePedido(renglones: { sku: string }[], externos: MapaExternos): string | null {
  for (const r of renglones) {
    const v = externos.get(r.sku);
    if (v) return v;
  }
  return null;
}

/** El vendedor de cada pedido, para repartir los pendientes del corte. */
export function partirPorVendedor(
  renglonesPorPedido: Map<string, { sku: string }[]>,
  externos: MapaExternos,
): Map<string, string | null> {
  const salida = new Map<string, string | null>();
  for (const [orderId, lista] of renglonesPorPedido) salida.set(orderId, vendedorDePedido(lista, externos));
  return salida;
}

/** Los pedidos que le tocan a un vendedor (null = el dueño). Un pedido sin renglones conocidos es del dueño. */
export function pedidosDeVendedor<T extends { orderId: string }>(
  pedidos: T[],
  vendedorDe: Map<string, string | null>,
  vendedor: string | null,
): T[] {
  return pedidos.filter((p) => mismoVendedor(vendedorDe.get(p.orderId) ?? null, vendedor));
}

/** Quita de una lista por SKU lo que es de un vendedor externo. */
export function sinSkusExternos<T extends { sku: string }>(filas: T[], externos: MapaExternos): T[] {
  if (!externos.size) return filas;
  return filas.filter((f) => !externos.has(f.sku));
}

/**
 * Las ventas del DUEÑO: fuera los renglones de los vendedores externos y,
 * en un pedido mixto, el dinero del pedido (lo que TikTok liquidó o va a
 * pagar, el afiliado y el desglose) recortado a la parte de los renglones
 * del dueño, en proporción al precio (sin precios, por pares). Un pedido
 * que solo traía pares externos desaparece completo.
 */
export function sinVentasExternas<O extends OrdenParaVentas, R extends RenglonParaVentas>(
  ordenes: O[],
  renglones: R[],
  externos: MapaExternos,
): { ordenes: O[]; renglones: R[] } {
  if (!externos.size) return { ordenes, renglones };
  const esExterno = (r: R) => Boolean(r.skuInterno && externos.has(r.skuInterno));
  const total = new Map<string, number>();
  const propio = new Map<string, number>();
  const conPrecio = new Map<string, boolean>();
  for (const r of renglones) {
    const peso = r.precio != null ? r.precio * r.cantidad : r.cantidad;
    if (r.precio != null) conPrecio.set(r.orderId, true);
    total.set(r.orderId, (total.get(r.orderId) ?? 0) + peso);
    if (!esExterno(r)) propio.set(r.orderId, (propio.get(r.orderId) ?? 0) + peso);
  }
  // Si el pedido mezcla renglones con y sin precio, el peso por precio es
  // engañoso: se reparte por pares.
  const porPares = new Set<string>();
  for (const r of renglones) if (conPrecio.get(r.orderId) && r.precio == null) porPares.add(r.orderId);
  if (porPares.size) {
    for (const id of porPares) {
      total.set(id, 0);
      propio.set(id, 0);
    }
    for (const r of renglones) {
      if (!porPares.has(r.orderId)) continue;
      total.set(r.orderId, (total.get(r.orderId) ?? 0) + r.cantidad);
      if (!esExterno(r)) propio.set(r.orderId, (propio.get(r.orderId) ?? 0) + r.cantidad);
    }
  }
  const tieneExternos = new Set(renglones.filter(esExterno).map((r) => r.orderId));
  const parte = (id: string): number => {
    const t = total.get(id) ?? 0;
    if (!tieneExternos.has(id)) return 1;
    if (t <= 0) return 0;
    return Math.max(0, Math.min(1, (propio.get(id) ?? 0) / t));
  };
  const escalar = (x: number | null | undefined, f: number): number | null | undefined => (x == null ? x : x * f);
  const salidaOrdenes: O[] = [];
  for (const o of ordenes) {
    const f = parte(o.orderId);
    if (tieneExternos.has(o.orderId) && f === 0) continue;
    if (f === 1) {
      salidaOrdenes.push(o);
      continue;
    }
    const d = (o as any).desglose;
    salidaOrdenes.push({
      ...o,
      netoRecibido: escalar(o.netoRecibido, f),
      pagoEsperado: escalar(o.pagoEsperado, f),
      afiliado: escalar(o.afiliado, f),
      ...(d && typeof d === "object"
        ? { desglose: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "number" ? v * f : v])) }
        : {}),
    });
  }
  return { ordenes: salidaOrdenes, renglones: renglones.filter((r) => !esExterno(r)) };
}

/**
 * Las publicaciones de TikTok agrupadas para la pantalla de ligar: una por
 * product_id con sus SKUs y a quién pertenece hoy.
 */
export interface PublicacionParaLigar {
  productId: string;
  titulo: string;
  estado: string;
  skus: number;
  /** nombres con los que TikTok vende esas variantes (los primeros, para reconocerla) */
  sellerSkus: string[];
  vendedor: string | null;
}

export function agruparPublicaciones(
  skus: { productId: string; sellerSku: string | null; titulo: string | null; estado: string | null }[],
  ligadas: Map<string, string>,
): PublicacionParaLigar[] {
  const porProducto = new Map<string, PublicacionParaLigar>();
  for (const s of skus) {
    if (!s.productId) continue;
    const p = porProducto.get(s.productId) ?? {
      productId: s.productId,
      titulo: s.titulo ?? s.productId,
      estado: s.estado ?? "",
      skus: 0,
      sellerSkus: [],
      vendedor: ligadas.get(s.productId) ?? null,
    };
    p.skus += 1;
    if (!p.titulo || p.titulo === s.productId) p.titulo = s.titulo ?? p.titulo;
    if (s.sellerSku && p.sellerSkus.length < 6 && !p.sellerSkus.includes(s.sellerSku)) p.sellerSkus.push(s.sellerSku);
    porProducto.set(s.productId, p);
  }
  return [...porProducto.values()].sort((a, b) => {
    if (Boolean(a.vendedor) !== Boolean(b.vendedor)) return a.vendedor ? -1 : 1;
    return a.titulo.localeCompare(b.titulo, "es", { numeric: true });
  });
}

/** Buscador de la pantalla: por pedazos en el título, el product_id y los seller_sku. */
export function coincidePublicacion(p: PublicacionParaLigar, busqueda: string): boolean {
  const q = busqueda.trim().toLowerCase();
  if (!q) return true;
  const pajar = `${p.titulo} ${p.productId} ${p.sellerSkus.join(" ")}`.toLowerCase();
  return q.split(/\s+/).every((pedazo) => pajar.includes(pedazo));
}
