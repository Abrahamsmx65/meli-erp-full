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
import { traerTodo, type DB } from "../datos/repos";
import { clienteAdmin } from "../supabase/server";
import { configPorProducto } from "./productos";
import { clienteDeCuenta } from "./webhooks";
import { diasDeRango, normalizarRango, type RangoFechas } from "./ventas-monitor";

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
  /** qué ajustar hoy, con la razón y los anuncios sobre los que actuar */
  sugerencias: SugerenciaAds[];
  /** campañas de Product Ads, editables desde el panel */
  campanas: CampanaAds[];
  /** anuncios por modelo, para los botones de pausar/encender de la tabla */
  itemsDeModelo: Map<string, ItemDeModelo[]>;
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

export interface SugerenciaAds {
  modelo: string;
  accion: AccionSugerida;
  razon: string;
  /** días de venta que cubre el stock de Full (disponible + en camino); null = sin ventas y sin stock */
  coberturaDias: number | null;
  /** ROAS actual del periodo (venta por ads ÷ gasto); null = sin gasto */
  roasActual: number | null;
  /** ROAS mínimo para no perder dinero (venta ÷ ganancia); null = sin costo capturado */
  roasEquilibrio: number | null;
  /** ACOS objetivo sano en % (= margen sobre la venta); null = sin costo */
  acosObjetivoPct: number | null;
  gastoAds: number;
  /** anuncios del modelo sobre los que se puede actuar */
  items: ItemDeModelo[];
  /** true cuando nace de una pausa hecha desde el ERP (recordatorio) */
  recordatorio: boolean;
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
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const pos = offset;
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

    total = pagina.paging?.total ?? offset + filas.length;
    offset += limite;
    if (!filas.length) break; // por si el paging viene mentiroso
  }

  return anuncios;
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
        estrategia: c.strategy ?? null,
      });
    }
    total = pagina.paging?.total ?? offset + filas.length;
    offset += limite;
    if (!filas.length) break;
  }

  return campanas;
}

interface IntentoEscritura {
  ruta: string;
  cuerpo: unknown;
  /** header Api-Version del intento (el API de ads enruta por versión) */
  version?: "1" | "2";
}

/**
 * Escribe probando formas candidatas EN ORDEN (cada una con SU cuerpo). Un
 * 404, 405 o 503 (rutas viejas apagadas o método no soportado) pasa a la
 * siguiente; cualquier otra respuesta viene del recurso real y se propaga
 * tal cual — un 400 con su mensaje es ORO: dice qué le falta al cuerpo. Si
 * ninguna contesta, el error resume qué dijo cada ruta para converger a la
 * buena de un vistazo. Reintentos cortos (1): esto corre detrás de un botón.
 */
async function escribirConRutas(
  cliente: MeliClient,
  intentos: IntentoEscritura[],
): Promise<void> {
  const resumen: string[] = [];
  for (const { ruta, cuerpo, version } of intentos) {
    try {
      await cliente.put(ruta, cuerpo, {
        headers: { "Api-Version": version ?? "2" },
        reintentos: 1,
      });
      return;
    } catch (err) {
      if (
        err instanceof MeliError &&
        (err.status === 404 || err.status === 405 || err.status === 503)
      ) {
        resumen.push(`${err.status} en ${ruta.split("?")[0]} (v${version ?? "2"})`);
        continue;
      }
      throw err;
    }
  }
  throw new MeliError(
    `MELI no aceptó el cambio por ninguna ruta: ${resumen.join(" · ")}`,
    404,
    null,
    intentos[0]?.ruta,
  );
}

/**
 * Pausa o enciende un anuncio (PUT, Api-Version 2). El recurso nuevo de
 * modificación no está documentado en abierto, así que se prueban las
 * formas plausibles: el anuncio DEBAJO de su campaña, la modificación en
 * LOTE sobre la colección de anuncios, y las formas por item (las por item
 * con advertiser ya contestaron 404 en MLM; quedan al final por si MELI
 * las enciende).
 */
export async function cambiarEstadoAnuncio(
  cliente: MeliClient,
  siteId: string,
  itemId: string,
  estado: "active" | "paused",
  campanaId?: string | null,
): Promise<void> {
  const adv = await resolverAdvertiser(cliente, siteId);
  const base = `/advertising/${adv.siteId}`;
  const conAdv = `${base}/advertisers/${adv.advertiserId}`;
  const porItem = { status: estado };
  const enLote = { ads: [{ item_id: itemId, status: estado }] };

  // La ruta real de CAMPAÑAS resultó ser /advertising/{site}/product_ads/
  // campaigns/{id} (sin advertiser): la de anuncios casi seguro es su
  // gemela ads/{item} — el 503 que daba era el servicio rechazando sin
  // permiso de escritura, no una ruta muerta. Después, el segmento items/
  // y las formas con Api-Version 1, de respaldo.
  const intentos: IntentoEscritura[] = [
    { ruta: `${base}/product_ads/ads/${itemId}`, cuerpo: porItem },
    { ruta: `${base}/product_ads/ads/${itemId}?channel=marketplace`, cuerpo: porItem },
  ];
  if (campanaId) {
    intentos.push(
      { ruta: `${base}/product_ads/campaigns/${campanaId}/items/${itemId}`, cuerpo: porItem },
      { ruta: `${conAdv}/product_ads/campaigns/${campanaId}/items/${itemId}`, cuerpo: porItem },
    );
  }
  intentos.push(
    { ruta: `${base}/product_ads/items/${itemId}`, cuerpo: porItem },
    { ruta: `${base}/product_ads/ads/${itemId}`, cuerpo: porItem, version: "1" },
    { ruta: `${conAdv}/product_ads/ads`, cuerpo: enLote },
  );
  await escribirConRutas(cliente, intentos);
}

/** Cambia presupuesto diario y/o ACOS objetivo de una campaña (PUT). */
export async function modificarCampanaAds(
  cliente: MeliClient,
  siteId: string,
  campanaId: string,
  cambios: { presupuesto?: number; acosObjetivo?: number },
): Promise<void> {
  const cuerpo: Record<string, number> = {};
  if (cambios.presupuesto != null) cuerpo.budget = cambios.presupuesto;
  if (cambios.acosObjetivo != null) cuerpo.acos_target = cambios.acosObjetivo;
  if (!Object.keys(cuerpo).length) return;

  const adv = await resolverAdvertiser(cliente, siteId);
  const base = `/advertising/${adv.siteId}`;
  // La ruta REAL, confirmada con la cuenta: el servicio mclics.campaigns
  // contesta en /advertising/{site}/product_ads/campaigns/{id} (sin
  // advertiser). Las demás quedan de respaldo por si MELI la mueve.
  const rutas = [
    `${base}/product_ads/campaigns/${campanaId}`,
    `${base}/advertisers/${adv.advertiserId}/product_ads/campaigns/${campanaId}`,
    `/advertising/product_ads/campaigns/${campanaId}`,
  ];
  await escribirConRutas(
    cliente,
    rutas.map((ruta) => ({ ruta, cuerpo })),
  );
}

/**
 * Traduce el error de escritura de Product Ads a una instrucción accionable.
 * El caso estrella: 401 "User does not have permission to write" — la app
 * de MELI tiene permiso de LECTURA de ads pero no de ESCRITURA; se arregla
 * en el DevCenter y reconectando, no en el código.
 */
export function mensajeErrorEscrituraAds(err: unknown): string {
  if (err instanceof MeliError && err.status === 401) {
    return (
      "MELI dice que la app no tiene permiso de ESCRITURA en Product Ads " +
      "(sí de lectura). En el DevCenter de Mercado Libre, en tu aplicación, " +
      "activa el scope de escritura (write) y el permiso de administración de " +
      "publicidad, y luego reconecta Mercado Libre en Ajustes para que el " +
      "token nuevo lo traiga."
    );
  }
  return err instanceof Error ? err.message : "MELI no aceptó el cambio.";
}

// ---------------------------------------------------------------------------
// Sugerencias (puro, para poder probarlo sin red)
// ---------------------------------------------------------------------------

/** Debajo de esto, la publicidad solo acelera el quiebre de stock. */
export const COBERTURA_CORTA_DIAS = 14;
/** Arriba de esto hay capital parado: espacio para invertir en ads. */
export const COBERTURA_LARGA_DIAS = 45;

const PRIORIDAD_ACCION: Record<AccionSugerida, number> = {
  pausar: 0,
  encender: 1,
  apagar: 2,
  bajar: 3,
  subir: 4,
  activar: 5,
};

/**
 * Cruza el panel de publicidad con el stock de Full y el margen para sugerir
 * ajustes. Reglas, en orden (una por modelo, gana la más urgente):
 *
 * 1. Anuncio activo con stock agotado o cobertura corta → PAUSAR: pagar por
 *    acelerar un quiebre es regalar el gasto (esas ventas caían solas).
 * 2. Anuncio pausado DESDE EL ERP cuyo stock ya se repuso → ENCENDER (el
 *    recordatorio que pediste al rellenar).
 * 3. Gasto sin una sola venta del modelo en el periodo → APAGAR.
 * 4. TACOS por arriba del margen → BAJAR: está comprando ventas con pérdida;
 *    se sugiere el ACOS objetivo sano (= margen) y el ROAS de equilibrio.
 * 5. Mucho stock y ads usando menos de la mitad del margen → SUBIR
 *    presupuesto: el costo real es el capital parado.
 * 6. Vende ≥1/día, stock de sobra y sin anuncio → ACTIVAR (candidato).
 */
export function armarSugerencias(opts: {
  filas: FilaPublicidad[];
  /** modelo → pares en Full (disponible + en camino) */
  stockDeModelo: Map<string, number>;
  /** días del periodo, para el ritmo diario */
  dias: number;
  itemsDeModelo: Map<string, ItemDeModelo[]>;
  /** item_ids pausados desde el ERP y aún sin reactivar */
  pausadosDesdeErp: Set<string>;
  /**
   * modelos que YA vendían antes del periodo. Un modelo que gasta sin vender
   * pero que nunca ha vendido es un LANZAMIENTO en rampa, no un anuncio
   * muerto: a ese no se le sugiere apagar (verificado con GT190).
   */
  modelosConHistoria?: Set<string>;
}): SugerenciaAds[] {
  const { filas, stockDeModelo, dias, itemsDeModelo, pausadosDesdeErp } = opts;
  const modelosConHistoria = opts.modelosConHistoria ?? null;
  const sugerencias: SugerenciaAds[] = [];
  const dEnteros = (x: number) => Math.round(x).toLocaleString("es-MX");

  for (const f of filas) {
    const stock = stockDeModelo.get(f.modelo) ?? 0;
    const ritmo = dias > 0 ? f.unidades / dias : 0;
    const cobertura = ritmo > 0 ? stock / ritmo : null;
    const items = itemsDeModelo.get(f.modelo) ?? [];
    const activos = items.filter((i) => i.estado !== "paused");
    const pausadosErp = items.filter(
      (i) => i.estado === "paused" && pausadosDesdeErp.has(i.itemId),
    );

    const margen = f.ganancia != null && f.importe > 0 ? f.ganancia / f.importe : null;
    const base = {
      modelo: f.modelo,
      coberturaDias: cobertura,
      roasActual: f.gastoAds > 0 && f.ventaAds > 0 ? f.ventaAds / f.gastoAds : null,
      roasEquilibrio: margen != null && margen > 0 ? 1 / margen : null,
      acosObjetivoPct: margen != null ? margen * 100 : null,
      gastoAds: f.gastoAds,
      items,
      recordatorio: false,
    };

    // 1. Stock agotado o por agotarse con el anuncio prendido.
    const sinStock = stock <= 0;
    const coberturaCorta = cobertura != null && cobertura < COBERTURA_CORTA_DIAS;
    if (activos.length > 0 && f.gastoAds > 0 && (sinStock || coberturaCorta)) {
      sugerencias.push({
        ...base,
        accion: "pausar",
        items: activos,
        razon: sinStock
          ? "Sin stock en Full: el anuncio está pagando por ventas que no puede surtir."
          : `Quedan ~${dEnteros(cobertura!)} días de stock (${dEnteros(stock)} pares): la publicidad solo acelera el quiebre; esas ventas caían solas.`,
      });
      continue;
    }

    // 2. Pausado desde el ERP y el stock ya volvió: el recordatorio.
    const stockRecuperado =
      cobertura != null ? cobertura >= COBERTURA_CORTA_DIAS : stock > 0;
    if (pausadosErp.length > 0 && stockRecuperado) {
      sugerencias.push({
        ...base,
        accion: "encender",
        items: pausadosErp,
        recordatorio: true,
        razon:
          cobertura != null
            ? `Lo pausaste por falta de stock y ya hay ~${dEnteros(cobertura)} días de cobertura (${dEnteros(stock)} pares): recuerda encenderlo.`
            : `Lo pausaste por falta de stock y ya hay ${dEnteros(stock)} pares en Full: recuerda encenderlo.`,
      });
      continue;
    }

    // 3. Gasta y no vende nada — SOLO si el modelo ya vendía antes: un
    // lanzamiento nuevo con ads y cero ventas está en rampa, no muerto.
    const yaVendia = modelosConHistoria == null || modelosConHistoria.has(f.modelo);
    if (f.gastoAds > 0 && f.unidades === 0 && yaVendia) {
      sugerencias.push({
        ...base,
        accion: "apagar",
        items: activos,
        razon: `Gastó $${dEnteros(f.gastoAds)} sin una sola venta del modelo en el periodo, y el modelo ya vendía antes: el anuncio no está trabajando.`,
      });
      continue;
    }

    // 4. Los ads se comen más que el margen.
    if (margen != null && f.tacos != null && f.gastoAds > 0 && f.tacos > margen) {
      sugerencias.push({
        ...base,
        accion: "bajar",
        razon: `Los ads se llevan el ${Math.round(f.tacos * 100)}% de la venta y el margen es ${Math.round(margen * 100)}%: está comprando ventas con pérdida. Sube el ROAS objetivo a ≥${base.roasEquilibrio!.toFixed(1)} (ACOS ≤${Math.round(margen * 100)}%).`,
      });
      continue;
    }

    // 5. Capital parado y margen de sobra.
    if (
      margen != null &&
      f.gastoAds > 0 &&
      f.tacos != null &&
      cobertura != null &&
      cobertura > COBERTURA_LARGA_DIAS &&
      f.tacos < margen / 2
    ) {
      sugerencias.push({
        ...base,
        accion: "subir",
        razon: `Hay ~${dEnteros(cobertura)} días de stock y los ads solo usan ${Math.round(f.tacos * 100)}% de un margen de ${Math.round(margen * 100)}%: espacio para subir presupuesto o aflojar el ACOS objetivo hasta ${Math.round(margen * 100)}%.`,
      });
      continue;
    }

    // 6. Vende solo, con stock de sobra y sin anuncio.
    if (
      f.gastoAds === 0 &&
      items.length === 0 &&
      ritmo >= 1 &&
      stock > 0 &&
      (cobertura == null || cobertura > COBERTURA_LARGA_DIAS)
    ) {
      sugerencias.push({
        ...base,
        accion: "activar",
        razon: `Vende ~${dEnteros(ritmo)} al día sin publicidad y hay stock de sobra: candidato a Product Ads.`,
      });
    }
  }

  const ordenadas = sugerencias.sort(
    (a, b) =>
      PRIORIDAD_ACCION[a.accion] - PRIORIDAD_ACCION[b.accion] ||
      b.gastoAds - a.gastoAds,
  );
  // Los candidatos a activar pueden ser docenas: solo los 5 que más venden.
  let candidatos = 0;
  return ordenadas.filter((s) => s.accion !== "activar" || ++candidatos <= 5);
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
}): Publicidad {
  const { anuncios, ventas, modelosDeItem, modeloDeSku, costoDeModelo, errorAds } = opts;

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
    // Neto REAL de Mercado Pago cuando ya llegó; si no (o si el cache trae un
    // 0 no creíble), la aproximación importe − comisión, igual que el monitor.
    a.neto +=
      v.neto != null && Number(v.neto) > 0
        ? Number(v.neto)
        : (v.importe ?? 0) - (v.comision ?? 0);
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
    // Las llena la carga completa (necesitan stock, campañas y pausas).
    sugerencias: [],
    campanas: [],
    itemsDeModelo: new Map(),
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
    } catch {
      try {
        return await traerTodo<VentaDiaria>(
          db,
          "ventas_diarias",
          "sku, fecha, unidades, importe, comision",
          filtro,
        );
      } catch {
        return traerTodo<VentaDiaria>(db, "ventas_diarias", "sku, fecha, unidades, importe", filtro);
      }
    }
  };

  const [ventas, skus, config, stock, pausas, cliente] = await Promise.all([
    leerVentas(),
    traerTodo<{ sku: string; modelo: string | null; item_id: string | null }>(
      db,
      "skus",
      "sku, modelo, item_id",
      (q) => q.eq("account_id", cuenta.id).eq("activo", true),
    ),
    configPorProducto(db, cuenta.id),
    // El stock de Full (disponible + en camino), para las sugerencias.
    traerTodo<{ sku: string; disponible: number | null; en_transferencia: number | null }>(
      db,
      "stock_full",
      "sku, disponible, en_transferencia",
      (q) => q.eq("account_id", cuenta.id),
    ).catch(() => []),
    // Anuncios pausados desde el ERP y aún sin reactivar (los recordatorios).
    // Si la migración no ha corrido, simplemente no hay recordatorios.
    Promise.resolve(
      db
        .from("publicidad_pausas")
        .select("item_id")
        .eq("account_id", cuenta.id)
        .is("reactivado_en", null),
    )
      .then((x: any) => (x?.data ?? []) as { item_id: string }[])
      .catch(() => [] as { item_id: string }[]),
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
  let campanasBase: Omit<CampanaAds, "gasto" | "anuncios">[] = [];
  let errorAds: string | null = null;
  if (!cliente) {
    errorAds =
      "No se pudieron leer los tokens de MELI: revisa que la cuenta esté conectada en Ajustes.";
  } else {
    try {
      const adv = await resolverAdvertiser(cliente, cuenta.site_id);
      // Las campañas son lo editable; si su lectura falla, el panel de
      // anuncios sigue sirviendo (por eso se tolera aparte).
      [anuncios, campanasBase] = await Promise.all([
        traerAnunciosAds(cliente, adv, r),
        traerCampanasAds(cliente, adv).catch(
          () => [] as Omit<CampanaAds, "gasto" | "anuncios">[],
        ),
      ]);
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
  const ventasPeriodo = ventas.filter((v) => v.fecha >= r.desde);
  const modelosConHistoria = new Set<string>();
  for (const v of ventas) {
    if (v.fecha < r.desde && (v.unidades ?? 0) > 0) {
      modelosConHistoria.add(modeloDeSku.get(v.sku) ?? (v.sku.split("-")[0] || v.sku));
    }
  }

  const datos = armarPublicidad({
    anuncios,
    ventas: ventasPeriodo,
    modelosDeItem,
    modeloDeSku,
    costoDeModelo,
    errorAds,
  });

  // --- Anuncios por modelo, para los botones de pausar/encender ------------
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
  datos.itemsDeModelo = itemsDeModelo;

  // --- Campañas con su gasto del periodo -----------------------------------
  const gastoPorCampana = new Map<string, { gasto: number; anuncios: number }>();
  for (const an of anuncios) {
    if (!an.campanaId) continue;
    const g = gastoPorCampana.get(an.campanaId) ?? { gasto: 0, anuncios: 0 };
    g.gasto += an.gasto;
    g.anuncios += 1;
    gastoPorCampana.set(an.campanaId, g);
  }
  datos.campanas = campanasBase
    .map((c) => ({
      ...c,
      gasto: gastoPorCampana.get(c.id)?.gasto ?? 0,
      anuncios: gastoPorCampana.get(c.id)?.anuncios ?? 0,
    }))
    .sort((a, b) => b.gasto - a.gasto);

  // --- Sugerencias: publicidad × stock × margen ----------------------------
  const stockDeModelo = new Map<string, number>();
  for (const s of stock) {
    const modelo = modeloDeSku.get(s.sku);
    if (!modelo) continue;
    stockDeModelo.set(
      modelo,
      (stockDeModelo.get(modelo) ?? 0) + (s.disponible ?? 0) + (s.en_transferencia ?? 0),
    );
  }
  datos.sugerencias = armarSugerencias({
    filas: datos.filas,
    stockDeModelo,
    dias: diasDeRango(r),
    itemsDeModelo,
    pausadosDesdeErp: new Set(pausas.map((p) => p.item_id)),
    modelosConHistoria,
  });

  // Un panel con error de ads no se cachea: al reintentar (p. ej. ya con el
  // permiso otorgado) debe volver a preguntar, no repetir el error 10 minutos.
  if (!errorAds) cachePublicidad.set(claveCache, { en: Date.now(), datos });
  return datos;
}
