/**
 * Lo que la pantalla de TikTok necesita saber, ya cruzado.
 *
 * Va aparte del servicio de sincronización a propósito: aquí NADA escribe.
 * Esta mitad la llama el navegador en cada carga y la otra corre en el cron
 * con service_role; mezclarlas era la forma más fácil de que una lectura
 * acabara moviendo el kardex.
 */
import { traerTodo, type DB } from "../datos/repos";
import { disponibleParaCompradores } from "../tiktok/kardex";
import { skusContados } from "./tiktok";

/** Ventana con la que se mide qué tan rápido se vende cada talla. */
export const DIAS_VENTA = 30;

export interface RenglonTikTok {
  sku: string;
  titulo: string | null;
  saldo: number;
  apartado: number;
  /** saldo - apartado: lo que se le puede ofrecer a un comprador */
  disponible: number;
  /** lo último que TikTok confirmó tener; null si nunca se le escribió */
  publicado: number | null;
  /** true si TikTok trae un número distinto al que le toca */
  desfasado: boolean;
  ventas30: number;
  /** cuántos días aguanta el disponible al ritmo de venta actual */
  diasCobertura: number | null;
  /** true si el kardex quedó en rojo: se vendió algo que no está capturado */
  enRojo: boolean;
  /** tiene publicación en TikTok a la cual escribirle */
  publicable: boolean;
  /** alguna vez se contó (entrada o ajuste); si no, a TikTok no se le escribe */
  contado: boolean;
}

export interface MovimientoPanel {
  id: string;
  sku: string;
  tipo: string;
  cantidad: number;
  motivo: string | null;
  referencia: string | null;
  nota: string | null;
  fecha: string;
}

export interface PendienteTikTok {
  skuId: string;
  sellerSku: string | null;
  titulo: string | null;
  talla: string | null;
}

export interface PanelTikTok {
  conectado: boolean;
  tienda: { nombre: string | null; shopId: string | null; bodega: string | null } | null;
  renglones: RenglonTikTok[];
  totales: {
    skus: number;
    saldo: number;
    apartado: number;
    disponible: number;
    porPublicar: number;
    enRojo: number;
    sinPublicacion: number;
  };
  movimientos: MovimientoPanel[];
  /** SKUs de TikTok que no se pudieron amarrar al catálogo del ERP */
  pendientes: PendienteTikTok[];
  ultimaSync: string | null;
}

export async function cargarPanelTikTok(db: DB, accountId: string): Promise<PanelTikTok> {
  const eq = (q: any) => q.eq("account_id", accountId);
  const desde = new Date(Date.now() - DIAS_VENTA * 86_400_000).toISOString().slice(0, 10);

  const [tiendaRes, inv, skusTikTok, ventas, movsRes, syncRes, contados] = await Promise.all([
    db
      .from("tiktok_tienda")
      .select("nombre, shop_id, warehouse_id, shop_cipher, activo")
      .eq("account_id", accountId)
      .maybeSingle(),
    traerTodo<any>(db, "tiktok_inventario", "sku, saldo, apartado, publicado", eq),
    traerTodo<any>(db, "tiktok_skus", "sku_id, seller_sku, titulo, talla, sku_interno", (q) =>
      eq(q).eq("activo", true),
    ),
    traerTodo<any>(db, "tiktok_ventas_diarias", "sku, unidades", (q) =>
      eq(q).gte("fecha", desde),
    ),
    db
      .from("tiktok_movimientos")
      .select("id, sku, tipo, cantidad, motivo, referencia, nota, fecha")
      .eq("account_id", accountId)
      .order("fecha", { ascending: false })
      .limit(80),
    db
      .from("tiktok_sync_log")
      .select("fin")
      .eq("account_id", accountId)
      .order("inicio", { ascending: false })
      .limit(1)
      .maybeSingle(),
    skusContados(db, accountId),
  ]);

  const tienda = tiendaRes.data ?? null;

  const titulos = new Map<string, string>();
  const conPublicacion = new Set<string>();
  for (const s of skusTikTok ?? []) {
    if (!s.sku_interno) continue;
    conPublicacion.add(s.sku_interno);
    if (s.titulo && !titulos.has(s.sku_interno)) titulos.set(s.sku_interno, s.titulo);
  }

  const ventas30 = new Map<string, number>();
  for (const v of ventas ?? []) {
    ventas30.set(v.sku, (ventas30.get(v.sku) ?? 0) + (v.unidades ?? 0));
  }

  const renglones: RenglonTikTok[] = (inv ?? [])
    .map((r: any): RenglonTikTok => {
      const disponible = disponibleParaCompradores(r.saldo, r.apartado);
      const vendidas = ventas30.get(r.sku) ?? 0;
      const porDia = vendidas / DIAS_VENTA;
      const contado = contados.has(r.sku);
      return {
        contado,
        sku: r.sku,
        titulo: titulos.get(r.sku) ?? null,
        saldo: r.saldo,
        apartado: r.apartado,
        disponible,
        publicado: r.publicado ?? null,
        desfasado: (r.publicado ?? null) !== disponible,
        ventas30: vendidas,
        diasCobertura: porDia > 0 ? disponible / porDia : null,
        enRojo: r.saldo < 0,
        publicable: conPublicacion.has(r.sku) && contado,
      };
    })
    // Lo urgente arriba: primero lo que TikTok todavía no sabe, y dentro de
    // eso lo que más se vende, que es donde un desfase cuesta dinero.
    .sort((a, b) => {
      if (a.desfasado !== b.desfasado) return a.desfasado ? -1 : 1;
      if (b.ventas30 !== a.ventas30) return b.ventas30 - a.ventas30;
      return a.sku.localeCompare(b.sku, "es");
    });

  const pendientes: PendienteTikTok[] = (skusTikTok ?? [])
    .filter((s: any) => !s.sku_interno)
    .map((s: any) => ({
      skuId: s.sku_id,
      sellerSku: s.seller_sku ?? null,
      titulo: s.titulo ?? null,
      talla: s.talla ?? null,
    }));

  return {
    conectado: Boolean(tienda?.activo && tienda?.shop_cipher),
    tienda: tienda
      ? { nombre: tienda.nombre ?? null, shopId: tienda.shop_id ?? null, bodega: tienda.warehouse_id ?? null }
      : null,
    renglones,
    totales: {
      skus: renglones.length,
      saldo: renglones.reduce((a, r) => a + r.saldo, 0),
      apartado: renglones.reduce((a, r) => a + r.apartado, 0),
      disponible: renglones.reduce((a, r) => a + r.disponible, 0),
      porPublicar: renglones.filter((r) => r.desfasado && r.publicable).length,
      enRojo: renglones.filter((r) => r.enRojo).length,
      sinPublicacion: renglones.filter((r) => !r.publicable && r.saldo !== 0).length,
    },
    movimientos: (movsRes.data ?? []) as MovimientoPanel[],
    pendientes,
    ultimaSync: syncRes.data?.fin ?? null,
  };
}
