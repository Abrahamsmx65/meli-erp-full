/**
 * Ofertas relámpago de TikTok desde el panel: lo que se lee y escribe en la
 * base y en el API de promociones. Las reglas puras viven en
 * `tiktok/promociones.ts`.
 *
 *   · `modelosParaOferta`: los modelos ACTIVOS en TikTok con su producto, sus
 *     variantes y los tres precios de Precios para TikTok (live, normal,
 *     campaña), la misma cuenta que el catálogo de creadores.
 *   · `listarOfertas`: las actividades de la tienda que TikTok tiene (en
 *     curso, programadas, borradores y las últimas vencidas), masticadas 2
 *     minutos, más la constancia local de lo que el ERP creó.
 *   · `crearOferta`: crea la actividad FLASHSALE por variante y le mete los
 *     modelos con su precio y sus topes, por lotes de 300 variantes; deja la
 *     constancia en `tiktok_promociones` con lo que contestó TikTok.
 */
import { conCandado, RecursoOcupadoError, traerTodo, type DB } from "../datos/repos";
import { preciosTikTokPorModelo, type PreciosTikTok } from "../tienda/catalogo-amazon";
import { fechaMx } from "./ventas-monitor";
import { conCacheApp, invalidarApp } from "./cache-app";
import { clienteDeCuenta } from "./tiktok";
import { actividad, actualizarActividad, actualizarProductosDeActividad, buscarActividades, crearActividad, desactivarActividad } from "../tiktok/api";
import {
  finDeLaViva,
  finExtendido,
  explicarErrorDeCiclica,
  cuerpoDeActividad,
  HORAS_POR_OMISION,
  lotesDeProductos,
  MINUTOS_DE_ARRANQUE,
  ordenarOfertas,
  productosParaOferta,
  resumirActividad,
  tituloDeOferta,
  topeParaTikTok,
  ventanaDeOferta,
  type ModeloEnOferta,
  type NivelOferta,
  type OfertaResumen,
  type ProductoParaOferta,
  horasDeCiclica,
  tituloDeCiclica,
  ventanasQueFaltan,
  HORAS_MAX_CICLICA,
  relampagosDeActividad,
  ultimaRelampago,
  esConflictoDeActividad,
  hastaCuandoBloquear,
  type NivelProducto,
  type RelampagoDeProducto,
} from "../tiktok/promociones";

const CLAVE_CACHE_OFERTAS = "tiktok:promociones";
const EDAD_CACHE_OFERTAS_MS = 2 * 60_000;
/** Qué relámpago tiene cada producto (del detalle de cada actividad): 10 min, cae con cada oferta creada o desactivada. */
const CLAVE_CACHE_RELAMPAGOS = "tiktok:promociones:productos";
const EDAD_CACHE_RELAMPAGOS_MS = 10 * 60_000;
/** Cuántas ofertas ya vencidas se detallan para saber el último precio de un modelo que hoy no tiene relámpago. */
const VENCIDAS_A_DETALLAR = 12;
const RECURSO_OFERTA = "tiktok-promocion";

export interface ModeloParaOferta extends ProductoParaOferta {
  niveles: PreciosTikTok | null;
}

/** Los modelos activos en TikTok con su producto, sus variantes y los precios de la estrategia. */
export async function modelosParaOferta(
  admin: DB,
  accountId: string,
  opciones: { sinPrecios?: boolean } = {},
): Promise<{ modelos: ModeloParaOferta[]; avisos: string[] }> {
  const avisos: string[] = [];
  const [skus, relampago, objetivos] = await Promise.all([
    traerTodo<any>(admin, "tiktok_skus", "sku_id, product_id, seller_sku, sku_interno, estado, precio, titulo", (q) =>
      q.eq("account_id", accountId).eq("activo", true).eq("estado", "ACTIVATE"),
    ),
    // El fondo de los cíclicos (cada minuto) no necesita la estrategia de precios.
    opciones.sinPrecios
      ? Promise.resolve([] as any[])
      : admin
          .rpc("meli_neto_relampago_por_modelo", { p_account: accountId, p_desde: fechaMx(29) })
          .then((r: any) => (r?.error ? null : ((r?.data ?? []) as any[]))),
    opciones.sinPrecios
      ? Promise.resolve([] as any[])
      : traerTodo<any>(admin, "tiktok_precios_objetivo", "modelo, precio, quitar_retencion", (q) => q.eq("account_id", accountId)).catch(() => [] as any[]),
  ]);
  if (!relampago) avisos.push("Sin el relámpago de MELI: solo hay precio sugerido en los modelos con «Mi precio».");
  const precios = preciosTikTokPorModelo(relampago ?? [], objetivos ?? []);
  const titulos = new Map<string, string>();
  for (const s of skus ?? []) if (s.product_id && s.titulo && !titulos.has(String(s.product_id))) titulos.set(String(s.product_id), String(s.titulo));
  const productos = productosParaOferta(
    (skus ?? []).map((s: any) => ({
      skuId: String(s.sku_id ?? ""),
      productId: String(s.product_id ?? ""),
      sellerSku: s.seller_sku ?? null,
      skuInterno: s.sku_interno ?? null,
      estado: s.estado ?? null,
      precio: s.precio != null ? Number(s.precio) : null,
    })),
    titulos,
  );
  return { modelos: productos.map((p) => ({ ...p, niveles: precios.get(p.modelo) ?? null })), avisos };
}

export interface OfertaGuardada {
  id: number;
  activityId: string | null;
  titulo: string;
  nivel: string | null;
  inicio: string;
  fin: string;
  topePorTalla: number;
  topePorComprador: number;
  modelos: { modelo: string; precio: number; variantes: number }[];
  estado: string;
  error: string | null;
  creadoEn: string;
}

/** La constancia local de las últimas ofertas creadas desde el ERP. */
export async function ofertasGuardadas(db: DB, accountId: string, limite = 40): Promise<OfertaGuardada[]> {
  const { data, error } = await db
    .from("tiktok_promociones")
    .select("id, activity_id, titulo, nivel, inicio, fin, tope_por_talla, tope_por_comprador, modelos, estado, error, creado_en")
    .eq("account_id", accountId)
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`tiktok_promociones: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    id: Number(r.id),
    activityId: r.activity_id ?? null,
    titulo: String(r.titulo ?? ""),
    nivel: r.nivel ?? null,
    inicio: String(r.inicio),
    fin: String(r.fin),
    topePorTalla: Number(r.tope_por_talla ?? -1),
    topePorComprador: Number(r.tope_por_comprador ?? -1),
    modelos: Array.isArray(r.modelos) ? r.modelos.map((m: any) => ({ modelo: String(m.modelo), precio: Number(m.precio), variantes: Number(m.variantes ?? 0) })) : [],
    estado: String(r.estado ?? ""),
    error: r.error ?? null,
    creadoEn: String(r.creado_en),
  }));
}

export interface OfertasDeTikTok {
  ofertas: OfertaResumen[];
  error: string | null;
  leidoEn: string;
}

async function leerOfertasDeTikTok(admin: any, accountId: string): Promise<OfertasDeTikTok> {
  const leidoEn = new Date().toISOString();
  const cliente = await clienteDeCuenta(admin, accountId, 60_000);
  if (!cliente?.tienda.shopCipher) return { ofertas: [], error: "TikTok Shop no está conectado.", leidoEn };
  try {
    // TikTok MX solo deja buscar por NOT_START, ONGOING, EXPIRED y
    // DEACTIVATED: con DRAFT contesta 17029001 «Invalid Parameter»
    // (15-oct-2026), así que los borradores no se leen desde aquí.
    const [vivas, vencidas] = await Promise.all([
      buscarActividades(cliente, { estados: ["ONGOING", "NOT_START"], paginas: 3 }),
      buscarActividades(cliente, { estados: ["EXPIRED", "DEACTIVATED"], paginas: 1 }),
    ]);
    const ofertas = ordenarOfertas([...vivas.actividades, ...vencidas.actividades].map(resumirActividad)).filter((o) => o.activityId);
    return { ofertas, error: null, leidoEn };
  } catch (err) {
    return { ofertas: [], error: (err as Error).message, leidoEn };
  }
}

/** Las ofertas que TikTok tiene hoy, masticadas 2 minutos (crear o desactivar las invalida). */
export async function listarOfertas(admin: any, accountId: string, opciones: { forzar?: boolean } = {}): Promise<OfertasDeTikTok> {
  if (opciones.forzar) await invalidarApp(admin, accountId, "ofertas de TikTok", { claves: [CLAVE_CACHE_OFERTAS] }).catch(() => undefined);
  return conCacheApp(admin, accountId, CLAVE_CACHE_OFERTAS, EDAD_CACHE_OFERTAS_MS, () => leerOfertasDeTikTok(admin, accountId));
}

export interface PedidoDeOferta {
  /** por VARIANTE (lo de siempre) o por PRODUCTO, como las relámpagos a mano del Seller Center */
  nivelProducto?: NivelProducto | null;
  /** la cíclica de la que nace esta ventana (queda en `tiktok_promociones.ciclico_id`) */
  ciclicoId?: number | null;
  titulo?: string | null;
  /** ISO; vacío = dentro de `MINUTOS_DE_ARRANQUE` minutos */
  inicio?: string | null;
  horas?: number | null;
  nivel?: NivelOferta | null;
  topePorTalla?: number | null;
  topePorComprador?: number | null;
  modelos: { modelo: string; precio: number }[];
}

export interface ResultadoOferta {
  id: number;
  activityId: string;
  titulo: string;
  estado: string;
  modelos: number;
  variantes: number;
  /** lotes de productos que TikTok no aceptó, con su mensaje */
  errores: string[];
  avisos: string[];
}

/**
 * Crea la oferta en TikTok: la actividad y, lote por lote, sus productos.
 * Si TikTok rechaza un lote después de crear la actividad, la constancia
 * queda como `parcial` con el mensaje real y la actividad sigue en TikTok
 * (se completa o se desactiva desde la pantalla). Un solo clic a la vez.
 */
export async function crearOferta(admin: any, accountId: string, pedido: PedidoDeOferta, usuario: string | null): Promise<ResultadoOferta> {
  const nivel: NivelOferta = pedido.nivel === "live" || pedido.nivel === "campana" ? pedido.nivel : "normal";
  const ciclicoId = Number(pedido.ciclicoId) > 0 ? Number(pedido.ciclicoId) : null;
  const inicio = pedido.inicio ? new Date(pedido.inicio) : new Date(Date.now() + MINUTOS_DE_ARRANQUE * 60_000);
  const horas = Number(pedido.horas) > 0 ? Number(pedido.horas) : HORAS_POR_OMISION;
  const ventana = ventanaDeOferta(inicio, horas);
  const titulo = String(pedido.titulo ?? "").trim() || tituloDeOferta(inicio, nivel);
  const topes = { porTalla: topeParaTikTok(pedido.topePorTalla), porComprador: topeParaTikTok(pedido.topePorComprador) };

  const pedidos = new Map<string, number>();
  for (const m of pedido.modelos ?? []) {
    const modelo = String(m.modelo ?? "").trim().toUpperCase();
    const precio = Number(m.precio);
    if (modelo && precio > 0) pedidos.set(modelo, Math.round(precio * 100) / 100);
  }
  if (!pedidos.size) throw new Error("Marca al menos un modelo con precio.");
  const { modelos: catalogo } = await modelosParaOferta(admin, accountId);
  const porModelo = new Map(catalogo.map((m) => [m.modelo, m]));
  const modelos: ModeloEnOferta[] = [];
  const sinProducto: string[] = [];
  for (const [modelo, precio] of pedidos) {
    const p = porModelo.get(modelo);
    if (!p) sinProducto.push(modelo);
    else modelos.push({ modelo, productId: p.productId, precio, skuIds: p.skuIds });
  }
  if (sinProducto.length) throw new Error(`Sin producto activo en TikTok: ${sinProducto.join(", ")}.`);
  const nivelProducto: NivelProducto = pedido.nivelProducto === "PRODUCT" ? "PRODUCT" : "VARIATION";
  const lotes = lotesDeProductos(modelos, topes, nivelProducto);
  const cuerpo = cuerpoDeActividad(titulo, ventana, nivelProducto);

  try {
    return await conCandado(admin, accountId, RECURSO_OFERTA, 180, async () => {
      const cliente = await clienteDeCuenta(admin, accountId, 170_000);
      if (!cliente?.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
      const { data: fila, error } = await admin
        .from("tiktok_promociones")
        .insert({
          account_id: accountId,
          titulo: cuerpo.title,
          tipo: "FLASHSALE",
          nivel: ciclicoId ? "ciclica" : nivel,
          ciclico_id: ciclicoId,
          inicio: new Date(ventana.beginTime * 1000).toISOString(),
          fin: new Date(ventana.endTime * 1000).toISOString(),
          tope_por_talla: topes.porTalla,
          tope_por_comprador: topes.porComprador,
          modelos: modelos.map((m) => ({ modelo: m.modelo, precio: m.precio, productId: m.productId, variantes: m.skuIds.length })),
          estado: "creando",
          creado_por: usuario,
        })
        .select("id")
        .single();
      if (error || !fila) throw new Error(`No se pudo guardar la constancia: ${error?.message ?? "sin id"}`);
      const id = Number(fila.id);
      const respuesta: Record<string, unknown> = { cuerpo, nivelProducto, lotes: [] as unknown[] };
      const errores: string[] = [];
      const avisos: string[] = [];
      let activityId = "";
      try {
        const creada = await crearActividad(cliente, cuerpo);
        activityId = String(creada.activity_id);
        respuesta.actividad = creada;
        for (let i = 0; i < lotes.length; i++) {
          try {
            const r = await actualizarProductosDeActividad(cliente, activityId, lotes[i]);
            (respuesta.lotes as unknown[]).push({ lote: i + 1, ok: true, r });
            for (const w of r?.warnings ?? []) if (w?.message) avisos.push(String(w.message));
          } catch (err) {
            const m = (err as Error).message;
            errores.push(`Lote ${i + 1} de ${lotes.length} (${lotes[i].length} productos): ${m}`);
            (respuesta.lotes as unknown[]).push({ lote: i + 1, ok: false, error: m });
          }
        }
      } catch (err) {
        const m = (err as Error).message;
        await admin
          .from("tiktok_promociones")
          .update({ estado: "error", error: m, respuesta })
          .eq("id", id);
        throw err;
      }
      const estado = errores.length ? (errores.length === lotes.length ? "sin_productos" : "parcial") : "creada";
      await admin
        .from("tiktok_promociones")
        .update({ activity_id: activityId, estado, error: errores.length ? errores.join(" | ") : null, respuesta })
        .eq("id", id);
      await invalidarApp(admin, accountId, "oferta creada", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
      return {
        id,
        activityId,
        titulo: String(cuerpo.title),
        estado,
        modelos: modelos.length,
        variantes: modelos.reduce((a, m) => a + m.skuIds.length, 0),
        errores,
        avisos,
      };
    });
  } catch (err) {
    if (err instanceof RecursoOcupadoError) throw new Error("Ya se está creando una oferta; espera a que termine.");
    throw err;
  }
}

/** Desactiva una oferta en TikTok (deja de enseñarse) y lo anota en la constancia si la hay. */
export async function desactivarOferta(admin: any, accountId: string, activityId: string): Promise<void> {
  const id = String(activityId ?? "").trim();
  if (!id) throw new Error("Falta la oferta.");
  const cliente = await clienteDeCuenta(admin, accountId, 60_000);
  if (!cliente?.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
  const r = await desactivarActividad(cliente, id);
  await admin
    .from("tiktok_promociones")
    .update({ estado: "desactivada", respuesta: { desactivada: r } })
    .eq("account_id", accountId)
    .eq("activity_id", id);
  await invalidarApp(admin, accountId, "oferta desactivada", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
}

/** Vuelve a crear una oferta guardada con los mismos modelos y precios, desde ahora (o la fecha que se diga). */
export async function repetirOferta(
  admin: any,
  accountId: string,
  id: number,
  usuario: string | null,
  opciones: { inicio?: string | null; horas?: number | null } = {},
): Promise<ResultadoOferta> {
  const { data: fila, error } = await admin
    .from("tiktok_promociones")
    .select("nivel, modelos, tope_por_talla, tope_por_comprador, inicio, fin")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (error || !fila) throw new Error("Esa oferta no está en la constancia.");
  const horasOriginales = Math.round((Date.parse(fila.fin) - Date.parse(fila.inicio)) / 3_600_000);
  return crearOferta(
    admin,
    accountId,
    {
      inicio: opciones.inicio ?? null,
      horas: opciones.horas ?? (horasOriginales > 0 ? horasOriginales : HORAS_POR_OMISION),
      nivel: (fila.nivel as NivelOferta) ?? "normal",
      topePorTalla: fila.tope_por_talla,
      topePorComprador: fila.tope_por_comprador,
      modelos: (Array.isArray(fila.modelos) ? fila.modelos : []).map((m: any) => ({ modelo: String(m.modelo), precio: Number(m.precio) })),
    },
    usuario,
  );
}

// ---------------------------------------------------------------------------
// Qué relámpago tiene cada producto en TikTok
// ---------------------------------------------------------------------------

export interface RelampagosPorProducto {
  /** product_id → sus relámpagos (en curso, programadas y las últimas vencidas) */
  porProducto: Record<string, RelampagoDeProducto[]>;
  leidoEn: string;
  error: string | null;
}

async function leerRelampagosPorProducto(admin: any, accountId: string): Promise<RelampagosPorProducto> {
  const leidoEn = new Date().toISOString();
  const ofertas = await listarOfertas(admin, accountId);
  if (ofertas.error) return { porProducto: {}, leidoEn, error: ofertas.error };
  const cliente = await clienteDeCuenta(admin, accountId, 120_000);
  if (!cliente?.tienda.shopCipher) return { porProducto: {}, leidoEn, error: "TikTok Shop no está conectado." };
  const vivas = ofertas.ofertas.filter((o) => o.estado === "ONGOING" || o.estado === "NOT_START");
  const vencidas = ofertas.ofertas.filter((o) => o.estado !== "ONGOING" && o.estado !== "NOT_START").slice(0, VENCIDAS_A_DETALLAR);
  const porProducto: Record<string, RelampagoDeProducto[]> = {};
  const errores: string[] = [];
  const cola: OfertaResumen[] = [...vivas, ...vencidas];
  let cursor = 0;
  const obrero = async () => {
    while (cursor < cola.length) {
      const o = cola[cursor++];
      try {
        const detalle = await actividad(cliente, o.activityId);
        for (const { productId, relampago } of relampagosDeActividad(o, detalle)) (porProducto[productId] ??= []).push(relampago);
      } catch (err) {
        errores.push(`${o.titulo}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, cola.length) }, obrero));
  return { porProducto, leidoEn, error: errores.length ? errores.join(" · ") : null };
}

/** Las relámpagos de cada producto, masticadas 10 minutos. */
export async function relampagosPorProducto(admin: any, accountId: string): Promise<RelampagosPorProducto> {
  return conCacheApp(admin, accountId, CLAVE_CACHE_RELAMPAGOS, EDAD_CACHE_RELAMPAGOS_MS, () => leerRelampagosPorProducto(admin, accountId));
}

// ---------------------------------------------------------------------------
// Relámpagos CÍCLICOS: siempre programados, por modelo
// ---------------------------------------------------------------------------

export interface CiclicaGuardada {
  id: number;
  modelo: string;
  precio: number;
  horas: number;
  topePorTalla: number;
  topePorComprador: number;
  activo: boolean;
  ultimoError: string | null;
  programadoEn: string | null;
  /** TikTok rechazó la cíclica por otra relámpago pública (17029022): no se reintenta antes de esta hora */
  bloqueadaHasta: string | null;
  /** las ventanas creadas que aún no terminan, de la más próxima a la más lejana */
  ventanas: { id: number; activityId: string | null; inicio: string; fin: string; estado: string }[];
  /** relámpagos del producto en TikTok que NO nacieron de la cíclica y siguen vivas (a mano; no estorban, se enseñan) */
  ajenas: RelampagoDeProducto[];
  /** la relámpago más reciente del producto en TikTok, con su precio */
  ultimaEnTikTok: RelampagoDeProducto | null;
  /** si el modelo sigue con producto activo en TikTok */
  enTikTok: boolean;
}

/** Lo que hace falta para cruzar una cíclica con lo que TikTok ya tiene: el producto de cada modelo y las relámpagos por producto. */
export interface ContextoRelampagos {
  productoDeModelo: Map<string, string>;
  porProducto: Record<string, RelampagoDeProducto[]>;
}

function relampagosDelModelo(ctx: ContextoRelampagos | undefined, modelo: string): RelampagoDeProducto[] {
  const productId = ctx?.productoDeModelo.get(modelo);
  return productId ? (ctx?.porProducto[productId] ?? []) : [];
}

const ESTADOS_VENTANA_VIVA = ["creada", "parcial", "creando"];

async function ventanasVivasDeCiclicas(db: DB, accountId: string, ids: number[]) {
  if (!ids.length) return new Map<number, CiclicaGuardada["ventanas"]>();
  const { data, error } = await db
    .from("tiktok_promociones")
    .select("id, ciclico_id, activity_id, inicio, fin, estado")
    .eq("account_id", accountId)
    .in("ciclico_id", ids)
    .in("estado", ESTADOS_VENTANA_VIVA)
    .gt("fin", new Date().toISOString())
    .order("inicio", { ascending: true });
  if (error) throw new Error(error.message);
  const salida = new Map<number, CiclicaGuardada["ventanas"]>();
  for (const r of data ?? []) {
    const lista = salida.get(Number(r.ciclico_id)) ?? [];
    lista.push({ id: Number(r.id), activityId: r.activity_id ?? null, inicio: r.inicio, fin: r.fin, estado: r.estado });
    salida.set(Number(r.ciclico_id), lista);
  }
  return salida;
}

/** Las cíclicas de la cuenta (activas y pausadas) con sus ventanas vivas. */
export async function ciclicasGuardadas(db: DB, accountId: string, enTikTok?: Set<string>, ctx?: ContextoRelampagos): Promise<CiclicaGuardada[]> {
  const { data, error } = await db
    .from("tiktok_promociones_ciclicas")
    .select("id, modelo, precio, horas, tope_por_talla, tope_por_comprador, activo, ultimo_error, programado_en, bloqueada_hasta")
    .eq("account_id", accountId)
    .order("modelo", { ascending: true });
  if (error) throw new Error(error.message);
  const filas = data ?? [];
  const ventanas = await ventanasVivasDeCiclicas(db, accountId, filas.map((f: any) => Number(f.id)));
  return filas.map((f: any) => {
    const propias = ventanas.get(Number(f.id)) ?? [];
    const propiasIds = new Set(propias.map((v) => v.activityId).filter(Boolean));
    const enTikTokDelModelo = relampagosDelModelo(ctx, String(f.modelo));
    const ajenas = enTikTokDelModelo.filter(
      (r) => !propiasIds.has(r.activityId) && (r.estado === "ONGOING" || r.estado === "NOT_START") && r.fin && Date.parse(r.fin) > Date.now(),
    );
    return {
      id: Number(f.id),
      modelo: String(f.modelo),
      precio: Number(f.precio),
      horas: Number(f.horas),
      topePorTalla: Number(f.tope_por_talla),
      topePorComprador: Number(f.tope_por_comprador),
      activo: Boolean(f.activo),
      ultimoError: f.ultimo_error ?? null,
      programadoEn: f.programado_en ?? null,
      bloqueadaHasta: f.bloqueada_hasta && Date.parse(f.bloqueada_hasta) > Date.now() ? f.bloqueada_hasta : null,
      ventanas: propias,
      ajenas,
      ultimaEnTikTok: ultimaRelampago(enTikTokDelModelo),
      enTikTok: enTikTok ? enTikTok.has(String(f.modelo)) : true,
    };
  });
}

export interface PedidoCiclica {
  modelo: string;
  precio: number;
  horas?: number | null;
  topePorTalla?: number | null;
  topePorComprador?: number | null;
}

/**
 * Da de alta o corrige una cíclica SIN programar nada todavía. Un cambio de
 * PRECIO se lleva también a la ventana ya programada que no ha empezado
 * (TikTok deja editar los productos de una actividad); la que ya corre se
 * queda con su precio. Devuelve el id.
 */
async function altaDeCiclica(admin: any, accountId: string, pedido: PedidoCiclica, usuario: string | null): Promise<number> {
  const modelo = String(pedido.modelo ?? "").trim().toUpperCase();
  const precio = Math.round(Number(pedido.precio) * 100) / 100;
  if (!modelo) throw new Error("Falta el modelo.");
  if (!(precio > 0)) throw new Error(`${modelo}: el precio tiene que ser mayor a cero.`);
  const horas = horasDeCiclica(pedido.horas);
  const topes = { porTalla: topeParaTikTok(pedido.topePorTalla), porComprador: topeParaTikTok(pedido.topePorComprador) };
  const { modelos: catalogo } = await modelosParaOferta(admin, accountId);
  const producto = catalogo.find((m) => m.modelo === modelo);
  if (!producto) throw new Error(`El ${modelo} no tiene producto activo en TikTok.`);

  const { data: previa } = await admin
    .from("tiktok_promociones_ciclicas")
    .select("id, precio, tope_por_talla, tope_por_comprador")
    .eq("account_id", accountId)
    .eq("modelo", modelo)
    .maybeSingle();
  const { data: fila, error } = await admin
    .from("tiktok_promociones_ciclicas")
    .upsert(
      {
        account_id: accountId,
        modelo,
        precio,
        horas,
        tope_por_talla: topes.porTalla,
        tope_por_comprador: topes.porComprador,
        activo: true,
        ultimo_error: null,
        actualizado_en: new Date().toISOString(),
        creado_por: usuario,
      },
      { onConflict: "account_id,modelo" },
    )
    .select("id")
    .single();
  if (error || !fila) throw new Error(`No se pudo guardar la cíclica: ${error?.message ?? "sin id"}`);
  const id = Number(fila.id);

  // El precio (o los topes) nuevos a las ventanas que aún no empiezan.
  const cambio =
    previa && (Number(previa.precio) !== precio || Number(previa.tope_por_talla) !== topes.porTalla || Number(previa.tope_por_comprador) !== topes.porComprador);
  if (cambio) {
    const ventanas = (await ventanasVivasDeCiclicas(admin, accountId, [id])).get(id) ?? [];
    const porEmpezar = ventanas.filter((v) => v.activityId && Date.parse(v.inicio) > Date.now());
    if (porEmpezar.length) {
      const cliente = await clienteDeCuenta(admin, accountId, 120_000);
      if (!cliente?.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
      const lotes = lotesDeProductos([{ modelo, productId: producto.productId, precio, skuIds: producto.skuIds }], topes);
      for (const v of porEmpezar) {
        try {
          for (const lote of lotes) await actualizarProductosDeActividad(cliente, String(v.activityId), lote);
          await admin
            .from("tiktok_promociones")
            .update({ modelos: [{ modelo, precio, productId: producto.productId, variantes: producto.skuIds.length }], tope_por_talla: topes.porTalla, tope_por_comprador: topes.porComprador })
            .eq("id", v.id);
        } catch (err) {
          await admin
            .from("tiktok_promociones_ciclicas")
            .update({ ultimo_error: `No se pudo cambiar el precio de la ventana ${v.activityId}: ${(err as Error).message}` })
            .eq("id", id);
        }
      }
      await invalidarApp(admin, accountId, "cíclica corregida", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
    }
  }
  return id;
}

/** Da de alta o corrige UNA cíclica y programa en el acto su relámpago si le falta. */
export async function guardarCiclica(admin: any, accountId: string, pedido: PedidoCiclica, usuario: string | null): Promise<CiclicaGuardada> {
  const id = await altaDeCiclica(admin, accountId, pedido, usuario);
  await programarCiclicas(admin, accountId, { soloIds: [id], presupuestoMs: 150_000 });
  const [guardada] = (await ciclicasGuardadas(admin, accountId)).filter((c) => c.id === id);
  if (!guardada) throw new Error("La cíclica se guardó pero no se pudo releer.");
  return guardada;
}

export interface ResultadoCiclicasMasivas {
  guardadas: number;
  /** modelos que no se pudieron dar de alta, con su porqué */
  errores: string[];
  programacion: ResultadoProgramacion;
}

/**
 * Alta MASIVA (dueño, 19-oct-2026: «una sección de listas de todos los
 * productos activos en TikTok para poner muchos cíclicos»): cada modelo se
 * da de alta por su cuenta (uno que falle no frena a los demás) y al final
 * se programan juntos con el presupuesto que quede; lo que no alcance lo
 * recoge el cron de los 10 minutos.
 */
export async function guardarCiclicas(
  admin: any,
  accountId: string,
  lista: PedidoCiclica[],
  usuario: string | null,
  presupuestoMs = 150_000,
): Promise<ResultadoCiclicasMasivas> {
  const arranque = Date.now();
  const ids: number[] = [];
  const errores: string[] = [];
  for (const pedido of lista ?? []) {
    try {
      ids.push(await altaDeCiclica(admin, accountId, pedido, usuario));
    } catch (err) {
      errores.push((err as Error).message);
    }
  }
  const programacion = ids.length
    ? await programarCiclicas(admin, accountId, { soloIds: ids, presupuestoMs: Math.max(10_000, presupuestoMs - (Date.now() - arranque)) })
    : { revisadas: 0, creadas: 0, errores: [], sinTiempo: false, limpiadas: 0, esperas: 0, extendidas: 0 };
  return { guardadas: ids.length, errores, programacion };
}

/**
 * Quita una cíclica: deja de reponer ventanas y DESACTIVA en TikTok las que
 * todavía no empiezan. La que ya corre termina sola (los compradores ya la
 * ven con ese precio).
 */
export async function quitarCiclica(admin: any, accountId: string, id: number): Promise<{ desactivadas: number; errores: string[] }> {
  const { data: fila } = await admin
    .from("tiktok_promociones_ciclicas")
    .select("id")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (!fila) throw new Error("Esa cíclica no existe.");
  await admin.from("tiktok_promociones_ciclicas").update({ activo: false, actualizado_en: new Date().toISOString() }).eq("id", id);
  const ventanas = (await ventanasVivasDeCiclicas(admin, accountId, [id])).get(id) ?? [];
  const porEmpezar = ventanas.filter((v) => v.activityId && Date.parse(v.inicio) > Date.now());
  const errores: string[] = [];
  let desactivadas = 0;
  if (porEmpezar.length) {
    const cliente = await clienteDeCuenta(admin, accountId, 120_000);
    if (!cliente?.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
    for (const v of porEmpezar) {
      try {
        const r = await desactivarActividad(cliente, String(v.activityId));
        await admin.from("tiktok_promociones").update({ estado: "desactivada", respuesta: { desactivada: r } }).eq("id", v.id);
        desactivadas++;
      } catch (err) {
        errores.push(`${v.activityId}: ${(err as Error).message}`);
      }
    }
    await invalidarApp(admin, accountId, "cíclica quitada", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
  }
  return { desactivadas, errores };
}

export interface ResultadoProgramacion {
  revisadas: number;
  creadas: number;
  errores: string[];
  sinTiempo: boolean;
  /** actividades vacías (sin productos) que se desactivaron en TikTok para que no estorben */
  limpiadas: number;
  /** cuántas veces el fondo esperó a que terminara una relámpago para pegar la siguiente */
  esperas: number;
  /** relámpagos vivas que se ALARGARON en TikTok en vez de crear la siguiente */
  extendidas: number;
  /** otra corrida tenía el candado: esta no hizo nada */
  ocupado?: boolean;
}

/** Si la relámpago viva termina dentro de este rato, el fondo se queda esperando a que termine en vez de volver al minuto. */
const MARGEN_ESPERA_MS = 75_000;
/** Un respiro después del fin para que TikTok ya la tenga como vencida. */
const RESPIRO_TRAS_FIN_MS = 5_000;

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Repone a cada cíclica activa su relámpago cuando le falta: UNA viva o
 * programada por modelo (`ventanasQueFaltan`; TikTok no deja dos a la vez,
 * ver `tiktok/promociones.ts`), contando también las que el producto tiene
 * a mano. Corre CADA MINUTO y la primera revisión es barata (dos lecturas
 * de la base): si todas las cíclicas tienen su ventana propia viva y lejos
 * de terminar, no hace nada más. Cuando la viva de un modelo termina dentro
 * de `MARGEN_ESPERA_MS`, el fondo ESPERA a que termine y crea la siguiente
 * arrancando `MINUTOS_ARRANQUE_CICLICA` después (dueño, 19-oct-2026: «en el
 * tiempo más temprano posible cuando se vence la última, y el espacio entre
 * una y otra de 2 minutos»); si TikTok rechaza un inicio tan cercano, se
 * reintenta con `MINUTOS_DE_ARRANQUE`. Con presupuesto de tiempo: lo que
 * no alcance lo recoge la siguiente corrida. Un modelo que ya no tiene
 * producto activo en TikTok se anota y se salta; un error de TikTok queda
 * en `ultimo_error` sin frenar a los demás.
 *
 * Antes de reponer, LIMPIA: una ventana propia que quedó `sin_productos`
 * (TikTok creó la actividad y rechazó los productos) se desactiva en TikTok
 * —si no, se queda ahí vacía con su título ocupado— y las constancias
 * repetidas de «name already in use» del cron viejo se borran.
 */
const RECURSO_CICLICOS = "tiktok-ciclicos";

export async function programarCiclicas(
  admin: any,
  accountId: string,
  opciones: { soloIds?: number[]; presupuestoMs?: number } = {},
): Promise<ResultadoProgramacion> {
  // UNA corrida a la vez: el cron de cada minuto puede quedarse esperando a
  // que termine una relámpago (hasta 80 s) y la del minuto siguiente se le
  // encimaba (19-oct-2026: tres modelos con «Ya se está creando una oferta»
  // aunque su relámpago sí se creó). La encimada simplemente no hace nada.
  try {
    return await conCandado(admin, accountId, RECURSO_CICLICOS, 300, () => programarCiclicasSinCandado(admin, accountId, opciones));
  } catch (err) {
    if (err instanceof RecursoOcupadoError) {
      return { revisadas: 0, creadas: 0, errores: [], sinTiempo: false, limpiadas: 0, esperas: 0, extendidas: 0, ocupado: true };
    }
    throw err;
  }
}

async function programarCiclicasSinCandado(
  admin: any,
  accountId: string,
  opciones: { soloIds?: number[]; presupuestoMs?: number } = {},
): Promise<ResultadoProgramacion> {
  const arranque = Date.now();
  const presupuesto = opciones.presupuestoMs ?? 240_000;
  const salida: ResultadoProgramacion = { revisadas: 0, creadas: 0, errores: [], sinTiempo: false, limpiadas: 0, esperas: 0, extendidas: 0 };
  let consulta = admin
    .from("tiktok_promociones_ciclicas")
    .select("id, modelo, precio, horas, tope_por_talla, tope_por_comprador, bloqueada_hasta")
    .eq("account_id", accountId)
    .eq("activo", true)
    .order("programado_en", { ascending: true, nullsFirst: true });
  if (opciones.soloIds?.length) consulta = consulta.in("id", opciones.soloIds);
  const { data: ciclicas, error } = await consulta;
  if (error) throw new Error(error.message);
  if (!ciclicas?.length) return salida;
  const ids = ciclicas.map((c: any) => Number(c.id));
  const vivas = await ventanasVivasDeCiclicas(admin, accountId, ids);

  // Revisión barata: con ventana propia viva y lejos de terminar, nada que
  // hacer; una que TikTok rechazó por conflicto espera su `bloqueada_hasta`.
  const umbral = Date.now() + MARGEN_ESPERA_MS;
  const bloqueada = (c: any) => Boolean(c.bloqueada_hasta) && Date.parse(c.bloqueada_hasta) > Date.now();
  const conTrabajo = ciclicas.filter((c: any) => {
    if (bloqueada(c)) return false;
    const propias = vivas.get(Number(c.id)) ?? [];
    const fin = finDeLaViva(propias.map((v) => ({ inicio: new Date(v.inicio), fin: new Date(v.fin) })));
    return !fin || fin.getTime() <= umbral;
  });
  // Un aviso viejo en una cíclica que ya tiene su relámpago viva sobra (la
  // bloqueada conserva el suyo: dice por qué espera y hasta cuándo).
  const alDia = ciclicas.filter((c: any) => !conTrabajo.includes(c) && !bloqueada(c)).map((c: any) => Number(c.id));
  if (alDia.length) {
    await admin
      .from("tiktok_promociones_ciclicas")
      .update({ ultimo_error: null })
      .in("id", alDia)
      .not("ultimo_error", "is", null)
      .then(() => undefined, () => undefined);
  }
  // La limpieza va antes del «nada que hacer»: una actividad que quedó vacía
  // por conflicto se desactiva en el siguiente minuto, no hasta que a otra
  // cíclica le toque trabajo (es una lectura a la base; TikTok solo si hay).
  salida.limpiadas = await limpiarVentanasVacias(admin, accountId, ids);
  if (!conTrabajo.length) return salida;

  const { modelos: catalogo } = await modelosParaOferta(admin, accountId, { sinPrecios: true });
  const porModelo = new Map(catalogo.map((m) => [m.modelo, m]));
  // Lo que el producto YA tiene en TikTok a mano NO detiene la cíclica: una
  // relámpago de creadores no es pública ni choca (dueño, 21-oct-2026). Se
  // lee solo para acotar el bloqueo si TikTok sí rechaza por conflicto.
  const enTikTok = await relampagosPorProducto(admin, accountId);
  if (enTikTok.error) {
    // Sin saber qué relámpagos tiene cada producto no se crea nada: la que se
    // creara a ciegas chocaría con una a mano y quedaría vacía.
    salida.errores.push(`No se pudo leer qué relámpagos hay en TikTok: ${enTikTok.error}. No se programó nada en esta pasada.`);
    return salida;
  }
  const estadoEnTikTok = new Map<string, string>();
  for (const lista of Object.values(enTikTok.porProducto)) for (const r of lista) estadoEnTikTok.set(r.activityId, r.estado);

  for (const c of conTrabajo) {
    if (Date.now() - arranque > presupuesto) {
      salida.sinTiempo = true;
      break;
    }
    const id = Number(c.id);
    const modelo = String(c.modelo);
    salida.revisadas++;
    const anotar = (ultimo_error: string | null, bloqueada_hasta: string | null = null) =>
      admin
        .from("tiktok_promociones_ciclicas")
        .update({ ultimo_error, bloqueada_hasta, programado_en: new Date().toISOString() })
        .eq("id", id);
    if (!porModelo.has(modelo)) {
      await anotar(`El ${modelo} ya no tiene producto activo en TikTok: no se programó nada.`);
      salida.errores.push(`${modelo}: sin producto activo en TikTok`);
      continue;
    }
    // Una ventana propia que el dueño DESACTIVÓ en el Seller Center ya no cuenta como viva.
    const propias = (vivas.get(id) ?? []).filter((v) => {
      const estado = v.activityId ? estadoEnTikTok.get(v.activityId) : undefined;
      if (estado !== "DEACTIVATED") return true;
      admin.from("tiktok_promociones").update({ estado: "desactivada" }).eq("id", v.id).then(() => undefined, () => undefined);
      return false;
    });
    const propiasIds = new Set(propias.map((v) => v.activityId).filter(Boolean));
    const ajenas = (enTikTok.porProducto[porModelo.get(modelo)!.productId] ?? []).filter((r) => !propiasIds.has(r.activityId));
    // Solo las ventanas PROPIAS cuentan: las ajenas no estorban salvo que TikTok lo diga.
    const programadas = propias.map((v) => ({ inicio: new Date(v.inicio), fin: new Date(v.fin) }));

    // La viva está por terminar: PRIMERO se le pide a TikTok que la alargue
    // (dueño, 22-oct-2026: «en vez de crear cada vez cíclicas nuevas, cambiar
    // las fechas de terminación»); si TikTok lo acepta no se crea nada y el
    // producto nunca se queda sin relámpago ni choca con una de creadores
    // que entre mientras. Si lo rechaza (el tope de 72 h por relámpago, o lo
    // que diga), se espera a que termine y se crea la siguiente como siempre.
    const fin = finDeLaViva(programadas);
    if (fin) {
      const espera = fin.getTime() + RESPIRO_TRAS_FIN_MS - Date.now();
      if (espera > MARGEN_ESPERA_MS + RESPIRO_TRAS_FIN_MS || Date.now() - arranque + espera > presupuesto) continue;
      const viva = propias.find((v) => v.activityId && new Date(v.fin).getTime() === fin.getTime());
      if (viva?.activityId) {
        const extendida = await extenderVentana(admin, accountId, modelo, viva, Number(c.horas));
        if (extendida) {
          salida.extendidas++;
          await anotar(null);
          continue;
        }
      }
      if (espera > 0) {
        salida.esperas++;
        await dormir(espera);
      }
    }
    const faltan = ventanasQueFaltan(programadas, Number(c.horas));
    let errorDeEsta: string | null = null;
    let errorCrudo: string | null = null;
    for (const v of faltan) {
      if (Date.now() - arranque > presupuesto) {
        salida.sinTiempo = true;
        break;
      }
      const pedido = (titulo: string, inicio: Date): PedidoDeOferta => ({
        ciclicoId: id,
        titulo,
        inicio: inicio.toISOString(),
        horas: Math.round((v.fin.getTime() - v.inicio.getTime()) / 3_600_000),
        nivel: "normal",
        topePorTalla: Number(c.tope_por_talla),
        topePorComprador: Number(c.tope_por_comprador),
        modelos: [{ modelo, precio: Number(c.precio) }],
      });
      const titulo = tituloDeCiclica(modelo, v.inicio);
      try {
        let r: ResultadoOferta;
        try {
          r = await crearOferta(admin, accountId, pedido(titulo, v.inicio), null);
        } catch (err) {
          if (esTituloRepetido(err)) {
            // El título ya existe en TikTok (una actividad vacía de antes): se
            // intenta UNA vez con otro nombre en vez de fallar cada corrida.
            r = await crearOferta(admin, accountId, pedido(`${titulo} ·2`, v.inicio), null);
          } else if (esErrorDeInicio(err)) {
            // TikTok no aceptó un inicio tan cercano: con el arranque de siempre.
            const inicio = new Date(Date.now() + MINUTOS_DE_ARRANQUE * 60_000);
            r = await crearOferta(admin, accountId, pedido(tituloDeCiclica(modelo, inicio), inicio), null);
          } else throw err;
        }
        // Probado el 21-oct-2026: cuando choca por variante, por PRODUCTO
        // también choca (17029022 las dos veces). No se reintenta: cada
        // intento deja una actividad vacía en TikTok.
        if (r.errores.length) {
          errorCrudo = r.errores.join(" | ");
          errorDeEsta = explicarErrorDeCiclica(modelo, errorCrudo);
          break;
        }
        salida.creadas++;
      } catch (err) {
        if (/Ya se está creando una oferta/.test((err as Error).message)) {
          // Otra creación tiene el candado de ofertas: el siguiente minuto lo reintenta sin dejar aviso.
          salida.sinTiempo = true;
          break;
        }
        errorCrudo = (err as Error).message;
        errorDeEsta = explicarErrorDeCiclica(modelo, errorCrudo);
        break;
      }
    }
    if (errorDeEsta && esConflictoDeActividad(errorCrudo)) {
      // TikTok sí tiene el producto en otra actividad pública: se espera a que
      // termine la ajena más larga (o una hora si no se ve cuál) en vez de
      // crear y desactivar una actividad vacía cada minuto.
      const hasta = hastaCuandoBloquear(ajenas);
      // Constancia cruda de con qué chocó, para afinar la lectura sin abrir nada a mano.
      await anotarDiagnosticoDeConflicto(admin, accountId, modelo, errorCrudo, ajenas).catch(() => undefined);
      errorDeEsta = `${errorDeEsta} Se vuelve a intentar ${hasta.toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.`;
      salida.errores.push(`${modelo}: ${errorDeEsta}`);
      await anotar(errorDeEsta, hasta.toISOString());
      continue;
    }
    if (errorDeEsta) salida.errores.push(`${modelo}: ${errorDeEsta}`);
    await anotar(errorDeEsta);
  }
  return salida;
}

export interface ResultadoAlargar {
  ok: boolean;
  activityId: string;
  titulo: string | null;
  finAnterior: string | null;
  finNuevo: string;
  /** lo que contestó TikTok cuando no entró */
  error: string | null;
}

/**
 * Le pide a TikTok que ALARGUE una actividad viva o programada `horas` más
 * allá de su fin actual (UpdateActivity: `PUT /promotion/202309/activities/{id}`
 * con solo `end_time`) y lo CONFIRMA releyendo la actividad: un «sí» con el
 * fin sin cambiar cuenta como rechazo. Si la actividad es una ventana de
 * cíclica del ERP, su renglón de `tiktok_promociones` toma el fin nuevo.
 * Deja constancia en `tiktok_sync_log` (tarea `oferta-alargar`, `origen`
 * cíclica o manual) de lo que contestó TikTok. Nunca lanza.
 */
export async function alargarOferta(
  admin: any,
  accountId: string,
  activityId: string,
  horas: number,
  origen: "ciclica" | "manual" = "manual",
): Promise<ResultadoAlargar> {
  const id = String(activityId ?? "").trim();
  const ahora = new Date().toISOString();
  const constancia = (estado: string, detalle: Record<string, unknown>) =>
    admin
      .from("tiktok_sync_log")
      .insert({ account_id: accountId, tarea: "oferta-alargar", inicio: ahora, fin: new Date().toISOString(), estado, detalle: { origen, activityId: id, ...detalle } })
      .then(() => undefined, () => undefined);
  const fallo = async (error: string, extra: Record<string, unknown> = {}, finAnterior: string | null = null, finNuevo = ""): Promise<ResultadoAlargar> => {
    await constancia("rechazada", { error, finAnterior, finNuevo, ...extra });
    return { ok: false, activityId: id, titulo: (extra.titulo as string) ?? null, finAnterior, finNuevo, error };
  };
  if (!id) return fallo("Falta la oferta.");
  try {
    const cliente = await clienteDeCuenta(admin, accountId, 60_000);
    if (!cliente?.tienda.shopCipher) return fallo("TikTok Shop no está conectado.");
    const antes = await actividad(cliente, id);
    const finActual = Number(antes?.end_time ?? 0) * 1000;
    const titulo = antes?.title ? String(antes.title) : null;
    if (!finActual) return fallo("TikTok no dijo cuándo termina esa oferta.", { titulo, detalle: antes });
    const finAnterior = new Date(finActual).toISOString();
    const nuevoFin = finExtendido(new Date(finActual), horas);
    let respuesta: unknown;
    try {
      respuesta = await actualizarActividad(cliente, id, { endTime: Math.floor(nuevoFin.getTime() / 1000) });
    } catch (err) {
      return fallo((err as Error).message, { titulo }, finAnterior, nuevoFin.toISOString());
    }
    const despues = await actividad(cliente, id).catch(() => null);
    const finEnTikTok = Number(despues?.end_time ?? 0) * 1000;
    if (!finEnTikTok || Math.abs(finEnTikTok - nuevoFin.getTime()) > 60_000) {
      return fallo(
        `TikTok contestó que sí pero la oferta sigue terminando ${finEnTikTok ? new Date(finEnTikTok).toISOString() : "sin fecha"}.`,
        { titulo, respuesta, finEnTikTok: finEnTikTok ? new Date(finEnTikTok).toISOString() : null },
        finAnterior,
        nuevoFin.toISOString(),
      );
    }
    await admin
      .from("tiktok_promociones")
      .update({ fin: nuevoFin.toISOString(), respuesta: { extendida: respuesta, extendidaEn: ahora, finAnterior } })
      .eq("account_id", accountId)
      .eq("activity_id", id)
      .then(() => undefined, () => undefined);
    await constancia("ok", { titulo, respuesta, finAnterior, finNuevo: nuevoFin.toISOString() });
    await invalidarApp(admin, accountId, "relámpago alargada", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
    return { ok: true, activityId: id, titulo, finAnterior, finNuevo: nuevoFin.toISOString(), error: null };
  } catch (err) {
    return fallo((err as Error).message);
  }
}

/** La ventana viva de una cíclica se alarga con `alargarOferta`; contesta si entró. */
async function extenderVentana(
  admin: any,
  accountId: string,
  modelo: string,
  viva: { id: number; activityId: string | null; inicio: string; fin: string },
  horas: number,
): Promise<boolean> {
  if (!viva.activityId) return false;
  const r = await alargarOferta(admin, accountId, viva.activityId, horas, "ciclica");
  if (!r.ok) {
    await admin
      .from("tiktok_sync_log")
      .insert({ account_id: accountId, tarea: "ciclica-extender", inicio: new Date().toISOString(), fin: new Date().toISOString(), estado: "rechazada", detalle: { modelo, ...r } })
      .then(() => undefined, () => undefined);
  }
  return r.ok;
}

/**
 * Cuando TikTok rechaza una cíclica por conflicto, guarda en la bitácora el
 * DETALLE crudo de las actividades ajenas vivas del producto (hasta 3): es la
 * única forma de ver si el API distingue una relámpago de creadores de una
 * pública (21-oct-2026, dueño: «siempre vamos a tener relámpagos de
 * creadores»).
 */
async function anotarDiagnosticoDeConflicto(admin: any, accountId: string, modelo: string, error: string | null, ajenas: RelampagoDeProducto[]) {
  const cliente = await clienteDeCuenta(admin, accountId, 60_000);
  const detalles: unknown[] = [];
  if (cliente?.tienda.shopCipher) {
    for (const a of ajenas.slice(0, 3)) {
      try {
        detalles.push({ activityId: a.activityId, titulo: a.titulo, detalle: await actividad(cliente, a.activityId) });
      } catch (err) {
        detalles.push({ activityId: a.activityId, titulo: a.titulo, error: (err as Error).message });
      }
    }
  }
  const ahora = new Date().toISOString();
  await admin.from("tiktok_sync_log").insert({
    account_id: accountId,
    tarea: "diagnostico-promociones",
    inicio: ahora,
    fin: ahora,
    estado: "ok",
    detalle: { modelo, error, ajenas, detalles },
  });
}

/** TikTok rechazó la HORA DE INICIO (muy cercana o en el pasado). */
function esErrorDeInicio(err: unknown): boolean {
  const m = String((err as Error)?.message ?? "");
  return /begin[_ ]?time|start[_ ]?time|hora de inicio/i.test(m);
}

function esTituloRepetido(err: unknown): boolean {
  const m = String((err as Error)?.message ?? "");
  return m.includes("17029004") || /already in use/i.test(m);
}

/**
 * Desactiva en TikTok las ventanas propias que quedaron SIN productos y aún
 * no terminan (quedan como `desactivada`) y borra las constancias `error`
 * repetidas del cron viejo («name already in use»). Devuelve cuántas
 * actividades desactivó. Si TikTok no deja desactivar alguna, se queda
 * para la siguiente corrida.
 */
async function limpiarVentanasVacias(admin: any, accountId: string, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  await admin
    .from("tiktok_promociones")
    .delete()
    .eq("account_id", accountId)
    .in("ciclico_id", ids)
    .eq("estado", "error")
    .is("activity_id", null)
    .ilike("error", "%already in use%")
    .then(() => undefined, () => undefined);
  const { data: vacias } = await admin
    .from("tiktok_promociones")
    .select("id, activity_id")
    .eq("account_id", accountId)
    .in("ciclico_id", ids)
    .eq("estado", "sin_productos")
    .not("activity_id", "is", null)
    .gt("fin", new Date().toISOString());
  if (!vacias?.length) return 0;
  const cliente = await clienteDeCuenta(admin, accountId, 120_000);
  if (!cliente?.tienda.shopCipher) return 0;
  let n = 0;
  for (const v of vacias) {
    try {
      const r = await desactivarActividad(cliente, String(v.activity_id));
      await admin.from("tiktok_promociones").update({ estado: "desactivada", respuesta: { desactivada: r, motivo: "vacía: TikTok rechazó sus productos" } }).eq("id", v.id);
      n++;
    } catch {
      /* la siguiente corrida lo reintenta */
    }
  }
  if (n) await invalidarApp(admin, accountId, "ventanas vacías desactivadas", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
  return n;
}
