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
import { normalizarRango, type RangoFechas } from "./ventas-monitor";

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
    metrics?: Record<string, number | null>;
  }[];
  paging?: { total?: number; offset?: number; limit?: number };
}

/**
 * Baja todos los anuncios del periodo con sus métricas. Dos llamadas al API
 * de publicidad: el advertiser de la cuenta (Api-Version 1) y luego los
 * anuncios paginados (Api-Version 2). Los errores NO se tragan: el panel
 * muestra el motivo tal cual (el más común va a ser que a la app le falte el
 * permiso de Product Ads y haya que reconectar MELI).
 */
export async function traerAnunciosAds(
  cliente: MeliClient,
  siteId: string,
  rango: RangoFechas,
): Promise<AnuncioAds[]> {
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

  // La ruta actual lleva el sitio en medio (advertising/MLM/advertisers/…);
  // la vieja, sin sitio, se queda como respaldo por si algún sitio aún la
  // sirve. Se prueba en orden y gana la primera que no dé 404.
  const sitio = advertiser.site_id ?? siteId;
  const rutas = [
    `/advertising/${sitio}/advertisers/${advertiser.advertiser_id}/product_ads/ads/search`,
    `/advertising/advertisers/${advertiser.advertiser_id}/product_ads/ads/search`,
  ];
  let ruta = rutas[0];

  const pedirPagina = async (offset: number): Promise<RespuestaAds> => {
    let ultimo404: MeliError | null = null;
    for (const candidata of rutas.slice(rutas.indexOf(ruta))) {
      try {
        const pagina = await cliente.get<RespuestaAds>(
          candidata,
          {
            limit: 50, // el máximo que acepta el API
            offset,
            date_from: rango.desde,
            date_to: rango.hasta,
            metrics: METRICAS_ADS,
          },
          { headers: { "Api-Version": "2" }, reintentos: 2 },
        );
        ruta = candidata; // esta sirve: las páginas que siguen van directo
        return pagina;
      } catch (err) {
        if (err instanceof MeliError && err.status === 404) {
          ultimo404 = err;
          continue;
        }
        throw err;
      }
    }
    throw ultimo404 ?? new MeliError("Sin ruta de anuncios que responda.", 404, null, ruta);
  };

  const anuncios: AnuncioAds[] = [];
  const limite = 50;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const pagina = await pedirPagina(offset);

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
      });
    }

    total = pagina.paging?.total ?? offset + filas.length;
    offset += limite;
    if (!filas.length) break; // por si el paging viene mentiroso
  }

  return anuncios;
}

// ---------------------------------------------------------------------------
// Armado del panel (puro, para poder probarlo sin red)
// ---------------------------------------------------------------------------

export function armarPublicidad(opts: {
  anuncios: AnuncioAds[];
  /** ventas del periodo, YA filtradas al rango */
  ventas: VentaDiaria[];
  /** item_id → modelo, del catálogo */
  modeloDeItem: Map<string, string>;
  /** sku → modelo, del catálogo */
  modeloDeSku: Map<string, string>;
  /** modelo → costo capturado (MXN), de productos_config */
  costoDeModelo: Map<string, number | null>;
  errorAds: string | null;
}): Publicidad {
  const { anuncios, ventas, modeloDeItem, modeloDeSku, costoDeModelo, errorAds } = opts;

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
    const modelo = modeloDeItem.get(an.itemId);
    // Un anuncio sin actividad en el periodo no aporta nada al panel.
    const conActividad =
      an.gasto > 0 || an.clicks > 0 || an.impresiones > 0 || an.ventaAds > 0;
    if (!conActividad) continue;
    if (!modelo) {
      sinAmarre.gasto += an.gasto;
      sinAmarre.anuncios += 1;
      continue;
    }
    const a = de(modelo);
    a.anuncios += 1;
    a.gastoAds += an.gasto;
    a.ventaAds += an.ventaAds;
    a.unidadesAds += an.unidadesAds;
    a.clicks += an.clicks;
    a.impresiones += an.impresiones;
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
    // Lo caro en ads arriba; entre iguales (p. ej. sin ads), el que más vende.
    .sort((x, y) => y.gastoAds - x.gastoAds || y.unidades - x.unidades);

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

export async function cargarPublicidad(
  db: DB,
  cuenta: { id: string; site_id: string },
  rango?: RangoFechas,
): Promise<Publicidad> {
  const r = rango ?? normalizarRango();
  const claveCache = `${cuenta.id}|${r.desde}|${r.hasta}`;
  const guardado = cachePublicidad.get(claveCache);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_ADS_MS) return guardado.datos;

  // Igual que el monitor: `comision` y `neto` pueden no existir todavía.
  const leerVentas = async (): Promise<VentaDiaria[]> => {
    const filtro = (q: any) =>
      q.eq("account_id", cuenta.id).gte("fecha", r.desde).lte("fecha", r.hasta);
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

  const [ventas, skus, config, cliente] = await Promise.all([
    leerVentas(),
    traerTodo<{ sku: string; modelo: string | null; item_id: string | null }>(
      db,
      "skus",
      "sku, modelo, item_id",
      (q) => q.eq("account_id", cuenta.id).eq("activo", true),
    ),
    configPorProducto(db, cuenta.id),
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
  const modeloDeItem = new Map<string, string>();
  for (const s of skus) {
    const modelo = s.modelo ?? (s.sku.split("-")[0] || s.sku);
    modeloDeSku.set(s.sku, modelo);
    if (s.item_id) modeloDeItem.set(s.item_id, modelo);
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
      anuncios = await traerAnunciosAds(cliente, cuenta.site_id, r);
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

  const datos = armarPublicidad({
    anuncios,
    ventas,
    modeloDeItem,
    modeloDeSku,
    costoDeModelo,
    errorAds,
  });

  // Un panel con error de ads no se cachea: al reintentar (p. ej. ya con el
  // permiso otorgado) debe volver a preguntar, no repetir el error 10 minutos.
  if (!errorAds) cachePublicidad.set(claveCache, { en: Date.now(), datos });
  return datos;
}
