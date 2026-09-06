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
  /** qué hacer hoy con cada modelo, para ejecutarlo a mano en MELI */
  recomendaciones: RecomendacionAds[];
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


// ---------------------------------------------------------------------------
// Recomendaciones (puro, para poder probarlo sin red)
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
 * Cruza el panel de publicidad con el stock de Full y el margen para decir
 * qué hacer con cada modelo. UNA recomendación por modelo, la más urgente:
 *
 * 1. Anuncio prendido con stock agotado o por agotarse -> PAUSAR: pagar por
 *    acelerar un quiebre es regalar el gasto (esas ventas caían solas).
 * 2. Anuncio pausado con el stock ya repuesto -> ENCENDER.
 * 3. Gasta sin vender, en un modelo que YA vendía antes -> APAGAR (un
 *    lanzamiento nuevo está en rampa, a ese no se le dice nada).
 * 4. Los ads se llevan más que el margen -> BAJAR, con el ACOS objetivo sano.
 * 5. Mucho stock y ads usando menos de la mitad del margen -> SUBIR.
 * 6. Vende solo, con stock de sobra y sin anuncio -> ACTIVAR (candidato).
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
}): RecomendacionAds[] {
  const { filas, stockDeModelo, dias, itemsDeModelo } = opts;
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

  for (const f of filas) {
    const stock = stockDeModelo.get(f.modelo) ?? 0;
    const ritmo = dias > 0 ? f.unidades / dias : 0;
    const cobertura = ritmo > 0 ? stock / ritmo : null;
    const items = itemsDeModelo.get(f.modelo) ?? [];
    const activos = items.filter((i) => i.estado !== "paused");
    const pausados = items.filter((i) => i.estado === "paused");
    const margen = f.ganancia != null && f.importe > 0 ? f.ganancia / f.importe : null;
    const cobertext =
      cobertura != null
        ? `${num(cobertura)} días de stock (${num(stock)} pares)`
        : `${num(stock)} pares en Full`;

    // 1. Stock agotado o por agotarse con el anuncio prendido.
    const sinStock = stock <= 0;
    const coberturaCorta = cobertura != null && cobertura < COBERTURA_CORTA_DIAS;
    if (activos.length > 0 && f.gastoAds > 0 && (sinStock || coberturaCorta)) {
      agregar(
        {
          modelo: f.modelo,
          accion: "pausar",
          queHacer: "Pausar el anuncio",
          razon: sinStock
            ? `Sin stock en Full y lleva $${num(f.gastoAds)} gastados: está pagando ventas que no puede surtir.`
            : `Quedan ${cobertext} y ya lleva $${num(f.gastoAds)} en ads: esas ventas caen solas, la publicidad solo acelera el quiebre.`,
        },
        f.gastoAds,
      );
      continue;
    }

    // 2. Anuncio pausado con el stock ya repuesto.
    const stockRecuperado =
      cobertura != null ? cobertura >= COBERTURA_CORTA_DIAS : stock > 0;
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

    // 4. Los ads se comen más que el margen.
    if (margen != null && f.tacos != null && f.gastoAds > 0 && f.tacos > margen) {
      const acosSano = Math.round(margen * 100);
      agregar(
        {
          modelo: f.modelo,
          accion: "bajar",
          queHacer: `Bajar el gasto: ACOS objetivo a ${acosSano}% (ROAS ${(1 / margen).toFixed(1)})`,
          razon: `Los ads se llevan ${pct(f.tacos)} de la venta y el margen es solo ${pct(margen)}: cada venta por publicidad sale con pérdida.`,
        },
        f.gastoAds,
      );
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
      agregar(
        {
          modelo: f.modelo,
          accion: "subir",
          queHacer: `Subir el presupuesto (hasta ${Math.round(margen * 100)}% de ACOS)`,
          razon: `Hay ${cobertext} parados y los ads solo usan ${pct(f.tacos)} de un margen de ${pct(margen)}: cabe más inversión sin perder.`,
        },
        f.importe,
      );
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
      agregar(
        {
          modelo: f.modelo,
          accion: "activar",
          queHacer: "Crear anuncio (candidato)",
          razon: `Vende ${num(ritmo)} al día sin publicidad y hay ${cobertext}: vale la pena probarlo en Product Ads.`,
        },
        f.importe,
      );
    }
  }

  // Los candidatos a activar pueden ser docenas: se queda con los 5 que más
  // venden ANTES de ordenar, para que el recorte no dependa del alfabeto.
  const mejoresCandidatos = new Set(
    recomendaciones
      .filter((r) => r.accion === "activar")
      .sort((a, b) => (peso.get(b) ?? 0) - (peso.get(a) ?? 0))
      .slice(0, 5),
  );

  return recomendaciones
    .filter((r) => r.accion !== "activar" || mejoresCandidatos.has(r))
    // En orden alfabético de modelo, como el resto de las tablas: la lista se
    // recorre buscando el modelo, no leyendo un ranking.
    .sort(
      (a, b) =>
        a.modelo.localeCompare(b.modelo, "es") ||
        PRIORIDAD_ACCION[a.accion] - PRIORIDAD_ACCION[b.accion],
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

  const [ventas, skus, config, stock, cliente] = await Promise.all([
    leerVentas(),
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
    ).catch(() => []),
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
  let errorAds: string | null = null;
  if (!cliente) {
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
  datos.recomendaciones = armarRecomendaciones({
    filas: datos.filas,
    stockDeModelo,
    dias: diasDeRango(r),
    itemsDeModelo,
    modelosConHistoria,
  });

  // Un panel con error de ads no se cachea: al reintentar (p. ej. ya con el
  // permiso otorgado) debe volver a preguntar, no repetir el error 10 minutos.
  if (!errorAds) cachePublicidad.set(claveCache, { en: Date.now(), datos });
  return datos;
}
