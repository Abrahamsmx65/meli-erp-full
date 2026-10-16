/**
 * Panel de publicidad (Product Ads) de Mercado Libre.
 *
 * Junta dos mundos por MODELO (el "parent": MY2307, GT128…): lo que se vendió
 * en el periodo — mismas cuentas que el monitor de ventas: unidades, importe y
 * ganancia con el neto real de Mercado Pago — y lo que se gastó en Product
 * Ads según el API de publicidad de MELI. De ahí salen las preguntas que
 * importan: cuánto cuesta la publicidad por unidad vendida, qué fracción de
 * la venta se va en ads (TACOS) y cuánta ganancia queda después de pagarlos.
 *
 * Los anuncios de MELI son por PUBLICACIÓN (item), no por SKU: el amarre a
 * modelo va por el item_id del catálogo ya sincronizado (tabla `skus`). Un
 * item con variantes (tallas) amarra a un solo modelo, así que la suma no se
 * duplica. Lo que no amarra se reporta aparte, nunca se tira en silencio.
 */
import { MeliError, type MeliClient } from "../meli/client";
import { rpcPaginado, traerTodo, type DB } from "../datos/repos";
import { servirConCacheApp } from "./cache-app";
import { clienteAdmin } from "../supabase/server";
import { configPorProducto } from "./productos";
import { cargarInventario } from "./inventario";
import { clienteDeCuenta } from "./webhooks";
import { diasDeRango, fechaMx, netoConfirmadoDeFila, normalizarRango, type RangoFechas } from "./ventas-monitor";
import {
  esErrorColumnaLegacy,
  esErrorObjetoLegacy,
  mensajeErrorDatos,
} from "./errores-datos";

export interface FilaPublicidad {
  modelo: string;
  /** publicaciones del modelo con anuncio en el periodo */
  anuncios: number;
  /** unidades vendidas del periodo (TODAS las ventas, no solo por ads) */
  unidades: number;
  /** venta bruta del periodo */
  importe: number;
  /** neto de MELI − costo de producto; null = sin costo capturado */
  ganancia: number | null;
  /** gasto en Product Ads del periodo */
  gastoAds: number;
  /** venta que MELI atribuye a la publicidad */
  ventaAds: number;
  /** unidades que MELI atribuye a la publicidad */
  unidadesAds: number;
  clicks: number;
  impresiones: number;
  /** gastoAds / unidades vendidas; null = sin ventas en el periodo */
  costoPorUnidad: number | null;
  /** gastoAds / importe (TACOS: ads sobre la venta TOTAL); null = sin venta */
  tacos: number | null;
  /** ganancia − gastoAds; null = sin costo capturado */
  gananciaNeta: number | null;
}

export interface Publicidad {
  filas: FilaPublicidad[];
  /** qué hacer hoy con cada modelo, para ejecutarlo a mano en MELI */
  recomendaciones: RecomendacionAds[];
  /**
   * TODAS las campañas con gasto, por modelo: cuánto de lo que vende viene
   * de la publicidad (`armarDependencias`). Opcional: los paneles guardados
   * antes del 16-oct-2026 no la traen.
   */
  dependencias?: DependenciaAds[];
  totales: {
    gastoAds: number;
    ventaAds: number;
    unidadesAds: number;
    unidades: number;
    importe: number;
    /** solo de los modelos con costo capturado */
    ganancia: number;
    /** fracción de las unidades del periodo con costo capturado (0-1) */
    coberturaCosto: number;
    costoPorUnidad: number | null;
    tacos: number | null;
    /** gasto / venta por ads (el ACOS clásico); null = sin venta por ads */
    acos: number | null;
  };
  /** anuncios cuyo item no se pudo amarrar a un modelo del catálogo */
  sinAmarre: { gasto: number; anuncios: number };
  /** por qué no hay datos de ads (sin permiso, sin advertiser…); null = todo bien */
  errorAds: string | null;
  /** fuentes auxiliares que fallaron sin invalidar ventas ni gasto de ads */
  advertencias: string[];
  /** las métricas están completas, pero no se pudo cruzar stock para recomendar */
  errorRecomendaciones: string | null;
}

/** Un anuncio de Product Ads ya reducido a lo que este panel usa. */
export interface AnuncioAds {
  itemId: string;
  gasto: number;
  clicks: number;
  impresiones: number;
  unidadesAds: number;
  ventaAds: number;
  /** active | paused | idle…, tal cual lo reporta MELI; null = no vino */
  estado: string | null;
  campanaId: string | null;
  titulo: string | null;
}

/** Una campaña de Product Ads, con lo que el panel edita. */
export interface CampanaAds {
  id: string;
  nombre: string;
  estado: string | null;
  /** presupuesto diario en MXN; null = no vino */
  presupuesto: number | null;
  /** ACOS objetivo en % (así lo maneja MELI); null = automática o no vino */
  acosObjetivo: number | null;
  /**
   * ROAS objetivo (venta por publicidad ÷ inversión): el que MELI enseña en
   * la consola. Viene como `roas_target` o se saca del ACOS (100 ÷ ACOS).
   */
  roasObjetivo: number | null;
  estrategia: string | null;
  /** gasto del periodo de los anuncios de esta campaña */
  gasto: number;
  anuncios: number;
}

/** Un anuncio de un modelo, con su estado, para los botones del panel. */
export interface ItemDeModelo {
  itemId: string;
  titulo: string | null;
  estado: string | null;
  campanaId: string | null;
  /** compartido entre varios modelos (el gasto se reparte) */
  compartido: boolean;
}

export type AccionSugerida =
  | "pausar"
  | "encender"
  | "apagar"
  | "bajar"
  | "subir"
  | "activar";

/**
 * Una línea de la lista de recomendaciones: qué modelo, qué hacer y por qué,
 * para ejecutarlo a mano en la consola de Product Ads. El API de MELI no
 * deja escribir publicidad (niega la escritura aunque el token traiga el
 * permiso), así que el ERP recomienda y el clic va en Mercado Libre.
 */
export interface RecomendacionAds {
  modelo: string;
  accion: AccionSugerida;
  /** qué hacer, en una frase corta e imperativa */
  queHacer: string;
  /** por qué, con los números que lo sostienen */
  razon: string;
}

interface VentaDiaria {
  sku: string;
  fecha: string;
  unidades: number | null;
  importe: number | null;
  comision: number | null;
  neto: number | null;
}

// ---------------------------------------------------------------------------
// Product Ads API
// ---------------------------------------------------------------------------

/**
 * Métricas que se le piden a MELI por anuncio. `cost` es el gasto; las
 * `*_quantity`/`*_amount` son la venta que MELI atribuye a la publicidad
 * (directa + asistida).
 */
const METRICAS_ADS =
  "clicks,prints,cost,units_quantity,total_amount";

interface RespuestaAdvertisers {
  advertisers?: { advertiser_id: number | string; site_id?: string }[];
}

interface RespuestaAds {
  results?: {
    item_id?: string;
    id?: string;
    title?: string;
    status?: string;
    campaign_id?: number | string;
    metrics?: Record<string, number | null>;
  }[];
  paging?: { total?: number; offset?: number; limit?: number };
}

interface RespuestaCampanas {
  results?: {
    id?: number | string;
    name?: string;
    status?: string;
    budget?: number;
    acos_target?: number;
    roas_target?: number;
    strategy?: string;
  }[];
  paging?: { total?: number; offset?: number; limit?: number };
}

export interface Advertiser {
  advertiserId: string;
  siteId: string;
}

/** El advertiser de Product Ads de la cuenta (Api-Version 1). */
export async function resolverAdvertiser(
  cliente: MeliClient,
  siteId: string,
): Promise<Advertiser> {
  const adv = await cliente.get<RespuestaAdvertisers>(
    "/advertising/advertisers",
    { product_id: "PADS" },
    { headers: { "Api-Version": "1" }, reintentos: 2 },
  );
  const lista = adv.advertisers ?? [];
  const advertiser =
    lista.find((a) => (a.site_id ?? "") === siteId) ?? lista[0];
  if (!advertiser) {
    throw new MeliError(
      "La cuenta no tiene advertiser de Product Ads (¿nunca ha hecho campañas?).",
      404,
      adv,
      "/advertising/advertisers",
    );
  }
  return {
    advertiserId: String(advertiser.advertiser_id),
    siteId: advertiser.site_id ?? siteId,
  };
}

/**
 * Pide con la primera ruta que responda: la forma vigente lleva el sitio en
 * medio (advertising/MLM/advertisers/…) y la vieja queda de respaldo. El
 * mismo truco para GET y PUT: MELI ya nos cambió la ruta una vez.
 */
async function conRutas<T>(
  rutas: string[],
  pedir: (ruta: string) => Promise<T>,
): Promise<T> {
  let ultimo404: MeliError | null = null;
  for (const ruta of rutas) {
    try {
      return await pedir(ruta);
    } catch (err) {
      if (err instanceof MeliError && err.status === 404) {
        ultimo404 = err;
        continue;
      }
      throw err;
    }
  }
  throw ultimo404 ?? new MeliError("Sin ruta que responda.", 404, null, rutas[0]);
}

/**
 * Baja todos los anuncios del periodo con sus métricas, estado y campaña,
 * paginados (Api-Version 2). Los errores NO se tragan: el panel muestra el
 * motivo tal cual (el más común va a ser que a la app le falte el permiso de
 * Product Ads y haya que reconectar MELI).
 */
export async function traerAnunciosAds(
  cliente: MeliClient,
  adv: Advertiser,
  rango: RangoFechas,
): Promise<AnuncioAds[]> {
  const rutas = [
    `/advertising/${adv.siteId}/advertisers/${adv.advertiserId}/product_ads/ads/search`,
    `/advertising/advertisers/${adv.advertiserId}/product_ads/ads/search`,
  ];

  const anuncios: AnuncioAds[] = [];
  const limite = 50; // el máximo que acepta el API
  // Tope duro: 400 páginas son 20 mil anuncios, muy por encima del catálogo.
  const MAX_PAGINAS = 400;

  for (let numPagina = 0; numPagina < MAX_PAGINAS; numPagina++) {
    const pos = numPagina * limite;
    const pagina = await conRutas(rutas, (ruta) =>
      cliente.get<RespuestaAds>(
        ruta,
        {
          limit: limite,
          offset: pos,
          date_from: rango.desde,
          date_to: rango.hasta,
          metrics: METRICAS_ADS,
        },
        { headers: { "Api-Version": "2" }, reintentos: 2 },
      ),
    );

    const filas = pagina.results ?? [];
    for (const f of filas) {
      const itemId = String(f.item_id ?? f.id ?? "");
      if (!itemId) continue;
      const m = f.metrics ?? {};
      anuncios.push({
        itemId,
        gasto: Number(m.cost ?? 0) || 0,
        clicks: Number(m.clicks ?? 0) || 0,
        impresiones: Number(m.prints ?? 0) || 0,
        unidadesAds: Number(m.units_quantity ?? 0) || 0,
        ventaAds: Number(m.total_amount ?? 0) || 0,
        estado: f.status ?? null,
        campanaId: f.campaign_id != null ? String(f.campaign_id) : null,
        titulo: f.title ?? null,
      });
    }

    // Se sigue mientras la página venga LLENA. Antes se confiaba en
    // `paging.total`, y cuando MELI no lo manda (o lo manda en cero) la
    // lectura se cortaba en los primeros 50 anuncios y el panel enseñaba
    // una fracción del gasto sin avisar de nada.
    if (filas.length < limite) break;
  }

  return anuncios;
}

/**
 * Los anuncios del rango LEÍDOS DE LA BASE (`publicidad_diaria`, sumados por
 * `publicidad_resumen_items`), en vez de pedírselos a MELI en cada render.
 *
 * Devuelve null cuando la base no puede contestar COMPLETO y hay que caer al
 * API en vivo: la sincronización aún no cubre el rango pedido, el rango
 * termina hoy pero la última corrida ya está vieja (el gasto de hoy sigue
 * creciendo), o las tablas/función no existen todavía. Nunca se contesta con
 * datos a medias.
 */
export async function anunciosDesdeBase(
  db: DB,
  accountId: string,
  r: RangoFechas,
): Promise<AnuncioAds[] | null> {
  const { data: est, error } = await db
    .from("publicidad_sync")
    .select("desde, hasta, actualizado_en")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) {
    if (esErrorObjetoLegacy(error, ["publicidad_sync"])) return null;
    throw new Error(`publicidad_sync: ${mensajeErrorDatos(error)}`);
  }
  if (!est) return null;
  if (est.desde > r.desde || est.hasta < r.hasta) return null;

  // El rango incluye HOY: solo sirve si la sincronización corrió hace poco
  // (el latido la corre cada hora); si no, en vivo como siempre.
  const edadMs = Date.now() - Date.parse(est.actualizado_en ?? 0);
  if (r.hasta >= fechaMx(0) && !(edadMs < 2 * 3_600_000)) return null;

  // Por páginas: ~1,200 publicaciones con gasto y el API entrega 1,000.
  const { data, error: errorRpc } = await rpcPaginado(db, "publicidad_resumen_items", {
    p_account: accountId,
    p_desde: r.desde,
    p_hasta: r.hasta,
  });
  if (errorRpc) {
    if (esErrorObjetoLegacy(errorRpc, ["publicidad_resumen_items"])) return null;
    throw new Error(`publicidad_resumen_items: ${mensajeErrorDatos(errorRpc)}`);
  }

  return ((data ?? []) as any[]).map((f) => ({
    itemId: String(f.item_id),
    gasto: Number(f.gasto) || 0,
    clicks: Number(f.clicks) || 0,
    impresiones: Number(f.impresiones) || 0,
    unidadesAds: Number(f.unidades_ads) || 0,
    ventaAds: Number(f.venta_ads) || 0,
    estado: f.estado ?? null,
    campanaId: f.campana_id ?? null,
    titulo: f.titulo ?? null,
  }));
}

/** Las campañas de Product Ads con su presupuesto y ACOS objetivo. */
export async function traerCampanasAds(
  cliente: MeliClient,
  adv: Advertiser,
): Promise<Omit<CampanaAds, "gasto" | "anuncios">[]> {
  const rutas = [
    `/advertising/${adv.siteId}/advertisers/${adv.advertiserId}/product_ads/campaigns/search`,
    `/advertising/advertisers/${adv.advertiserId}/product_ads/campaigns/search`,
  ];

  const campanas: Omit<CampanaAds, "gasto" | "anuncios">[] = [];
  const limite = 50;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const pos = offset;
    const pagina = await conRutas(rutas, (ruta) =>
      cliente.get<RespuestaCampanas>(
        ruta,
        { limit: limite, offset: pos },
        { headers: { "Api-Version": "2" }, reintentos: 2 },
      ),
    );
    const filas = pagina.results ?? [];
    for (const c of filas) {
      if (c.id == null) continue;
      campanas.push({
        id: String(c.id),
        nombre: c.name ?? `Campaña ${c.id}`,
        estado: c.status ?? null,
        presupuesto: c.budget != null ? Number(c.budget) : null,
        acosObjetivo: c.acos_target != null ? Number(c.acos_target) : null,
        roasObjetivo: roasDeCampana(c.roas_target, c.acos_target),
        estrategia: c.strategy ?? null,
      });
    }
    total = pagina.paging?.total ?? offset + filas.length;
    offset += limite;
    if (!filas.length) break;
  }

  return campanas;
}


// ---------------------------------------------------------------------------
// Recomendaciones (puro, para poder probarlo sin red)
// ---------------------------------------------------------------------------

/** Debajo de esto, la publicidad solo acelera el quiebre de stock. */
export const COBERTURA_CORTA_DIAS = 14;
/** Arriba de esto hay capital parado: espacio para invertir en ads. */
export const COBERTURA_LARGA_DIAS = 45;

/**
 * TACOS ideal = tope: la publicidad nunca debe pasar del 10 % de la venta
 * total del modelo (regla del dueño, 14-oct-2026: «el TACOS ideal que
 * tenemos es 10 %, no hay que gastar más que eso»). Arriba se pide bajar
 * aunque el margen aguante; subir solo llega hasta ahí.
 */
export const TACOS_TOPE = 0.1;

/**
 * Producto POSICIONADO (regla del dueño, 16-oct-2026): vende al menos
 * `POSICIONADO_RITMO_MIN` al día hoy Y en los 60 días anteriores, su venta no
 * cayó de 0.8× ni brincó arriba de 1.5× (un lanzamiento que despega no es
 * estable), y a lo más la mitad de lo que vende lo atribuye MELI a la
 * publicidad. Medido el 16-oct-2026 en calzado: MY2307, GT114, GT142, GT134,
 * GT110 y GT135 quedaban entre 27 % y 50 %; los demás modelos con anuncio,
 * entre 70 % y 120 %.
 */
export const POSICIONADO_RITMO_MIN = 10;
export const POSICIONADO_PARTE_ADS_MAX = 0.5;
export const POSICIONADO_CAMBIO_MIN = 0.8;
export const POSICIONADO_CAMBIO_MAX = 1.5;

export function esPosicionado(ritmo: number, ritmoPrevio: number, parteAds: number): boolean {
  if (ritmo < POSICIONADO_RITMO_MIN || ritmoPrevio < POSICIONADO_RITMO_MIN) return false;
  const cambio = ritmo / ritmoPrevio;
  return cambio >= POSICIONADO_CAMBIO_MIN && cambio <= POSICIONADO_CAMBIO_MAX && parteAds <= POSICIONADO_PARTE_ADS_MAX;
}

/**
 * El anuncio está corriendo. MELI marca «paused» lo que el dueño pausó,
 * «hold» lo que MELI detiene sola (publicación sin stock o pausada) e
 * «idle» lo que está en la campaña sin usarse: ninguno de los tres gasta, y
 * pedir «pausar» sobre ellos es pedir lo ya hecho (GT181, 16-oct-2026:
 * «me pones que apague la publicidad pero ya está pausado»).
 */
export const anuncioCorriendo = (estado: string | null): boolean => estado == null || estado === "active";

/** Subir o bajar menos de esto al día no se pide: es ruido en la lista. */
export const GASTO_DIA_MINIMO = 10;

/**
 * Presupuesto diario que HOY tiene cada modelo en MELI: la suma de sus
 * campañas activas con algún anuncio suyo prendido. Una campaña con varios
 * modelos se reparte en partes iguales. Puro.
 */
export function presupuestoPorModelo(
  campanas: { id: string; estado: string | null; presupuesto: number | null }[],
  itemsDeModelo: Map<string, ItemDeModelo[]>,
): Map<string, number> {
  const activas = new Map(
    campanas.filter((c) => c.presupuesto != null && c.estado !== "paused").map((c) => [c.id, c.presupuesto as number]),
  );
  const modelosDeCampana = new Map<string, Set<string>>();
  for (const [modelo, items] of itemsDeModelo) {
    for (const it of items) {
      if (!it.campanaId || !anuncioCorriendo(it.estado) || !activas.has(it.campanaId)) continue;
      const set = modelosDeCampana.get(it.campanaId) ?? new Set<string>();
      set.add(modelo);
      modelosDeCampana.set(it.campanaId, set);
    }
  }
  const salida = new Map<string, number>();
  for (const [campana, modelos] of modelosDeCampana) {
    const parte = (activas.get(campana) ?? 0) / modelos.size;
    for (const m of modelos) salida.set(m, (salida.get(m) ?? 0) + parte);
  }
  return salida;
}

export type ClaseDependencia =
  | "posicionado"
  | "depende"
  | "en_medio"
  | "creciendo"
  | "cayendo"
  | "sin_venta";

export const NOMBRE_CLASE_DEPENDENCIA: Record<ClaseDependencia, string> = {
  posicionado: "Posicionado: se vende solo",
  depende: "Depende de la publicidad",
  en_medio: "En medio",
  creciendo: "Creciendo",
  cayendo: "Cayendo",
  sin_venta: "Gasta sin vender",
};

/** Arriba de esta parte de las ventas por publicidad, el modelo DEPENDE de ella. */
export const DEPENDE_PARTE_ADS_MIN = 0.7;

/**
 * Un modelo con anuncio y qué tanto depende de la publicidad (pedido del
 * dueño, 16-oct-2026: «hazme de todas las campañas que tengo de qué
 * dependo»).
 */
export interface DependenciaAds {
  modelo: string;
  /** nombres de las campañas donde está anunciado */
  campanas: string[];
  /** unidades al día en el periodo */
  ritmo: number;
  /** unidades al día en los 60 días anteriores; null = sin dato */
  ritmoPrevio: number | null;
  /** unidades que MELI atribuye a la publicidad ÷ unidades vendidas; null = sin venta */
  parteAds: number | null;
  /** gasto en ads al día del periodo */
  gastoDia: number;
  /** presupuesto diario de HOY de sus campañas; null = sin dato */
  presupuestoHoy: number | null;
  /** ROAS objetivo de HOY de sus campañas; null = sin dato o automática */
  roasObjetivo?: number | null;
  /** venta por publicidad ÷ gasto del periodo; null = sin venta por ads */
  roasReal?: number | null;
  tacos: number | null;
  clase: ClaseDependencia;
}

/** La clase de dependencia de un modelo. Puro. */
export function clasificarDependencia(
  ritmo: number,
  ritmoPrevio: number | null,
  parteAds: number | null,
): ClaseDependencia {
  if (parteAds == null || ritmo === 0) return "sin_venta";
  if (ritmoPrevio != null && esPosicionado(ritmo, ritmoPrevio, parteAds)) return "posicionado";
  const cambio = ritmoPrevio != null && ritmoPrevio > 0 ? ritmo / ritmoPrevio : null;
  if (cambio == null || cambio > POSICIONADO_CAMBIO_MAX) return "creciendo";
  if (cambio < POSICIONADO_CAMBIO_MIN) return "cayendo";
  if (parteAds >= DEPENDE_PARTE_ADS_MIN) return "depende";
  return "en_medio";
}

/**
 * La lista completa: cada modelo con gasto en el periodo, ordenado por gasto.
 * Puro.
 */
export function armarDependencias(opts: {
  filas: FilaPublicidad[];
  dias: number;
  itemsDeModelo: Map<string, ItemDeModelo[]>;
  /** campaña -> nombre */
  nombresCampana?: Map<string, string>;
  presupuestoDeModelo?: Map<string, number>;
  ritmoPrevioDeModelo?: Map<string, number>;
  roasObjetivoDeModelo?: Map<string, number>;
}): DependenciaAds[] {
  const dias = opts.dias > 0 ? opts.dias : 1;
  const salida: DependenciaAds[] = [];
  for (const f of opts.filas) {
    if (f.gastoAds <= 0) continue;
    const ritmo = f.unidades / dias;
    const ritmoPrevio = opts.ritmoPrevioDeModelo ? (opts.ritmoPrevioDeModelo.get(f.modelo) ?? 0) : null;
    const parteAds = f.unidades > 0 ? f.unidadesAds / f.unidades : null;
    const campanas = [
      ...new Set(
        (opts.itemsDeModelo.get(f.modelo) ?? [])
          .map((i) => (i.campanaId ? (opts.nombresCampana?.get(i.campanaId) ?? i.campanaId) : null))
          .filter((x): x is string => !!x),
      ),
    ].sort();
    salida.push({
      modelo: f.modelo,
      campanas,
      ritmo,
      ritmoPrevio,
      parteAds,
      gastoDia: f.gastoAds / dias,
      presupuestoHoy: opts.presupuestoDeModelo?.get(f.modelo) ?? null,
      roasObjetivo: opts.roasObjetivoDeModelo?.get(f.modelo) ?? null,
      roasReal: f.ventaAds > 0 ? f.ventaAds / f.gastoAds : null,
      tacos: f.tacos,
      clase: clasificarDependencia(ritmo, ritmoPrevio, parteAds),
    });
  }
  return salida.sort((a, b) => b.gastoDia - a.gastoDia || a.modelo.localeCompare(b.modelo));
}

/** ROAS objetivo de la campaña: `roas_target` o 100 ÷ ACOS objetivo. */
export function roasDeCampana(roas: number | null | undefined, acos: number | null | undefined): number | null {
  const r = roas != null ? Number(roas) : NaN;
  if (Number.isFinite(r) && r > 0) return r;
  const a = acos != null ? Number(acos) : NaN;
  return Number.isFinite(a) && a > 0 ? 100 / a : null;
}

/**
 * ROAS objetivo de HOY de cada modelo: el de sus campañas activas con algún
 * anuncio suyo corriendo, pesado por presupuesto si está en varias. Puro.
 */
export function roasObjetivoPorModelo(
  campanas: { id: string; estado: string | null; presupuesto: number | null; roasObjetivo: number | null }[],
  itemsDeModelo: Map<string, ItemDeModelo[]>,
): Map<string, number> {
  const porId = new Map(campanas.filter((c) => c.estado !== "paused" && c.roasObjetivo != null).map((c) => [c.id, c]));
  const salida = new Map<string, number>();
  for (const [modelo, items] of itemsDeModelo) {
    const ids = new Set(items.filter((i) => i.campanaId && anuncioCorriendo(i.estado)).map((i) => i.campanaId as string));
    let suma = 0;
    let peso = 0;
    for (const id of ids) {
      const c = porId.get(id);
      if (!c) continue;
      const w = c.presupuesto && c.presupuesto > 0 ? c.presupuesto : 1;
      suma += (c.roasObjetivo as number) * w;
      peso += w;
    }
    if (peso > 0) salida.set(modelo, suma / peso);
  }
  return salida;
}

/**
 * El presupuesto se está gastando: el gasto al día llega a esta parte del
 * presupuesto de hoy. Si no llega, el presupuesto NO es lo que limita y
 * moverlo no cambia nada: lo que manda es el ROAS objetivo (dueño,
 * 16-oct-2026: «el presupuesto es 150 y gasta 50 […] ahí deberías
 * ajustar el ROAS objetivo»).
 */
export const PRESUPUESTO_LLENO = 0.8;

/** Un paso de ROAS objetivo nunca mueve más de esto (ni menos de lo mínimo). */
export const PASO_ROAS_MAX = 1.5;
export const PASO_ROAS_MIN = 1.15;

/**
 * El ROAS objetivo nuevo para llevar el gasto de `alDia` a `meta`: el gasto
 * baja más o menos en la misma proporción en que sube el ROAS, así que se
 * parte del ROAS REAL del periodo (venta por publicidad ÷ gasto) y se mueve
 * por esa proporción, en pasos de 15 % a 50 %. Puro.
 */
export function roasParaGasto(roasReal: number, alDia: number, meta: number): number {
  const razon = alDia / Math.max(meta, 0.01);
  const sube = razon >= 1;
  const paso = Math.min(PASO_ROAS_MAX, Math.max(PASO_ROAS_MIN, sube ? razon : 1 / razon));
  const nuevo = sube ? roasReal * paso : roasReal / paso;
  return Math.round(nuevo * 10) / 10;
}

/** Cuántos productos nuevos sin anuncio se sugieren a la vez (los de más stock). */
export const MAX_NUEVOS_SIN_ANUNCIO = 10;

/**
 * En qué orden se atienden. Primero lo que está TIRANDO dinero (apagar y
 * pausar), luego lo que hay que moderar (bajar), luego dónde vale la pena
 * meterle más (subir y encender), y hasta el final los candidatos nuevos.
 * Es el orden en que el dueño trabaja la lista: primero corta, después
 * invierte.
 */
const PRIORIDAD_ACCION: Record<AccionSugerida, number> = {
  apagar: 0,
  pausar: 1,
  bajar: 2,
  subir: 3,
  encender: 4,
  activar: 5,
};

/** Los grupos de la lista, en su orden, para que la pantalla los encabece. */
export const GRUPOS_ACCION: { acciones: AccionSugerida[]; titulo: string }[] = [
  { acciones: ["apagar", "pausar"], titulo: "Apagar: están gastando de más" },
  { acciones: ["bajar"], titulo: "Bajar el presupuesto" },
  { acciones: ["subir", "encender"], titulo: "Subir el presupuesto" },
  { acciones: ["activar"], titulo: "Candidatos para anunciar" },
];

/**
 * Cruza el panel de publicidad con el stock de Full y el margen para decir
 * qué hacer con cada modelo. UNA recomendación por modelo, la más urgente:
 *
 * 1. Anuncio prendido con stock agotado o por agotarse -> PAUSAR: pagar por
 *    acelerar un quiebre es regalar el gasto (esas ventas caían solas).
 * 2. Anuncio pausado con el stock ya repuesto -> ENCENDER.
 * 3. Gasta sin vender, en un modelo que YA vendía antes -> APAGAR (un
 *    lanzamiento nuevo está en rampa, a ese no se le dice nada).
 * 4. Los ads pasan del 10 % de la venta (`TACOS_TOPE`) o del margen -> BAJAR,
 *    con el gasto al día que deja el modelo en el tope.
 * 5. Mucho stock y ads en menos de la mitad del tope -> SUBIR, hasta el tope.
 * 6. Producto NUEVO (no vendía antes del periodo) con stock en Full y sin
 *    anuncio -> ACTIVAR, aunque todavía venda poco (hasta 10, por stock).
 * 7. Vende solo, con stock de sobra y sin anuncio -> ACTIVAR (candidato).
 *
 * El texto sale listo para ejecutarse a mano en la consola de Product Ads:
 * el API de MELI no acepta escrituras de publicidad de esta cuenta.
 */
export function armarRecomendaciones(opts: {
  filas: FilaPublicidad[];
  /** modelo -> pares en Full (disponible + en camino) */
  stockDeModelo: Map<string, number>;
  /** días del periodo, para el ritmo diario */
  dias: number;
  itemsDeModelo: Map<string, ItemDeModelo[]>;
  /**
   * modelos que YA vendían antes del periodo. Un modelo que gasta sin vender
   * pero que nunca ha vendido es un LANZAMIENTO en rampa, no un anuncio
   * muerto: a ese no se le sugiere apagar (verificado con GT190).
   */
  modelosConHistoria?: Set<string>;
  /** dónde vive el stock que se mira: «Full» (MELI) o «FBA» (Amazon) */
  almacen?: string;
  /** cómo se cuentan: «pares» (calzado) o «piezas» (fundas) */
  unidad?: string;
  /** días de stock debajo de los cuales se pausa (por omisión 14) */
  coberturaCorta?: number;
  /** días de stock arriba de los cuales cabe más inversión (por omisión 45) */
  coberturaLarga?: number;
  /** dónde se crea el anuncio, para el texto */
  consola?: string;
  /** TACOS máximo (publicidad ÷ venta total); por omisión `TACOS_TOPE` */
  tacosTope?: number;
  /**
   * modelo -> presupuesto diario que HOY tienen sus campañas en MELI
   * (`presupuestoPorModelo`). El gasto de 14 días va atrasado: si el dueño
   * ya subió (o bajó) el presupuesto, no se le vuelve a pedir (fundas 650,
   * 14-oct-2026: «me llegó subir el gasto pero ya se había subido»).
   */
  presupuestoDeModelo?: Map<string, number>;
  /**
   * modelo -> unidades al día en los 60 días ANTERIORES al periodo. Con ella
   * se reconoce un producto POSICIONADO (vende parejo y casi todo sin
   * publicidad) y se le pide bajar el gasto.
   */
  ritmoPrevioDeModelo?: Map<string, number>;
  /**
   * modelo -> piezas en las bodegas propias (cajas de Industher, Caseshop,
   * EnvioPack; el Sheet de fundas). Con poco stock en Full pero bodega para
   * reponerlo, el anuncio NO se pausa: lo que falta es mandar a Full
   * (GT259, 16-oct-2026: 47 pares en Full y 528 en bodega).
   */
  stockBodegaDeModelo?: Map<string, number>;
  /** modelo -> ROAS objetivo de HOY de sus campañas (`roasObjetivoPorModelo`) */
  roasObjetivoDeModelo?: Map<string, number>;
}): RecomendacionAds[] {
  const tacosTope = opts.tacosTope ?? TACOS_TOPE;
  const { filas, stockDeModelo, dias, itemsDeModelo } = opts;
  const almacen = opts.almacen ?? "Full";
  const unidad = opts.unidad ?? "pares";
  const corta = opts.coberturaCorta ?? COBERTURA_CORTA_DIAS;
  const larga = opts.coberturaLarga ?? COBERTURA_LARGA_DIAS;
  const consola = opts.consola ?? "Product Ads";
  const modelosConHistoria = opts.modelosConHistoria ?? null;
  const recomendaciones: RecomendacionAds[] = [];
  const num = (x: number) => Math.round(x).toLocaleString("es-MX");
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  // Para ordenar por lo que está en juego sin cargarlo en el tipo.
  const peso = new Map<RecomendacionAds, number>();
  const agregar = (r: RecomendacionAds, enJuego: number) => {
    recomendaciones.push(r);
    peso.set(r, enJuego);
  };

  // Productos nuevos sin anuncio: van aparte del recorte de candidatos.
  const nuevos = new Set<RecomendacionAds>();
  const esNuevoSinAnuncio = (modelo: string, gasto: number, anunciosDelModelo: number, stock: number) =>
    modelosConHistoria != null &&
    !modelosConHistoria.has(modelo) &&
    gasto === 0 &&
    anunciosDelModelo === 0 &&
    stock > 0;

  for (const f of filas) {
    const stock = stockDeModelo.get(f.modelo) ?? 0;
    const ritmo = dias > 0 ? f.unidades / dias : 0;
    const cobertura = ritmo > 0 ? stock / ritmo : null;
    const items = itemsDeModelo.get(f.modelo) ?? [];
    const activos = items.filter((i) => anuncioCorriendo(i.estado));
    const pausados = items.filter((i) => i.estado === "paused");
    const margen = f.ganancia != null && f.importe > 0 ? f.ganancia / f.importe : null;
    // ¿Se gasta el presupuesto? Si no, moverlo no cambia nada: va el ROAS.
    const roasObj = opts.roasObjetivoDeModelo?.get(f.modelo) ?? null;
    const roasReal = f.gastoAds > 0 && f.ventaAds > 0 ? f.ventaAds / f.gastoAds : null;
    const presHoy = opts.presupuestoDeModelo?.get(f.modelo) ?? null;
    const gastoDiaActual = dias > 0 ? f.gastoAds / dias : f.gastoAds;
    const presupuestoLleno = presHoy == null || presHoy <= 0 || gastoDiaActual >= presHoy * PRESUPUESTO_LLENO;
    const consumo =
      presHoy != null && presHoy > 0
        ? ` · gasta $${num(gastoDiaActual)} de $${num(presHoy)} de presupuesto`
        : "";
    // Para BAJAR el gasto se sube el ROAS objetivo (si la campaña tiene uno);
    // devuelve null si ya está ahí o si no hay ROAS con qué trabajar.
    const subirRoas = (meta: number): { texto: string; listo: boolean } | null => {
      if (roasObj == null || roasReal == null) return null;
      const nuevo = roasParaGasto(roasReal, gastoDiaActual, meta);
      if (roasObj >= nuevo * 0.95) return { texto: "", listo: true };
      return { texto: `Subir el ROAS objetivo de ${roasObj.toFixed(1)} a ~${nuevo.toFixed(1)}`, listo: false };
    };
    const cobertext =
      cobertura != null
        ? `${num(cobertura)} días de stock (${num(stock)} ${unidad})`
        : `${num(stock)} ${unidad} en ${almacen}`;

    // 1. Stock agotado o por agotarse con el anuncio prendido.
    const sinStock = stock <= 0;
    const coberturaCorta = cobertura != null && cobertura < corta;
    const bodega = opts.stockBodegaDeModelo?.get(f.modelo) ?? 0;
    // Con la bodega, ¿alcanza? Entonces se repone Full; el anuncio sigue.
    const bodegaRepone = bodega > 0 && (ritmo > 0 ? (stock + bodega) / ritmo >= corta : true);
    if (activos.length > 0 && f.gastoAds > 0 && (sinStock || coberturaCorta) && !bodegaRepone) {
      agregar(
        {
          modelo: f.modelo,
          accion: "pausar",
          queHacer: "Pausar el anuncio",
          razon: sinStock
            ? `Sin stock en ${almacen} y lleva $${num(f.gastoAds)} gastados: está pagando ventas que no puede surtir.`
            : `Quedan ${cobertext} y ya lleva $${num(f.gastoAds)} en ads: esas ventas caen solas, la publicidad solo acelera el quiebre.`,
        },
        f.gastoAds,
      );
      continue;
    }

    // 2. Anuncio pausado con el stock ya repuesto.
    const stockRecuperado =
      cobertura != null ? cobertura >= corta : stock > 0;
    if (pausados.length > 0 && stockRecuperado) {
      agregar(
        {
          modelo: f.modelo,
          accion: "encender",
          queHacer: "Encender el anuncio",
          razon: `Está pausado y ya hay ${cobertext}: si lo pausaste por falta de stock, ya se puede prender.`,
        },
        f.importe,
      );
      continue;
    }

    // 3. Gasta y no vende nada — SOLO si el modelo ya vendía antes: un
    // lanzamiento nuevo con ads y cero ventas está en rampa, no muerto.
    const yaVendia = modelosConHistoria == null || modelosConHistoria.has(f.modelo);
    if (f.gastoAds > 0 && f.unidades === 0 && yaVendia) {
      agregar(
        {
          modelo: f.modelo,
          accion: "apagar",
          queHacer: "Apagar el anuncio",
          razon: `Gastó $${num(f.gastoAds)} sin una sola venta en el periodo y el modelo ya vendía antes: el anuncio no está trabajando.`,
        },
        f.gastoAds,
      );
      continue;
    }

    // 4. Los ads pasan del tope de TACOS (10 % de la venta, regla del
    // dueño) o se comen el margen: bajar. El tope manda aunque el margen
    // aguante; sin costo capturado, también.
    const tope = margen != null ? Math.min(margen, tacosTope) : tacosTope;
    if (f.tacos != null && f.gastoAds > 0 && f.tacos > tope) {
      const alDia = dias > 0 ? f.gastoAds / dias : f.gastoAds;
      const alDiaSano = dias > 0 ? (tope * f.importe) / dias : tope * f.importe;
      const sinMargen = margen != null && f.tacos > margen;
      const hoy = opts.presupuestoDeModelo?.get(f.modelo);
      if (alDia - alDiaSano < GASTO_DIA_MINIMO) continue;
      // Con ROAS objetivo, se baja subiéndolo (el presupuesto casi nunca es
      // lo que limita); sin él, con el presupuesto, si no está ya en el tope.
      const roas = subirRoas(alDiaSano);
      if (roas?.listo) continue;
      if (!roas && hoy != null && hoy <= alDiaSano * 1.1) continue;
      agregar(
        {
          modelo: f.modelo,
          accion: "bajar",
          queHacer: roas
            ? `${roas.texto} para bajar el gasto de $${num(alDia)} a ~$${num(alDiaSano)} al día (${pct(tope)} de la venta)${consumo}`
            : `Bajar el gasto de $${num(alDia)} a ~$${num(alDiaSano)} al día (${pct(tope)} de la venta)${hoy != null ? ` · presupuesto hoy $${num(hoy)}` : ""}`,
          razon: sinMargen
            ? `Los ads se llevan ${pct(f.tacos)} de la venta y el margen es solo ${pct(margen!)}: cada venta por publicidad sale con pérdida.`
            : `Los ads se llevan ${pct(f.tacos)} de la venta; el tope es ${pct(tacosTope)}.`,
        },
        f.gastoAds,
      );
      continue;
    }

    // 4b. Producto POSICIONADO: vende parejo desde hace meses y la mayor
    // parte de sus ventas NO viene de la publicidad. Ahí el anuncio paga
    // ventas que ya caían solas (regla del dueño, 16-oct-2026: «no vale la
    // pena gastar en productos ya posicionados»): bajar el gasto a la mitad
    // y, si en dos semanas sigue vendiendo igual, otra vez.
    const previo = opts.ritmoPrevioDeModelo?.get(f.modelo) ?? null;
    const parteAds = f.unidades > 0 ? f.unidadesAds / f.unidades : null;
    if (
      activos.length > 0 &&
      f.gastoAds > 0 &&
      previo != null &&
      parteAds != null &&
      esPosicionado(ritmo, previo, parteAds)
    ) {
      const alDia = dias > 0 ? f.gastoAds / dias : f.gastoAds;
      const alDiaMitad = alDia / 2;
      const hoy = opts.presupuestoDeModelo?.get(f.modelo);
      // Con ROAS objetivo: subirlo (dueño: «si está bien posicionado, en vez
      // de bajar el gasto podemos subir el ROAS objetivo»). Sin él, el
      // presupuesto; ya se hizo si el de hoy anda en la mitad (el gasto de
      // 14 días va atrasado). Unos pesos no valen el clic.
      const roas = subirRoas(alDiaMitad);
      const yaBajado = roas ? roas.listo : hoy != null && hoy <= alDiaMitad * 1.1;
      if (!yaBajado && alDia - alDiaMitad >= GASTO_DIA_MINIMO) {
        agregar(
          {
            modelo: f.modelo,
            accion: "bajar",
            queHacer: roas
              ? `Producto posicionado: ${roas.texto.charAt(0).toLowerCase()}${roas.texto.slice(1)} (gasto de $${num(alDia)} a ~$${num(alDiaMitad)} al día)${consumo}`
              : `Producto posicionado: bajar el gasto de $${num(alDia)} a ~$${num(alDiaMitad)} al día${hoy != null ? ` · presupuesto hoy $${num(hoy)}` : ""}`,
            razon: `Vende ${num(ritmo)} al día parejo (antes ${num(previo)}) y solo ${pct(parteAds)} de sus ventas viene de la publicidad: ya se vende solo. Si en dos semanas sigue igual, se puede volver a bajar.`,
          },
          f.gastoAds,
        );
      }
      // Un posicionado nunca recibe «subir».
      continue;
    }

    // 5. Capital parado y lejos del tope: subir, pero nunca arriba del 10 %.
    if (
      f.gastoAds > 0 &&
      f.tacos != null &&
      f.importe > 0 &&
      cobertura != null &&
      cobertura > larga &&
      f.tacos < tope / 2 &&
      (margen == null || margen > tope)
    ) {
      const alDia = dias > 0 ? f.gastoAds / dias : f.gastoAds;
      const alDiaTope = dias > 0 ? (tope * f.importe) / dias : tope * f.importe;
      const hoy = opts.presupuestoDeModelo?.get(f.modelo);
      if (alDiaTope - alDia < GASTO_DIA_MINIMO) continue;
      // Si el presupuesto NO se gasta, subirlo no mueve nada: lo que frena
      // es el ROAS objetivo y hay que BAJARLO, sin pasar del piso que deja la
      // publicidad en el tope de TACOS.
      let queHacer: string;
      if (!presupuestoLleno && roasObj != null && roasReal != null) {
        const parteVentaAds = f.importe > 0 ? f.ventaAds / f.importe : 0;
        const piso = Math.round((parteVentaAds / tope) * 10) / 10;
        const nuevo = Math.max(piso, roasParaGasto(roasReal, alDia, alDiaTope));
        if (roasObj <= nuevo * 1.05) continue;
        queHacer = `Bajar el ROAS objetivo de ${roasObj.toFixed(1)} a ~${nuevo.toFixed(1)} para que gaste más (hasta ~$${num(alDiaTope)} al día, ${pct(tope)} de la venta)${consumo}`;
      } else {
        // El presupuesto de hoy ya alcanza para el tope: ya se subió.
        if (hoy != null && hoy >= alDiaTope * 0.9) continue;
        queHacer = `Subir el gasto de $${num(alDia)} hasta ~$${num(alDiaTope)} al día (${pct(tope)} de la venta)${hoy != null ? ` · presupuesto hoy $${num(hoy)}` : ""}`;
      }
      agregar(
        {
          modelo: f.modelo,
          accion: "subir",
          queHacer,
          razon: `Hay ${cobertext} parados y los ads solo se llevan ${pct(f.tacos)} de la venta: cabe más inversión sin pasar del tope de ${pct(tacosTope)}.`,
        },
        f.importe,
      );
      continue;
    }

    // 6a. Producto NUEVO en Full sin anuncio: no vendía antes del periodo y
    // ya tiene stock. Un lanzamiento sin publicidad tarda mucho en arrancar
    // (regla de producto nuevo del plan de Full: si no se le empuja, nunca
    // paga), así que se sugiere aunque todavía venda poco.
    if (esNuevoSinAnuncio(f.modelo, f.gastoAds, items.length, stock)) {
      const r: RecomendacionAds = {
        modelo: f.modelo,
        accion: "activar",
        queHacer: "Crear anuncio: producto nuevo",
        razon:
          f.unidades > 0
            ? `Producto nuevo (no vendía antes del periodo): lleva ${num(f.unidades)} ${unidad} vendidos sin publicidad y hay ${cobertext}. Un anuncio acelera el arranque.`
            : `Producto nuevo con ${num(stock)} ${unidad} en ${almacen} y sin anuncio: sin publicidad casi no se ve.`,
      };
      nuevos.add(r);
      agregar(r, stock);
      continue;
    }

    // 6. Vende solo, con stock de sobra y sin anuncio.
    if (
      f.gastoAds === 0 &&
      items.length === 0 &&
      ritmo >= 1 &&
      stock > 0 &&
      (cobertura == null || cobertura > larga)
    ) {
      agregar(
        {
          modelo: f.modelo,
          accion: "activar",
          queHacer: "Crear anuncio (candidato)",
          razon: `Vende ${num(ritmo)} al día sin publicidad y hay ${cobertext}: vale la pena probarlo en ${consola}.`,
        },
        f.importe,
      );
    }
  }

  // Modelos con stock en Full que NO vendieron en el periodo ni antes y no
  // tienen anuncio: tampoco salen en `filas` (no tienen venta ni gasto).
  const enFilas = new Set(filas.map((f) => f.modelo));
  for (const [modelo, stock] of stockDeModelo) {
    if (enFilas.has(modelo)) continue;
    if (!esNuevoSinAnuncio(modelo, 0, (itemsDeModelo.get(modelo) ?? []).length, stock)) continue;
    const r: RecomendacionAds = {
      modelo,
      accion: "activar",
      queHacer: "Crear anuncio: producto nuevo",
      razon: `Producto nuevo con ${num(stock)} ${unidad} en ${almacen}, sin ventas todavía y sin anuncio: sin publicidad casi no se ve.`,
    };
    nuevos.add(r);
    agregar(r, stock);
  }
  // Los nuevos se quedan con los que más stock tienen (no saturar la lista).
  const nuevosQueQuedan = new Set(
    [...nuevos].sort((a, b) => (peso.get(b) ?? 0) - (peso.get(a) ?? 0)).slice(0, MAX_NUEVOS_SIN_ANUNCIO),
  );

  // Los candidatos a activar pueden ser docenas: se queda con los 5 que más
  // venden ANTES de ordenar, para que el recorte no dependa del alfabeto.
  const mejoresCandidatos = new Set(
    recomendaciones
      .filter((r) => r.accion === "activar" && !nuevos.has(r))
      .sort((a, b) => (peso.get(b) ?? 0) - (peso.get(a) ?? 0))
      .slice(0, 5),
  );

  return recomendaciones
    .filter((r) => r.accion !== "activar" || mejoresCandidatos.has(r) || nuevosQueQuedan.has(r))
    // Por lo que hay que HACER, no por el alfabeto: primero lo que está
    // tirando dinero y al final los candidatos nuevos. Antes se ordenaba por
    // modelo y la prioridad solo desempataba — y como hay UNA recomendación
    // por modelo, nunca desempataba nada: la lista salía puramente
    // alfabética y lo urgente quedaba enterrado a media tabla.
    // Dentro de cada grupo, primero lo que más dinero mueve.
    .sort(
      (a, b) =>
        PRIORIDAD_ACCION[a.accion] - PRIORIDAD_ACCION[b.accion] ||
        (peso.get(b) ?? 0) - (peso.get(a) ?? 0) ||
        a.modelo.localeCompare(b.modelo, "es"),
    );
}

// ---------------------------------------------------------------------------
// Armado del panel (puro, para poder probarlo sin red)
// ---------------------------------------------------------------------------

export function armarPublicidad(opts: {
  anuncios: AnuncioAds[];
  /** ventas del periodo, YA filtradas al rango */
  ventas: VentaDiaria[];
  /**
   * item_id → TODOS los modelos con variantes en esa publicación. Una
   * publicación puede juntar varios modelos (GT117…GT122 en un solo anuncio):
   * su gasto se reparte entre ellos, no se le carga a uno.
   */
  modelosDeItem: Map<string, string[]>;
  /** sku → modelo, del catálogo */
  modeloDeSku: Map<string, string>;
  /** modelo → costo capturado (MXN), de productos_config */
  costoDeModelo: Map<string, number | null>;
  errorAds: string | null;
  advertencias?: string[];
}): Publicidad {
  const {
    anuncios,
    ventas,
    modelosDeItem,
    modeloDeSku,
    costoDeModelo,
    errorAds,
    advertencias = [],
  } = opts;

  interface Acum {
    anuncios: number;
    unidades: number;
    importe: number;
    neto: number;
    gastoAds: number;
    ventaAds: number;
    unidadesAds: number;
    clicks: number;
    impresiones: number;
  }
  const porModelo = new Map<string, Acum>();
  const de = (modelo: string): Acum => {
    let a = porModelo.get(modelo);
    if (!a) {
      a = {
        anuncios: 0,
        unidades: 0,
        importe: 0,
        neto: 0,
        gastoAds: 0,
        ventaAds: 0,
        unidadesAds: 0,
        clicks: 0,
        impresiones: 0,
      };
      porModelo.set(modelo, a);
    }
    return a;
  };

  // Misma convención que el monitor de ventas: primero el catálogo y, si el
  // SKU no está, el modelo es lo que va antes del primer guion.
  const modeloDe = (sku: string): string =>
    modeloDeSku.get(sku) ?? (sku.split("-")[0] || sku);

  for (const v of ventas) {
    const a = de(modeloDe(v.sku));
    a.unidades += v.unidades ?? 0;
    a.importe += v.importe ?? 0;
    // Regla del dueño: solo el neto REAL de Mercado Pago. Un renglón sin
    // depósito leído no se estima: aporta cero al neto y se declara aparte
    // (ventaSinDeposito). El renglón sintético del RPC ya trae comisión =
    // importe − neto real, así que importe − comisión ES el neto real.
    a.neto += v.neto != null ? Number(v.neto) : (v.importe ?? 0) - (v.comision ?? 0);
  }

  const sinAmarre = { gasto: 0, anuncios: 0 };
  for (const an of anuncios) {
    const modelos = modelosDeItem.get(an.itemId) ?? [];
    // Un anuncio sin actividad en el periodo no aporta nada al panel.
    const conActividad =
      an.gasto > 0 || an.clicks > 0 || an.impresiones > 0 || an.ventaAds > 0;
    if (!conActividad) continue;
    if (!modelos.length) {
      sinAmarre.gasto += an.gasto;
      sinAmarre.anuncios += 1;
      continue;
    }

    // Reparto del anuncio entre los modelos de la publicación, proporcional
    // a las unidades que cada uno vendió en el periodo (la mejor señal de a
    // quién le trabajó el anuncio). Si ninguno vendió, en partes iguales.
    const pesos = modelos.map((m) => porModelo.get(m)?.unidades ?? 0);
    const totalPeso = pesos.reduce((s, x) => s + x, 0);
    modelos.forEach((modelo, i) => {
      const fraccion = totalPeso > 0 ? pesos[i] / totalPeso : 1 / modelos.length;
      if (fraccion <= 0) return;
      const a = de(modelo);
      a.anuncios += 1;
      a.gastoAds += an.gasto * fraccion;
      a.ventaAds += an.ventaAds * fraccion;
      a.unidadesAds += an.unidadesAds * fraccion;
      a.clicks += an.clicks * fraccion;
      a.impresiones += an.impresiones * fraccion;
    });
  }

  const filas: FilaPublicidad[] = [...porModelo.entries()]
    .map(([modelo, a]) => {
      const costo = costoDeModelo.get(modelo) ?? null;
      const ganancia =
        costo != null && a.unidades > 0 ? a.neto - costo * a.unidades : null;
      return {
        modelo,
        anuncios: a.anuncios,
        unidades: a.unidades,
        importe: a.importe,
        ganancia,
        gastoAds: a.gastoAds,
        ventaAds: a.ventaAds,
        unidadesAds: a.unidadesAds,
        clicks: a.clicks,
        impresiones: a.impresiones,
        costoPorUnidad: a.unidades > 0 ? a.gastoAds / a.unidades : null,
        tacos: a.importe > 0 ? a.gastoAds / a.importe : null,
        gananciaNeta: ganancia != null ? ganancia - a.gastoAds : null,
      };
    })
    // En orden alfabético de modelo: así se busca un parent concreto de un
    // vistazo, como en el resto de las tablas del sistema.
    .sort((x, y) => x.modelo.localeCompare(y.modelo, "es"));

  let gastoAds = 0;
  let ventaAds = 0;
  let unidadesAds = 0;
  let unidades = 0;
  let importe = 0;
  let ganancia = 0;
  let unidadesConCosto = 0;
  for (const f of filas) {
    gastoAds += f.gastoAds;
    ventaAds += f.ventaAds;
    unidadesAds += f.unidadesAds;
    unidades += f.unidades;
    importe += f.importe;
    if (f.ganancia != null) {
      ganancia += f.ganancia;
      unidadesConCosto += f.unidades;
    }
  }
  gastoAds += sinAmarre.gasto;

  return {
    filas,
    // Las llena la carga completa: necesitan el stock de Full.
    recomendaciones: [],
    totales: {
      gastoAds,
      ventaAds,
      unidadesAds,
      unidades,
      importe,
      ganancia,
      coberturaCosto: unidades > 0 ? unidadesConCosto / unidades : 0,
      costoPorUnidad: unidades > 0 ? gastoAds / unidades : null,
      tacos: importe > 0 ? gastoAds / importe : null,
      acos: ventaAds > 0 ? gastoAds / ventaAds : null,
    },
    sinAmarre,
    errorAds,
    advertencias,
    errorRecomendaciones: null,
  };
}

// ---------------------------------------------------------------------------
// Carga completa
// ---------------------------------------------------------------------------

/**
 * Diez minutos de caché por instancia: el API de publicidad pagina de 50 en
 * 50 y no cambia minuto a minuto; el panel sí se abre seguido.
 */
const cachePublicidad = new Map<string, { en: number; datos: Publicidad }>();
const VIDA_CACHE_ADS_MS = 10 * 60_000;

/** Tras pausar/encender un anuncio o editar una campaña, el panel debe releer. */
export function invalidarCachePublicidad(): void {
  cachePublicidad.clear();
}

export async function cargarPublicidad(
  db: DB,
  cuenta: { id: string; site_id: string },
  rango?: RangoFechas,
): Promise<Publicidad> {
  const r = rango ?? normalizarRango();
  const claveCache = `${cuenta.id}|${r.desde}|${r.hasta}`;
  const guardado = cachePublicidad.get(claveCache);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_ADS_MS) return guardado.datos;

  // Se piden 60 días EXTRA hacia atrás solo para saber qué modelos ya
  // vendían antes del periodo: un modelo sin historia es un lanzamiento y
  // las sugerencias lo tratan distinto.
  const desdeHistoria = new Date(Date.parse(r.desde) - 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Igual que el monitor: `comision` y `neto` pueden no existir todavía.
  const leerVentas = async (): Promise<VentaDiaria[]> => {
    const filtro = (q: any) =>
      q.eq("account_id", cuenta.id).gte("fecha", desdeHistoria).lte("fecha", r.hasta);
    try {
      return await traerTodo<VentaDiaria>(
        db,
        "ventas_diarias",
        "sku, fecha, unidades, importe, comision, neto",
        filtro,
      );
    } catch (error) {
      if (!esErrorColumnaLegacy(error, ["neto"])) throw error;
      try {
        return await traerTodo<VentaDiaria>(
          db,
          "ventas_diarias",
          "sku, fecha, unidades, importe, comision",
          filtro,
        );
      } catch (errorSinNeto) {
        if (!esErrorColumnaLegacy(errorSinNeto, ["comision"])) throw errorSinNeto;
        return traerTodo<VentaDiaria>(db, "ventas_diarias", "sku, fecha, unidades, importe", filtro);
      }
    }
  };

  /**
   * Las ventas del periodo SUMADAS EN POSTGRES (`ventas_resumen_sku`), en
   * vez de bajar la tabla cruda para sumarla aquí. El renglón sintético por
   * SKU lleva `neto` en null y `comision` = importe − neto resuelto, para
   * que armarPublicidad (importe − comisión) recupere EXACTAMENTE el neto
   * que la base ya resolvió: real donde llegó, importe − comisión donde no.
   * Si el RPC no existe todavía, el respaldo baja los renglones como siempre.
   */
  const diaAntes = new Date(Date.parse(r.desde) - 86_400_000).toISOString().slice(0, 10);
  const leerVentasAgregadas = async (): Promise<{
    periodo: VentaDiaria[];
    skusConHistoria: Set<string>;
    /** sku -> unidades en los 60 días anteriores al periodo */
    unidadesPrevias: Map<string, number>;
    /** venta del periodo cuyo depósito aún no se lee (fuera de la ganancia) */
    ventaSinDeposito: number;
  }> => {
    // Por páginas: hay más de 1,000 SKUs con venta.
    const { data, error } = await rpcPaginado(db, "ventas_resumen_sku", {
      p_account: cuenta.id,
      p_desde: r.desde,
      p_hasta: r.hasta,
      p_prev_desde: desdeHistoria,
      p_prev_hasta: diaAntes,
      p_hoy: r.hasta,
    });
    if (!error) {
      const periodo: VentaDiaria[] = [];
      const skusConHistoria = new Set<string>();
      const unidadesPrevias = new Map<string, number>();
      let ventaSinDeposito = 0;
      for (const f of (data ?? []) as any[]) {
        const sku = String(f.sku);
        const unidades = Number(f.unidades) || 0;
        const importe = Number(f.importe) || 0;
        // Regla del dueño: solo el neto REAL. La venta sin depósito leído no
        // se estima como importe − comisión: se declara y queda fuera.
        const neto = Number(f.neto_real) || 0;
        ventaSinDeposito += Math.max(0, importe - (Number(f.importe_neto_real) || 0));
        const previas = Number(f.unidades_prev) || 0;
        if (previas > 0) {
          skusConHistoria.add(sku);
          unidadesPrevias.set(sku, previas);
        }
        if (unidades === 0 && importe === 0 && neto === 0) continue;
        periodo.push({ sku, fecha: r.desde, unidades, importe, comision: importe - neto, neto: null });
      }
      return { periodo, skusConHistoria, unidadesPrevias, ventaSinDeposito };
    }

    if (!esErrorObjetoLegacy(error, ["ventas_resumen_sku"])) {
      throw new Error(`ventas_resumen_sku: ${mensajeErrorDatos(error)}`);
    }
    const filas = await leerVentas();
    const skusConHistoria = new Set<string>();
    const unidadesPrevias = new Map<string, number>();
    let ventaSinDeposito = 0;
    for (const v of filas) {
      if (v.fecha < r.desde && (v.unidades ?? 0) > 0) {
        skusConHistoria.add(v.sku);
        unidadesPrevias.set(v.sku, (unidadesPrevias.get(v.sku) ?? 0) + (v.unidades ?? 0));
      }
      if (v.fecha >= r.desde && netoConfirmadoDeFila(v) == null) ventaSinDeposito += v.importe ?? 0;
    }
    return { periodo: filas.filter((v) => v.fecha >= r.desde), skusConHistoria, unidadesPrevias, ventaSinDeposito };
  };

  const [ventasAgregadas, deBase, skus, config, stockEstado, cliente] = await Promise.all([
    leerVentasAgregadas(),
    // Los anuncios desde la base, cuando la sincronización cubre el rango.
    anunciosDesdeBase(db, cuenta.id, r),
    traerTodo<{ sku: string; modelo: string | null; item_id: string | null }>(
      db,
      "skus",
      "sku, modelo, item_id",
      (q) => q.eq("account_id", cuenta.id).eq("activo", true),
    ),
    configPorProducto(db, cuenta.id),
    // El stock de Full (disponible + en camino), para las recomendaciones.
    traerTodo<{ sku: string; disponible: number | null; en_transferencia: number | null }>(
      db,
      "stock_full",
      "sku, disponible, en_transferencia",
      (q) => q.eq("account_id", cuenta.id),
    )
      .then((filas) => ({ filas, error: null as string | null }))
      .catch((error) => ({
        filas: [] as { sku: string; disponible: number | null; en_transferencia: number | null }[],
        error: `No se pudo leer el stock de Full: ${mensajeErrorDatos(error)}. Las recomendaciones de stock están desactivadas.`,
      })),
    // Los tokens viven en `meli_tokens`, que tiene RLS con cero políticas a
    // propósito: SOLO el service-role la lee. Con el cliente de la sesión la
    // tabla se ve vacía aunque la cuenta esté conectada.
    (async () => {
      try {
        return await clienteDeCuenta(clienteAdmin(), cuenta.id);
      } catch {
        return null;
      }
    })(),
  ]);
  const stock = stockEstado.filas;
  const advertencias = stockEstado.error ? [stockEstado.error] : [];
  if (ventasAgregadas.ventaSinDeposito > 0) {
    advertencias.push(
      `${ventasAgregadas.ventaSinDeposito.toLocaleString("es-MX", { style: "currency", currency: "MXN" })} de venta del periodo todavía no tiene el depósito real de Mercado Pago: no está en el neto ni en la ganancia (nada se estima); el fondo lo lee solo.`,
    );
  }

  const modeloDeSku = new Map<string, string>();
  // Una publicación puede traer variantes de VARIOS modelos: se guardan todos
  // para repartir el gasto del anuncio, no cargárselo al último del catálogo.
  const modelosDeItem = new Map<string, string[]>();
  for (const s of skus) {
    const modelo = s.modelo ?? (s.sku.split("-")[0] || s.sku);
    modeloDeSku.set(s.sku, modelo);
    if (s.item_id) {
      const lista = modelosDeItem.get(s.item_id);
      if (!lista) modelosDeItem.set(s.item_id, [modelo]);
      else if (!lista.includes(modelo)) lista.push(modelo);
    }
  }

  const costoDeModelo = new Map<string, number | null>();
  for (const [modelo, cfg] of config) costoDeModelo.set(modelo, cfg.costo);

  let anuncios: AnuncioAds[] = [];
  let errorAds: string | null = null;
  if (deBase) {
    // La base cubre el rango completo y está fresca: ni una llamada a MELI.
    anuncios = deBase;
  } else if (!cliente) {
    errorAds =
      "No se pudieron leer los tokens de MELI: revisa que la cuenta esté conectada en Ajustes.";
  } else {
    try {
      const adv = await resolverAdvertiser(cliente, cuenta.site_id);
      anuncios = await traerAnunciosAds(cliente, adv, r);
    } catch (err) {
      // 403 = a la app le falta el permiso de Product Ads en MELI. Se enseña
      // el motivo en el panel en vez de un panel vacío sin explicación.
      errorAds =
        err instanceof MeliError
          ? err.status === 403
            ? "MELI negó el acceso a Product Ads (403): reconecta Mercado Libre en Ajustes para otorgar el permiso de publicidad."
            : err.message
          : err instanceof Error
            ? err.message
            : "No se pudo consultar el API de publicidad.";
    }
  }

  // El panel usa SOLO las ventas del periodo; las 60 días previas solo
  // marcan qué modelos ya vendían antes (para no regañar lanzamientos).
  const ventasPeriodo = ventasAgregadas.periodo;
  const modelosConHistoria = new Set<string>();
  for (const sku of ventasAgregadas.skusConHistoria) {
    modelosConHistoria.add(modeloDeSku.get(sku) ?? (sku.split("-")[0] || sku));
  }

  const datos = armarPublicidad({
    anuncios,
    ventas: ventasPeriodo,
    modelosDeItem,
    modeloDeSku,
    costoDeModelo,
    errorAds,
    advertencias,
  });
  datos.errorRecomendaciones = stockEstado.error;

  // --- Anuncios por modelo, para saber cuáles están pausados ---------------
  const itemsDeModelo = new Map<string, ItemDeModelo[]>();
  for (const an of anuncios) {
    const modelos = modelosDeItem.get(an.itemId) ?? [];
    for (const modelo of modelos) {
      const lista = itemsDeModelo.get(modelo) ?? [];
      lista.push({
        itemId: an.itemId,
        titulo: an.titulo,
        estado: an.estado,
        campanaId: an.campanaId,
        compartido: modelos.length > 1,
      });
      itemsDeModelo.set(modelo, lista);
    }
  }

  // --- Recomendaciones: publicidad × stock × margen ------------------------
  const stockDeModelo = new Map<string, number>();
  for (const s of stock) {
    const modelo = modeloDeSku.get(s.sku);
    if (!modelo) continue;
    stockDeModelo.set(
      modelo,
      (stockDeModelo.get(modelo) ?? 0) + (s.disponible ?? 0) + (s.en_transferencia ?? 0),
    );
  }
  // Ritmo de venta por modelo en los 60 días anteriores (producto posicionado).
  const diasPrevios = diasDeRango({ desde: desdeHistoria, hasta: diaAntes });
  const ritmoPrevioDeModelo = new Map<string, number>();
  for (const [sku, u] of ventasAgregadas.unidadesPrevias) {
    const modelo = modeloDeSku.get(sku) ?? (sku.split("-")[0] || sku);
    ritmoPrevioDeModelo.set(modelo, (ritmoPrevioDeModelo.get(modelo) ?? 0) + u / diasPrevios);
  }

  // Pares en las bodegas propias: con bodega para reponer Full no se pausa.
  let stockBodegaDeModelo: Map<string, number> | undefined;
  if (!stockEstado.error) {
    try {
      const inv = await cargarInventario(db, cuenta.id, { sinCrudos: true });
      stockBodegaDeModelo = new Map();
      for (const rg of inv.renglones) {
        if (!rg.enBodega) continue;
        const modelo = modeloDeSku.get(rg.sku) ?? rg.modelo;
        stockBodegaDeModelo.set(modelo, (stockBodegaDeModelo.get(modelo) ?? 0) + rg.enBodega);
      }
    } catch (err) {
      datos.advertencias.push(`No se pudo leer la bodega: ${(err as Error).message}. «Pausar» solo mira el stock de Full.`);
    }
  }

  // El presupuesto de HOY de cada campaña: lo ya subido o bajado no se
  // vuelve a pedir. Si MELI no lo da, se recomienda solo con el gasto.
  let presupuestoDeModelo: Map<string, number> | undefined;
  let roasObjetivoDeModelo: Map<string, number> | undefined;
  let nombresCampana: Map<string, string> | undefined;
  if (cliente && !stockEstado.error) {
    try {
      const adv = await resolverAdvertiser(cliente, cuenta.site_id);
      const campanas = await traerCampanasAds(cliente, adv);
      nombresCampana = new Map(campanas.map((c) => [c.id, c.nombre]));
      presupuestoDeModelo = presupuestoPorModelo(campanas, itemsDeModelo);
      roasObjetivoDeModelo = roasObjetivoPorModelo(campanas, itemsDeModelo);
    } catch (err) {
      datos.advertencias.push(`No se pudo leer el presupuesto de las campañas: ${(err as Error).message}. Las recomendaciones salen solo del gasto.`);
    }
  }
  datos.recomendaciones = stockEstado.error
    ? []
    : armarRecomendaciones({
        filas: datos.filas,
        stockDeModelo,
        dias: diasDeRango(r),
        itemsDeModelo,
        modelosConHistoria,
        presupuestoDeModelo,
        ritmoPrevioDeModelo,
        stockBodegaDeModelo,
        roasObjetivoDeModelo,
      });
  datos.dependencias = armarDependencias({
    filas: datos.filas,
    dias: diasDeRango(r),
    itemsDeModelo,
    nombresCampana,
    presupuestoDeModelo,
    roasObjetivoDeModelo,
    ritmoPrevioDeModelo,
  });

  // Un panel con error de ads no se cachea: al reintentar (p. ej. ya con el
  // permiso otorgado) debe volver a preguntar, no repetir el error 10 minutos.
  // (Esta es la caché EN MEMORIA, que también leen los cortes; las pantallas
  // guardan el resultado completo, con sus avisos, en `servirPublicidad`.)
  if (!errorAds && advertencias.length === 0) {
    cachePublicidad.set(claveCache, { en: Date.now(), datos });
  }
  return datos;
}

/** Cuánto vive el panel guardado de un rango que incluye hoy. */
export const VIDA_PUBLICIDAD_ABIERTA_MS = 10 * 60_000;
/** Un rango que ya cerró casi no cambia: se refresca cada 6 horas. */
export const VIDA_PUBLICIDAD_CERRADA_MS = 6 * 3_600_000;

export const clavePublicidadMeli = (r: RangoFechas): string => `publicidad-meli:${r.desde}:${r.hasta}`;

/**
 * El panel de publicidad masticado para PANTALLAS (/ventas, /publicidad y la
 * tabla de modelos): sirve el renglón de `app_cache` aunque esté viejo y lo
 * refresca por atrás. El error de ads y las advertencias se guardan junto
 * con el resultado y se enseñan igual. Los cortes NO usan esto: piden
 * `cargarPublicidad` directo porque congelan lo que leen.
 */
export async function servirPublicidad(
  db: DB,
  cuenta: { id: string; site_id: string },
  rango?: RangoFechas,
): Promise<{ datos: Publicidad; generadoEn: string | null; refrescando: boolean }> {
  const r = rango ?? normalizarRango();
  const vida = r.hasta < fechaMx(0) ? VIDA_PUBLICIDAD_CERRADA_MS : VIDA_PUBLICIDAD_ABIERTA_MS;
  // Sin la copia en memoria (10 min): lo guardado tiene que ser de ahora.
  return servirConCacheApp(db, cuenta.id, clavePublicidadMeli(r), vida, () => calcularPublicidadFresca(db, cuenta, r));
}

/** Calcula el panel sin caché en memoria (lo usa el fondo para guardarlo). */
export function calcularPublicidadFresca(
  db: DB,
  cuenta: { id: string; site_id: string },
  rango: RangoFechas,
): Promise<Publicidad> {
  cachePublicidad.clear();
  return cargarPublicidad(db, cuenta, rango);
}
