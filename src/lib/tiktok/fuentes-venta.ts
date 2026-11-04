/**
 * Por dónde se vendió en TikTok Shop: LIVE, video, tarjeta de producto,
 * buscador y pestaña Tienda. Motor puro (sin red ni base).
 *
 * El dato lo da la ANALÍTICA de TikTok (`GET /analytics/202609/shop/
 * performance` con granularidad 1D): por día, el GMV total y el GMV por
 * fuente, y cada fuente partida entre lo del VENDEDOR (nuestros lives,
 * nuestros videos, la tarjeta de producto de la tienda) y lo de CREADORES
 * (sus lives, sus videos, su vitrina). Es el número de TikTok tal cual: el
 * ERP no reparte ni estima nada; lo que TikTok no clasifica queda en
 * «otros» para que la suma cierre con el GMV del día.
 *
 * Pedido del dueño (4-nov-2026): «saber cuánto fue por live, cuánto por video
 * y cuánto de tarjetas de producto».
 */

export interface PorCanal {
  live: number;
  video: number;
  tarjeta: number;
}

export interface FuentesDia {
  /** YYYY-MM-DD en la zona de la tienda (México) */
  fecha: string;
  gmv: number;
  live: number;
  video: number;
  tarjeta: number;
  /**
   * Parte de la tarjeta de producto NUESTRA que llegó por el buscador de
   * TikTok Shop (verificado el 3-nov-2026: `seller_product_card_gmv` =
   * `search_attributed` + `shop_tab_attributed` + `others`; no es una fuente
   * aparte de la tarjeta).
   */
  buscador: number;
  /** parte de la tarjeta de producto nuestra que llegó por la pestaña Tienda */
  pestanaTienda: number;
  /** lo que TikTok no clasifica: GMV − (live + video + tarjeta) */
  otros: number;
  /** nuestros lives, nuestros videos y la tarjeta de producto de la tienda */
  vendedor: PorCanal;
  /** lives, videos y vitrina de los creadores */
  creadores: PorCanal;
  pedidos: number;
  piezas: number;
  /** las cifras de venta del día como las trajo TikTok (número por campo) */
  crudo: Record<string, number>;
}

function monto(x: unknown): number {
  if (x == null) return 0;
  const n = typeof x === "object" ? Number((x as { amount?: unknown }).amount) : Number(x);
  return Number.isFinite(n) ? n : 0;
}

function redondea(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * La respuesta cruda del endpoint → un renglón por intervalo (día). Un
 * intervalo sin fecha de inicio se ignora. Las cantidades que TikTok no
 * manda cuentan como cero.
 */
export function interpretarFuentes(crudo: unknown): FuentesDia[] {
  const intervalos = (crudo as any)?.performance?.intervals ?? (crudo as any)?.data?.performance?.intervals;
  if (!Array.isArray(intervalos)) return [];
  const dias: FuentesDia[] = [];
  for (const it of intervalos) {
    const fecha = String(it?.start_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
    const s = it?.sales ?? {};
    const b = it?.breakdowns ?? {};
    const crudoDia: Record<string, number> = {};
    for (const [k, v] of Object.entries(s)) {
      if (v == null) continue;
      if (typeof v === "object" && "amount" in (v as object)) crudoDia[k] = monto(v);
      else if (typeof v === "number") crudoDia[k] = v;
      else if (typeof v === "string" && Number.isFinite(Number(v))) crudoDia[k] = Number(v);
    }
    const gmv = monto(s.gmv);
    const live = monto(s.live_gmv);
    const video = monto(s.video_gmv);
    const tarjeta = monto(s.product_card_attributed_gmv);
    const buscador = monto(b.shop_tab_and_search?.search_attributed);
    const pestanaTienda = monto(b.shop_tab_and_search?.shop_tab_attributed);
    const otros = redondea(gmv - live - video - tarjeta);
    dias.push({
      fecha,
      gmv,
      live,
      video,
      tarjeta,
      buscador,
      pestanaTienda,
      otros: otros > 0 ? otros : 0,
      vendedor: {
        live: monto(s.seller_live_gmv),
        video: monto(s.seller_video_gmv),
        tarjeta: monto(b.seller_product_card_gmv),
      },
      creadores: {
        live: monto(s.creator_live_gmv),
        video: monto(s.creator_video_gmv),
        tarjeta: monto(b.affiliate_product_card_attributed_gmv),
      },
      pedidos: Number(s.orders_count ?? 0) || 0,
      piezas: Number(s.items_sold ?? 0) || 0,
      crudo: crudoDia,
    });
  }
  return dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export type ClaveFuente = "live" | "video" | "tarjeta" | "otros";

export interface BloqueFuente {
  clave: ClaveFuente;
  nombre: string;
  monto: number;
  /** % del GMV del rango (0–100) */
  porcentaje: number;
}

export interface ResumenFuentes {
  gmv: number;
  pedidos: number;
  piezas: number;
  /** en el orden en que se enseñan; solo las que tienen monto */
  fuentes: BloqueFuente[];
  vendedor: PorCanal;
  creadores: PorCanal;
  /** de la tarjeta de producto nuestra, lo que llegó por el buscador y por la pestaña Tienda */
  tarjetaNuestra: { buscador: number; pestanaTienda: number };
  /** días con dato dentro del rango */
  dias: number;
  /** primer y último día con dato */
  desde: string | null;
  hasta: string | null;
}

export const NOMBRE_FUENTE: Record<ClaveFuente, string> = {
  live: "LIVE",
  video: "Video",
  tarjeta: "Tarjeta de producto",
  otros: "Otros",
};

const ORDEN_FUENTES: ClaveFuente[] = ["live", "video", "tarjeta", "otros"];

/** Suma los días (ya acotados al rango) y saca el % de cada fuente sobre el GMV. */
export function sumarFuentes(dias: FuentesDia[]): ResumenFuentes {
  const r: ResumenFuentes = {
    gmv: 0,
    pedidos: 0,
    piezas: 0,
    fuentes: [],
    vendedor: { live: 0, video: 0, tarjeta: 0 },
    creadores: { live: 0, video: 0, tarjeta: 0 },
    tarjetaNuestra: { buscador: 0, pestanaTienda: 0 },
    dias: 0,
    desde: null,
    hasta: null,
  };
  const acum: Record<ClaveFuente, number> = { live: 0, video: 0, tarjeta: 0, otros: 0 };
  for (const d of dias) {
    r.gmv += d.gmv;
    r.pedidos += d.pedidos;
    r.piezas += d.piezas;
    acum.live += d.live;
    acum.video += d.video;
    acum.tarjeta += d.tarjeta;
    // «Otros» se recalcula aquí y no se toma del renglón guardado: los días
    // leídos antes del 3-nov-2026 lo traían restando también buscador y
    // pestaña, que son parte de la tarjeta.
    acum.otros += Math.max(0, d.gmv - d.live - d.video - d.tarjeta);
    r.tarjetaNuestra.buscador += d.buscador;
    r.tarjetaNuestra.pestanaTienda += d.pestanaTienda;
    for (const k of ["live", "video", "tarjeta"] as const) {
      r.vendedor[k] += d.vendedor[k];
      r.creadores[k] += d.creadores[k];
    }
    r.dias++;
    if (!r.desde || d.fecha < r.desde) r.desde = d.fecha;
    if (!r.hasta || d.fecha > r.hasta) r.hasta = d.fecha;
  }
  r.fuentes = ORDEN_FUENTES.filter((k) => acum[k] > 0).map((k) => ({
    clave: k,
    nombre: NOMBRE_FUENTE[k],
    monto: redondea(acum[k]),
    porcentaje: r.gmv > 0 ? (acum[k] / r.gmv) * 100 : 0,
  }));
  r.gmv = redondea(r.gmv);
  return r;
}

/**
 * Qué fechas (YYYY-MM-DD, zona de la tienda) hay que pedirle a TikTok en una
 * corrida: siempre los últimos `recientes` días hasta hoy (lo de hoy y ayer
 * cambia durante el día) y, hacia atrás, el tramo que sigue a lo más viejo
 * que ya está guardado, hasta `fondo`. Cada ventana va [desde, hasta) con
 * `hasta` exclusivo, como pide el endpoint.
 */
export function ventanasPorLeer(
  hoy: string,
  guardadas: string[],
  opciones: { recientes?: number; fondo: string; diasPorTramo?: number; tramos?: number },
): { desde: string; hasta: string; esFondo: boolean }[] {
  const recientes = opciones.recientes ?? 4;
  const diasPorTramo = opciones.diasPorTramo ?? 30;
  const tramos = opciones.tramos ?? 3;
  const corre = (iso: string, dias: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
  const salida: { desde: string; hasta: string; esFondo: boolean }[] = [];
  const desdeReciente = corre(hoy, -(recientes - 1));
  salida.push({ desde: desdeReciente < opciones.fondo ? opciones.fondo : desdeReciente, hasta: corre(hoy, 1), esFondo: false });
  // Lo más viejo guardado marca hasta dónde ya hay historia; sin nada, la
  // historia empieza en la ventana reciente.
  let limite = guardadas.length ? guardadas.reduce((a, b) => (a < b ? a : b)) : desdeReciente;
  if (limite > desdeReciente) limite = desdeReciente;
  for (let i = 0; i < tramos && limite > opciones.fondo; i++) {
    const desde = corre(limite, -diasPorTramo);
    salida.push({ desde: desde < opciones.fondo ? opciones.fondo : desde, hasta: limite, esFondo: true });
    limite = desde;
  }
  return salida;
}
