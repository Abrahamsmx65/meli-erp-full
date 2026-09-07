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
import { sugerirParecidos } from "../tiktok/sugerencias";
import { skusContados } from "./tiktok";
import { paresEnBodegaTikTok } from "./tiktok-bodega";
import { estadoSalidas3pl } from "./tiktok-3pl";

/** Ventana con la que se mide qué tan rápido se vende cada talla. */
export const DIAS_VENTA = 30;

export interface RenglonTikTok {
  sku: string;
  titulo: string | null;
  saldo: number;
  apartado: number;
  /** saldo - apartado: lo que se le puede ofrecer a un comprador */
  disponible: number;
  /** lo que TikTok DICE tener publicado (su catálogo); null si no se sabe */
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
  /** publicaciones de TikTok del mismo modelo y talla, para ligar a mano */
  sugerencias: string[];
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
  /** SKUs del kardex o de MELI del mismo modelo y talla, para ligar a mano */
  sugerencias: string[];
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

  const [tiendaRes, inv, skusTikTok, ventas, movsRes, syncRes, contados, catalogoMeli] = await Promise.all([
    db
      .from("tiktok_tienda")
      .select("nombre, shop_id, warehouse_id, shop_cipher, activo")
      .eq("account_id", accountId)
      .maybeSingle(),
    traerTodo<any>(db, "tiktok_inventario", "sku, saldo, apartado, publicado", eq),
    traerTodo<any>(db, "tiktok_skus", "sku_id, seller_sku, titulo, talla, sku_interno, cantidad_tiktok", (q) =>
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
    traerTodo<any>(db, "skus", "sku", (q) => eq(q).eq("activo", true)),
  ]);

  const tienda = tiendaRes.data ?? null;

  const titulos = new Map<string, string>();
  const conPublicacion = new Set<string>();
  // Lo que TikTok DICE tener por SKU del ERP. Si un SKU está en varias
  // publicaciones, la más baja: es la que primero se agotaría.
  const enTikTok = new Map<string, number>();
  for (const s of skusTikTok ?? []) {
    if (!s.sku_interno) continue;
    conPublicacion.add(s.sku_interno);
    if (s.titulo && !titulos.has(s.sku_interno)) titulos.set(s.sku_interno, s.titulo);
    if (s.cantidad_tiktok != null) {
      const previo = enTikTok.get(s.sku_interno);
      enTikTok.set(s.sku_interno, previo == null ? s.cantidad_tiktok : Math.min(previo, s.cantidad_tiktok));
    }
  }

  // Para sugerir ligas a mano: todas las publicaciones activas por un lado,
  // y el kardex + catálogo de MELI por el otro.
  const sellerSkus = (skusTikTok ?? []).map((x: any) => String(x.seller_sku ?? "")).filter(Boolean);
  const objetivos = [
    ...(inv ?? []).map((x: any) => String(x.sku)),
    ...(catalogoMeli ?? []).map((x: any) => String(x.sku)),
  ];

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
        publicado: enTikTok.get(r.sku) ?? null,
        desfasado: (enTikTok.get(r.sku) ?? null) !== disponible,
        ventas30: vendidas,
        diasCobertura: porDia > 0 ? disponible / porDia : null,
        enRojo: r.saldo < 0,
        publicable: conPublicacion.has(r.sku) && contado,
        sugerencias: conPublicacion.has(r.sku) ? [] : sugerirParecidos(r.sku, sellerSkus),
      };
    })
    // Un renglón muerto —sin saldo, sin apartado, sin venta, sin publicación
    // ligada y sin rojo— es un nombre viejo (un SKU que la bodega renombró,
    // un duplicado ya fusionado). Enseñarlo solo estorba, y sus sugerencias
    // invitan a ligar publicaciones vivas a un renglón vacío.
    .filter((r: RenglonTikTok) => r.saldo !== 0 || r.apartado !== 0 || r.ventas30 !== 0 || r.publicable || r.enRojo)
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
      sugerencias: s.seller_sku ? sugerirParecidos(String(s.seller_sku), objetivos) : [],
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


// ---------------------------------------------------------------------------
// Desfases: dónde TikTok, el kardex y el 3PL no dicen lo mismo, y por qué
// ---------------------------------------------------------------------------

export interface Desfase {
  sku: string;
  /** kardex */
  saldo: number;
  apartado: number;
  disponible: number;
  contado: boolean;
  /** lo que TikTok dice tener; null si no hay publicación */
  enTikTok: number | null;
  /** lo que Industher reporta en la bodega TikTok; null si no la reporta */
  en3pl: number | null;
  /** salidas que el 3PL todavía no confirma */
  salidasPendientes3pl: number;
  razones: string[];
}

export interface PanelDesfases {
  bodega3pl: string | null;
  desfases: Desfase[];
  revisados: number;
}

export async function cargarDesfases(db: DB, accountId: string): Promise<PanelDesfases> {
  const eq = (q: any) => q.eq("account_id", accountId);
  const [inv, skusTikTok, contados, bodega, salidas] = await Promise.all([
    traerTodo<any>(db, "tiktok_inventario", "sku, saldo, apartado", eq),
    traerTodo<any>(db, "tiktok_skus", "sku_interno, cantidad_tiktok, estado", (q) => eq(q).eq("activo", true)),
    skusContados(db, accountId),
    paresEnBodegaTikTok(db, accountId),
    estadoSalidas3pl(db, accountId),
  ]);

  const enTikTok = new Map<string, number>();
  for (const s of skusTikTok ?? []) {
    if (!s.sku_interno || s.cantidad_tiktok == null || s.estado !== "ACTIVATE") continue;
    const previo = enTikTok.get(s.sku_interno);
    enTikTok.set(s.sku_interno, previo == null ? s.cantidad_tiktok : Math.min(previo, s.cantidad_tiktok));
  }

  const kardex = new Map<string, { saldo: number; apartado: number }>();
  for (const r of inv ?? []) kardex.set(r.sku, { saldo: r.saldo, apartado: r.apartado });

  const todos = new Set<string>([...kardex.keys(), ...bodega.pares.keys(), ...enTikTok.keys()]);
  const desfases: Desfase[] = [];

  for (const sku of todos) {
    const k = kardex.get(sku) ?? { saldo: 0, apartado: 0 };
    const disponible = disponibleParaCompradores(k.saldo, k.apartado);
    const contado = contados.has(sku);
    const tt = enTikTok.has(sku) ? (enTikTok.get(sku) as number) : null;
    const tresPl = bodega.almacen ? (bodega.pares.get(sku) ?? 0) : null;
    const pend = salidas.pendientes.get(sku) ?? 0;
    const razones: string[] = [];

    if (k.saldo < 0) razones.push("Kardex en negativo: se vendió sin entrada");
    if (tt !== null && contado && tt !== disponible) {
      razones.push(`TikTok dice ${tt} y le toca ${disponible} (se corrige al publicar)`);
    }
    if (tt !== null && !contado && (k.saldo !== 0 || k.apartado !== 0)) {
      razones.push("Sin conteo inicial: TikTok se queda con su número");
    }
    if (tresPl !== null && enTikTok.has(sku)) {
      // El 3PL debe traer el físico: saldo del kardex + lo que le falta descontar.
      const esperado = k.saldo + pend;
      if (tresPl !== esperado) razones.push(`Industher reporta ${tresPl}; por kardex debería ser ${esperado}`);
    }
    if (pend > 0) razones.push(`${pend} pares de salidas sin confirmar en el 3PL`);

    if (razones.length) {
      desfases.push({ sku, saldo: k.saldo, apartado: k.apartado, disponible, contado, enTikTok: tt, en3pl: tresPl, salidasPendientes3pl: pend, razones });
    }
  }

  desfases.sort((a, b) => b.razones.length - a.razones.length || a.sku.localeCompare(b.sku, "es"));
  return { bodega3pl: bodega.almacen, desfases, revisados: todos.size };
}
