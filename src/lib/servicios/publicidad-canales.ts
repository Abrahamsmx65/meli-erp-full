/**
 * Recomendaciones de publicidad de AMAZON y de FUNDAS (MELI de YAPANIZCEL),
 * con el MISMO motor que las de calzado (`armarRecomendaciones`), para el
 * correo de publicidad (dueño, 11-oct-2026: «hazlo en los 3: Amazon, MELI
 * calzado y MELI fundas»).
 *
 * - Amazon: el gasto, la venta y el neto salen de SKU Economics por SKU
 *   (`amazon_economia_por_sku`, mismos días para todo: la economía llega con
 *   unos días de retraso), el margen antes de publicidad = neto + publicidad
 *   − costo, y el stock es el de FBA (disponible + lo que ya va en camino).
 *   La historia es la de toda la vida (`amazon_historia_sku`), no 60 días.
 *   Amazon no dice por aquí qué anuncio está pausado: un modelo con gasto
 *   cuenta como anunciado y uno sin gasto, como sin anuncio.
 * - Fundas: mismo API de Product Ads que el calzado, por DISEÑO; ventas de
 *   `yz_ventas_resumen` (neto real), stock de `yz_stock_full`. A Full se le
 *   manda para 15 días, así que la cobertura corta es de 5 días y la larga
 *   de 30 (no los 14/45 del calzado: casi toda funda saldría «por agotarse»).
 */
import { traerRpcTodo, traerTodo, type DB } from "../datos/repos";
import { MeliError } from "../meli/client";
import { clienteAdmin } from "../supabase/admin";
import { cuentaActiva, clienteDeCuenta } from "../yapanizcel/cuenta";
import { rpcTodo, todo } from "../yapanizcel/db";
import { desglosar } from "../yapanizcel/sku";
import { cuentaAmazon } from "./amazon";
import { costoDeSkuUnificado, mapaCostosUnificado, modeloUnificado } from "./costos-unificados";
import {
  armarPublicidad,
  armarRecomendaciones,
  armarDependencias,
  presupuestoPorModelo,
  roasObjetivoPorModelo,
  resolverAdvertiser,
  traerCampanasAds,
  traerAnunciosAds,
  type FilaPublicidad,
  type ItemDeModelo,
  type DependenciaAds,
  type RecomendacionAds,
} from "./publicidad";
import type { RangoFechas } from "./ventas-monitor";

/** Lo que el correo necesita de cada canal. */
export interface PublicidadCanal {
  recomendaciones: RecomendacionAds[];
  /** todas las campañas con gasto y qué tanto depende cada modelo (MELI) */
  dependencias?: DependenciaAds[];
  gastoAds: number;
  /** gasto ÷ venta; null = sin venta */
  tacos: number | null;
  /** hasta qué día llegan los datos (Amazon va unos días atrás) */
  hasta: string | null;
  avisos: string[];
  /** el canal no se pudo leer: no se da nada por resuelto */
  error?: boolean;
}

const diasEntre = (desde: string, hasta: string) =>
  Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1);

const restarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Amazon
// ---------------------------------------------------------------------------

export interface EconomiaAmazon {
  seller_sku: string;
  unidades: number | string | null;
  ventas: number | string | null;
  publicidad: number | string | null;
  neto: number | string | null;
  ultima_fecha: string | null;
}

/**
 * Filas por modelo desde la economía de Amazon (puro). La ganancia es ANTES
 * de publicidad (neto + publicidad − costo), igual que la del calzado, para
 * que «los ads se comen el margen» se mida igual en los dos lados.
 */
export function filasAmazon(economia: EconomiaAmazon[], costoDeSku: (sku: string) => number | null): FilaPublicidad[] {
  interface Acum { unidades: number; ventas: number; publicidad: number; ganancia: number; conCosto: boolean; sinCosto: boolean }
  const por = new Map<string, Acum>();
  for (const e of economia) {
    const sku = String(e.seller_sku ?? "");
    const modelo = modeloUnificado(sku);
    if (!modelo) continue;
    const unidades = Number(e.unidades) || 0;
    const ventas = Number(e.ventas) || 0;
    const publicidad = Number(e.publicidad) || 0;
    const neto = Number(e.neto) || 0;
    if (!unidades && !ventas && !publicidad) continue;
    const a = por.get(modelo) ?? { unidades: 0, ventas: 0, publicidad: 0, ganancia: 0, conCosto: false, sinCosto: false };
    a.unidades += unidades;
    a.ventas += ventas;
    a.publicidad += publicidad;
    const costo = costoDeSku(sku);
    if (unidades > 0) {
      if (costo == null) a.sinCosto = true;
      else {
        a.conCosto = true;
        a.ganancia += neto + publicidad - costo * unidades;
      }
    }
    por.set(modelo, a);
  }
  return [...por.entries()].map(([modelo, a]) => {
    // Un modelo con piezas sin costo no tiene margen confiable: no se juzga.
    const ganancia = a.conCosto && !a.sinCosto ? a.ganancia : null;
    return {
      modelo,
      anuncios: a.publicidad > 0 ? 1 : 0,
      unidades: a.unidades,
      importe: a.ventas,
      ganancia,
      gastoAds: a.publicidad,
      ventaAds: 0,
      unidadesAds: 0,
      clicks: 0,
      impresiones: 0,
      costoPorUnidad: a.unidades > 0 ? a.publicidad / a.unidades : null,
      tacos: a.ventas > 0 ? a.publicidad / a.ventas : null,
      gananciaNeta: ganancia != null ? ganancia - a.publicidad : null,
    };
  });
}

/** Un modelo con gasto cuenta como anunciado (Amazon no dice si está pausado). */
export function itemsDeGasto(filas: FilaPublicidad[]): Map<string, ItemDeModelo[]> {
  const m = new Map<string, ItemDeModelo[]>();
  for (const f of filas) {
    if (f.gastoAds > 0) m.set(f.modelo, [{ itemId: f.modelo, titulo: null, estado: "active", campanaId: null, compartido: false }]);
  }
  return m;
}

export async function publicidadAmazon(db: DB, meliAccountId: string | null, rango: RangoFechas): Promise<PublicidadCanal> {
  const avisos: string[] = [];
  const cuenta = await cuentaAmazon(db);
  if (!cuenta) return { recomendaciones: [], gastoAds: 0, tacos: null, hasta: null, avisos: ["No hay cuenta de Amazon conectada."], error: true };

  const [economia, previa, inventario, costos] = await Promise.all([
    traerRpcTodo<EconomiaAmazon>(db, "amazon_economia_por_sku", { p_account: cuenta.id, p_desde: rango.desde, p_hasta: rango.hasta }),
    // Toda la historia (primera venta por SKU): un modelo que nunca vendió
    // antes del periodo es nuevo o sin venta, y a ese se le pide anuncio.
    traerRpcTodo<{ seller_sku: string; primera_venta: string | null }>(db, "amazon_historia_sku", { p_account: cuenta.id }),
    traerTodo<{ seller_sku: string; disponible: number | null; entrante_enviado: number | null; entrante_recibiendo: number | null; en_transferencia: number | null }>(
      db,
      "amazon_inventario",
      "seller_sku, disponible, entrante_enviado, entrante_recibiendo, en_transferencia",
      (q) => q.eq("account_id", cuenta.id),
    )
      .then((filas) => ({ filas, error: null as string | null }))
      .catch((err) => ({ filas: [], error: (err as Error).message })),
    mapaCostosUnificado(db, { meliAccountId }),
  ]);
  if (economia.error) {
    return { recomendaciones: [], gastoAds: 0, tacos: null, hasta: null, avisos: [`No se pudo leer SKU Economics de Amazon: ${economia.error}`], error: true };
  }
  if (previa.error) avisos.push(`No se pudo leer la historia de Amazon (${previa.error}): sin ella no se distingue un producto nuevo de uno viejo.`);
  if (inventario.error) avisos.push(`No se pudo leer el inventario de FBA (${inventario.error}): sin stock no hay recomendaciones.`);

  const filas = filasAmazon(economia.filas, (sku) => costoDeSkuUnificado(sku, costos));
  let hasta: string | null = null;
  for (const e of economia.filas) if (e.ultima_fecha && (!hasta || e.ultima_fecha > hasta)) hasta = e.ultima_fecha;
  if (!hasta) {
    avisos.push("SKU Economics todavía no trae datos de estos días (llega con unos días de retraso).");
    return { recomendaciones: [], gastoAds: 0, tacos: null, hasta: null, avisos };
  }

  const historia = previa.error
    ? undefined
    : new Set(previa.filas.filter((h) => h.primera_venta != null && h.primera_venta < rango.desde).map((h) => modeloUnificado(String(h.seller_sku))));
  const stock = new Map<string, number>();
  for (const i of inventario.filas) {
    const modelo = modeloUnificado(i.seller_sku);
    if (!modelo) continue;
    const piezas = (i.disponible ?? 0) + (i.entrante_enviado ?? 0) + (i.entrante_recibiendo ?? 0) + (i.en_transferencia ?? 0);
    stock.set(modelo, (stock.get(modelo) ?? 0) + piezas);
  }

  const gastoAds = filas.reduce((s, f) => s + f.gastoAds, 0);
  const ventas = filas.reduce((s, f) => s + f.importe, 0);
  return {
    recomendaciones: inventario.error
      ? []
      : armarRecomendaciones({
          filas,
          stockDeModelo: stock,
          dias: diasEntre(rango.desde, hasta),
          itemsDeModelo: itemsDeGasto(filas),
          modelosConHistoria: historia,
          almacen: "FBA",
          unidad: "piezas",
          consola: "Sponsored Products",
        }),
    gastoAds,
    tacos: ventas > 0 ? gastoAds / ventas : null,
    hasta,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Fundas (MELI de YAPANIZCEL)
// ---------------------------------------------------------------------------

/** Fundas: a Full se manda para 15 días, la cobertura se mide con su vara. */
export const COBERTURA_CORTA_FUNDAS = 5;
export const COBERTURA_LARGA_FUNDAS = 30;

interface ResumenYz {
  sku: string;
  unidades: number | string;
  importe: number | string;
  neto: number | string;
}

export async function publicidadFundas(db: DB, rango: RangoFechas): Promise<PublicidadCanal> {
  const avisos: string[] = [];
  const cuenta = await cuentaActiva(db);
  if (!cuenta) return { recomendaciones: [], gastoAds: 0, tacos: null, hasta: null, avisos: ["No hay cuenta de fundas conectada."], error: true };

  const disenoDe = (sku: string, diseno?: string | null) => (diseno || desglosar(sku).diseno || sku).toUpperCase();
  const [skus, periodo, previa, stock, costos, bodegaYz] = await Promise.all([
    todo<{ sku: string; item_id: string | null; diseno: string | null }>(db, "yz_skus", "sku, item_id, diseno", (q) => q.eq("account_id", cuenta.id)),
    rpcTodo<ResumenYz>(db, "yz_ventas_resumen", { p_account: cuenta.id, p_desde: rango.desde, p_hasta: rango.hasta }, ["sku"]),
    rpcTodo<ResumenYz>(db, "yz_ventas_resumen", { p_account: cuenta.id, p_desde: restarDias(rango.desde, 60), p_hasta: restarDias(rango.desde, 1) }, ["sku"]),
    todo<{ sku: string; disponible: number | null; en_transferencia: number | null }>(db, "yz_stock_full", "sku, disponible, en_transferencia", (q) => q.eq("account_id", cuenta.id)),
    mapaCostosUnificado(db, { yzAccountId: cuenta.id }),
    // La bodega (el Sheet de fundas): con piezas para reponer Full no se pausa.
    todo<{ sku_bodega: string; diseno: string | null; cantidad: number | null }>(db, "yz_inventario", "sku_bodega, diseno, cantidad", (q) => q.eq("account_id", cuenta.id)).catch((err) => {
      avisos.push(`No se pudo leer la bodega de fundas: ${(err as Error).message}. «Pausar» solo mira el stock de Full.`);
      return null;
    }),
  ]);

  const modeloDeSku = new Map<string, string>();
  const modelosDeItem = new Map<string, string[]>();
  for (const s of skus) {
    const d = disenoDe(s.sku, s.diseno);
    modeloDeSku.set(s.sku, d);
    if (!s.item_id) continue;
    const lista = modelosDeItem.get(s.item_id);
    if (!lista) modelosDeItem.set(s.item_id, [d]);
    else if (!lista.includes(d)) lista.push(d);
  }
  const de = (sku: string) => modeloDeSku.get(sku) ?? disenoDe(sku);

  const costoDeModelo = new Map<string, number | null>();
  for (const f of periodo) {
    const d = de(f.sku);
    if (costoDeModelo.get(d) != null) continue;
    costoDeModelo.set(d, costoDeSkuUnificado(f.sku, costos));
  }

  let anuncios: Awaited<ReturnType<typeof traerAnunciosAds>> = [];
  let errorAds: string | null = null;
  let campanas: Awaited<ReturnType<typeof traerCampanasAds>> | null = null;
  try {
    const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
    const adv = await resolverAdvertiser(cliente, cuenta.site_id);
    anuncios = await traerAnunciosAds(cliente, adv, rango);
    // El presupuesto de HOY: lo ya subido o bajado no se vuelve a pedir.
    campanas = await traerCampanasAds(cliente, adv).catch((err) => {
      avisos.push(`No se pudo leer el presupuesto de las campañas de fundas: ${(err as Error).message}.`);
      return null;
    });
  } catch (err) {
    errorAds =
      err instanceof MeliError && err.status === 403
        ? "MELI negó el acceso a Product Ads de fundas (403): reconecta la cuenta de fundas en Ajustes."
        : `No se pudo leer Product Ads de fundas: ${(err as Error).message}`;
  }
  if (errorAds) return { recomendaciones: [], gastoAds: 0, tacos: null, hasta: rango.hasta, avisos: [errorAds], error: true };

  const p = armarPublicidad({
    anuncios,
    // Solo el neto REAL: la venta sin depósito leído aporta cero al neto.
    ventas: periodo.map((f) => ({ sku: f.sku, fecha: rango.desde, unidades: Number(f.unidades) || 0, importe: Number(f.importe) || 0, comision: null, neto: Number(f.neto) || 0 })),
    modelosDeItem,
    modeloDeSku,
    costoDeModelo,
    errorAds: null,
  });

  const itemsDeModelo = new Map<string, ItemDeModelo[]>();
  for (const an of anuncios) {
    const modelos = modelosDeItem.get(an.itemId) ?? [];
    for (const m of modelos) {
      const lista = itemsDeModelo.get(m) ?? [];
      lista.push({ itemId: an.itemId, titulo: an.titulo, estado: an.estado, campanaId: an.campanaId, compartido: modelos.length > 1 });
      itemsDeModelo.set(m, lista);
    }
  }
  const stockDeModelo = new Map<string, number>();
  for (const s of stock) {
    const d = de(s.sku);
    stockDeModelo.set(d, (stockDeModelo.get(d) ?? 0) + (s.disponible ?? 0) + (s.en_transferencia ?? 0));
  }
  const historia = new Set(previa.filter((f) => (Number(f.unidades) || 0) > 0).map((f) => de(f.sku)));
  // Piezas al día por diseño en los 60 días anteriores (producto posicionado).
  const ritmoPrevioDeModelo = new Map<string, number>();
  for (const f of previa) {
    const d = de(f.sku);
    ritmoPrevioDeModelo.set(d, (ritmoPrevioDeModelo.get(d) ?? 0) + (Number(f.unidades) || 0) / 60);
  }
  if (p.sinAmarre.gasto > 0) avisos.push(`$${Math.round(p.sinAmarre.gasto).toLocaleString("es-MX")} de gasto en ${p.sinAmarre.anuncios} anuncio(s) de fundas sin diseño amarrado.`);

  const presupuestoDeModelo = campanas ? presupuestoPorModelo(campanas, itemsDeModelo) : undefined;
  const roasObjetivoDeModelo = campanas ? roasObjetivoPorModelo(campanas, itemsDeModelo) : undefined;
  const stockBodegaDeModelo = bodegaYz ? new Map<string, number>() : undefined;
  for (const b of bodegaYz ?? []) {
    const d = disenoDe(b.sku_bodega, b.diseno);
    stockBodegaDeModelo!.set(d, (stockBodegaDeModelo!.get(d) ?? 0) + (Number(b.cantidad) || 0));
  }
  return {
    dependencias: armarDependencias({
      filas: p.filas,
      dias: diasEntre(rango.desde, rango.hasta),
      itemsDeModelo,
      nombresCampana: campanas ? new Map(campanas.map((c) => [c.id, c.nombre])) : undefined,
      presupuestoDeModelo,
      ritmoPrevioDeModelo,
      roasObjetivoDeModelo,
    }),
    recomendaciones: armarRecomendaciones({
      filas: p.filas,
      stockDeModelo,
      dias: diasEntre(rango.desde, rango.hasta),
      itemsDeModelo,
      modelosConHistoria: historia,
      unidad: "piezas",
      coberturaCorta: COBERTURA_CORTA_FUNDAS,
      coberturaLarga: COBERTURA_LARGA_FUNDAS,
      presupuestoDeModelo,
      ritmoPrevioDeModelo,
      stockBodegaDeModelo,
      roasObjetivoDeModelo,
    }),
    gastoAds: p.totales.gastoAds,
    tacos: p.totales.tacos,
    hasta: rango.hasta,
    avisos,
  };
}
